// tests/fb-accounts-routes.test.js
import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

jest.mock('../backend/utils/facebook-auth-db.js');
jest.mock('axios');

import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';
import axiosModule from 'axios';

const { fbAccountsRouter } = await import('../backend/routes/fb-accounts.js');

// Test harness: mount a middleware that injects req.user before the router.
// In production, ensureAuthenticatedAPI in server.js populates req.user from
// the session. The harness simulates that. The current user can be overridden
// per-test by mutating `currentUser`. (Harmless to the legacy /tokens routes.)
let currentUser = { id: 1, username: 'tester', facebook_access_token: 'OAUTH_TOKEN' };

const app = express();
app.use(express.json());
app.use('/api/fb-accounts', (req, _res, next) => {
  req.user = currentUser;
  next();
}, fbAccountsRouter);

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, username: 'tester', facebook_access_token: 'OAUTH_TOKEN' };

  // Legacy /tokens FacebookAuthDB methods
  FacebookAuthDB.listSystemUserTokens = jest.fn();
  FacebookAuthDB.saveSystemUserToken = jest.fn();
  FacebookAuthDB.deleteSystemUserToken = jest.fn();

  // Multi-BM FacebookAuthDB methods
  FacebookAuthDB.upsertBusinessManager = jest.fn().mockResolvedValue({});
  FacebookAuthDB.upsertSystemUser = jest.fn().mockResolvedValue({});
  FacebookAuthDB.upsertAdAccount = jest.fn().mockResolvedValue({});
  FacebookAuthDB.markValidation = jest.fn().mockResolvedValue({});
  FacebookAuthDB.listBusinessManagers = jest.fn().mockResolvedValue([]);
  FacebookAuthDB.getBusinessManager = jest.fn().mockResolvedValue(null);
  FacebookAuthDB.getSystemUserForBm = jest.fn().mockResolvedValue(null);
  FacebookAuthDB.listAdAccountsForBm = jest.fn().mockResolvedValue([]);
  FacebookAuthDB.listSystemUsers = jest.fn().mockResolvedValue([]);
  FacebookAuthDB.deleteSystemUser = jest.fn().mockResolvedValue({});

  axiosModule.get = jest.fn();
});

// Helper: configures axios.get to respond based on URL substring.
function mockGraphResponses(responses) {
  axiosModule.get.mockImplementation((url) => {
    for (const [match, value] of responses) {
      if (url.includes(match)) {
        if (value instanceof Error) return Promise.reject(value);
        if (value && value.__reject) return Promise.reject(value.__reject);
        return Promise.resolve({ data: value });
      }
    }
    return Promise.reject(new Error(`Unmocked URL: ${url}`));
  });
}

// ============================================================================
// Legacy /tokens routes — must stay functional alongside the new endpoints.
// ============================================================================
describe('GET /api/fb-accounts/tokens', () => {
  test('returns list with token_preview (access_token redacted)', async () => {
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([
      { business_manager_id: 'bm_1', business_name: 'SGP', access_token: 'EAABwzLtest123', expires_at: null }
    ]);
    const res = await request(app).get('/api/fb-accounts/tokens');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].business_name).toBe('SGP');
    expect(res.body[0].token_preview).toBe('EAABwzL...');
    expect(res.body[0].access_token).toBeUndefined();
  });
});

describe('POST /api/fb-accounts/tokens/verify', () => {
  test('verifies token and saves if valid', async () => {
    axiosModule.get.mockResolvedValue({ data: { id: 'bm_123', name: 'SGP Business' } });
    FacebookAuthDB.saveSystemUserToken.mockResolvedValue({});

    const res = await request(app)
      .post('/api/fb-accounts/tokens/verify')
      .send({ access_token: 'EAABwzLtest' });

    expect(res.status).toBe(200);
    expect(res.body.business_name).toBe('SGP Business');
    expect(FacebookAuthDB.saveSystemUserToken).toHaveBeenCalledWith('bm_123', 'SGP Business', 'EAABwzLtest', null);
  });

  test('returns 400 if token is invalid', async () => {
    axiosModule.get.mockRejectedValue({
      response: { data: { error: { message: 'Invalid OAuth access token' } } }
    });
    const res = await request(app)
      .post('/api/fb-accounts/tokens/verify')
      .send({ access_token: 'bad_token' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid OAuth access token');
  });

  test('returns 400 if no access_token provided', async () => {
    const res = await request(app)
      .post('/api/fb-accounts/tokens/verify')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/fb-accounts/tokens/:bmId', () => {
  test('deletes token by business manager ID', async () => {
    FacebookAuthDB.deleteSystemUserToken.mockResolvedValue({});
    const res = await request(app).delete('/api/fb-accounts/tokens/bm_123');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(FacebookAuthDB.deleteSystemUserToken).toHaveBeenCalledWith('bm_123');
  });
});

// ============================================================================
// New /system-users/* registration + management endpoints.
// ============================================================================
describe('POST /api/fb-accounts/system-users/register', () => {
  test('happy path: 1 BM, 2 ad accounts, debug_token gives expiry', async () => {
    mockGraphResponses([
      // Order matters: debug_token URL also contains "access_token", so debug_token must be checked first.
      ['debug_token', { data: { expires_at: 1900000000 } }],
      ['/me/businesses', { data: [{ id: 'bm_1', name: 'SGP BM' }] }],
      ['/me/adaccounts', { data: [
        { account_id: '111', name: 'Acct One', currency: 'USD', timezone_name: 'America/New_York', account_status: 1, business: { id: 'bm_1', name: 'SGP BM' } },
        { account_id: '222', name: 'Acct Two', currency: 'USD', timezone_name: 'America/New_York', account_status: 2, business: { id: 'bm_1', name: 'SGP BM' } },
      ] }],
      ['/me?', { id: 'sysuser_1', name: 'System User One' }],
    ]);

    const res = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'SYS_TOKEN' });

    expect(res.status).toBe(200);
    expect(res.body.system_user).toEqual({ id: 'sysuser_1', name: 'System User One' });
    expect(res.body.business_managers).toEqual([{ id: 'bm_1', name: 'SGP BM' }]);
    expect(res.body.ad_accounts_wired).toBe(2);
    expect(res.body.expires_at).toMatch(/^20\d\d-/); // ISO string

    expect(FacebookAuthDB.upsertBusinessManager).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bm_1', name: 'SGP BM', role: 'launching', status: 'active' })
    );
    expect(FacebookAuthDB.upsertSystemUser).toHaveBeenCalledWith(
      expect.objectContaining({
        fb_user_id: 'sysuser_1',
        business_manager_id: 'bm_1',
        name: 'System User One',
        access_token: 'SYS_TOKEN',
      })
    );
    expect(FacebookAuthDB.markValidation).toHaveBeenCalledWith(
      expect.objectContaining({ fb_user_id: 'sysuser_1', business_manager_id: 'bm_1', ok: true })
    );
    expect(FacebookAuthDB.upsertAdAccount).toHaveBeenCalledTimes(2);
    expect(FacebookAuthDB.upsertAdAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'act_111', account_id: '111', business_manager_id: 'bm_1', status: 'active' })
    );
    expect(FacebookAuthDB.upsertAdAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'act_222', account_id: '222', business_manager_id: 'bm_1', status: 'disabled' })
    );
  });

  test('authz failure: BM in /me/adaccounts not in OAuth user /me/businesses returns 403', async () => {
    mockGraphResponses([
      ['debug_token', { data: { expires_at: 0 } }],
      ['/me/businesses', { data: [{ id: 'bm_authorized', name: 'Authorized BM' }] }],
      ['/me/adaccounts', { data: [
        { account_id: '111', name: 'Acct', currency: 'USD', timezone_name: 'UTC', account_status: 1,
          business: { id: 'bm_unauthorized', name: 'Bad BM' } },
      ] }],
      ['/me?', { id: 'sysuser_1', name: 'Sys User' }],
    ]);

    const res = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'SYS_TOKEN' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/bm_unauthorized/);
    expect(res.body.rejected_bm_ids).toEqual(['bm_unauthorized']);
    expect(FacebookAuthDB.upsertBusinessManager).not.toHaveBeenCalled();
    expect(FacebookAuthDB.upsertSystemUser).not.toHaveBeenCalled();
  });

  test('returns 401 if req.user.facebook_access_token missing', async () => {
    currentUser = { id: 1, username: 'tester' }; // no facebook_access_token
    mockGraphResponses([
      ['/me?', { id: 'sysuser_1', name: 'Sys User' }],
      ['/me/adaccounts', { data: [
        { account_id: '111', name: 'X', currency: 'USD', timezone_name: 'UTC', account_status: 1,
          business: { id: 'bm_1', name: 'BM' } },
      ] }],
      ['debug_token', { data: { expires_at: 0 } }],
    ]);

    const res = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'SYS_TOKEN' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/OAuth/i);
    expect(FacebookAuthDB.upsertBusinessManager).not.toHaveBeenCalled();
  });

  test('returns 400 if access_token missing', async () => {
    const res = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/access_token/);
  });

  test('returns 400 if /me Graph call fails (Meta message surfaced)', async () => {
    axiosModule.get.mockImplementation((url) => {
      if (url.includes('/me?')) {
        return Promise.reject({ response: { data: { error: { message: 'Invalid OAuth access token' } } } });
      }
      return Promise.reject(new Error('unreachable'));
    });

    const res = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'bad_token' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid OAuth access token');
  });

  test('debug_token failure does not block registration; expires_at = null', async () => {
    axiosModule.get.mockImplementation((url) => {
      if (url.includes('debug_token')) {
        return Promise.reject(new Error('debug_token unavailable'));
      }
      if (url.includes('/me/businesses')) {
        return Promise.resolve({ data: { data: [{ id: 'bm_1', name: 'SGP' }] } });
      }
      if (url.includes('/me/adaccounts')) {
        return Promise.resolve({ data: { data: [
          { account_id: '111', name: 'X', currency: 'USD', timezone_name: 'UTC',
            account_status: 1, business: { id: 'bm_1', name: 'SGP' } },
        ] } });
      }
      if (url.includes('/me?')) {
        return Promise.resolve({ data: { id: 'sysuser_1', name: 'SU' } });
      }
      return Promise.reject(new Error('unmocked: ' + url));
    });

    const res = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'SYS_TOKEN' });

    expect(res.status).toBe(200);
    expect(res.body.expires_at).toBeNull();
    expect(FacebookAuthDB.upsertSystemUser).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: null })
    );
  });

  test('skips ad accounts without a business field', async () => {
    mockGraphResponses([
      ['debug_token', { data: { expires_at: 0 } }],
      ['/me/businesses', { data: [{ id: 'bm_1', name: 'SGP' }] }],
      ['/me/adaccounts', { data: [
        { account_id: '111', name: 'WithBM', currency: 'USD', timezone_name: 'UTC', account_status: 1,
          business: { id: 'bm_1', name: 'SGP' } },
        { account_id: '999', name: 'NoBM', currency: 'USD', timezone_name: 'UTC', account_status: 1 },
      ] }],
      ['/me?', { id: 'sysuser_1', name: 'SU' }],
    ]);

    const res = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'SYS_TOKEN' });

    expect(res.status).toBe(200);
    expect(res.body.ad_accounts_wired).toBe(1);
    expect(FacebookAuthDB.upsertAdAccount).toHaveBeenCalledTimes(1);
  });

  test('re-registering with the same token is idempotent (no dup rows)', async () => {
    // Simulate the underlying SQLite upsert semantics: each (id) maps to a
    // single row. Tracking call args by id lets us prove "row count" after N
    // calls without spinning up a real DB.
    const bmRows = new Map();          // id -> latest payload
    const systemUserRows = new Map();  // `${fb_user_id}|${bm_id}` -> latest payload
    const adAccountRows = new Map();   // id -> latest payload

    FacebookAuthDB.upsertBusinessManager = jest.fn(async (payload) => {
      bmRows.set(payload.id, payload);
    });
    FacebookAuthDB.upsertSystemUser = jest.fn(async (payload) => {
      systemUserRows.set(`${payload.fb_user_id}|${payload.business_manager_id}`, payload);
    });
    FacebookAuthDB.upsertAdAccount = jest.fn(async (payload) => {
      adAccountRows.set(payload.id, payload);
    });

    const firstAdAccounts = [
      { account_id: '111', name: 'Acct One', currency: 'USD', timezone_name: 'UTC',
        account_status: 1, business: { id: 'bm_1', name: 'SGP BM' } },
      { account_id: '222', name: 'Acct Two', currency: 'USD', timezone_name: 'UTC',
        account_status: 1, business: { id: 'bm_1', name: 'SGP BM' } },
    ];
    const secondAdAccounts = [
      { account_id: '111', name: 'Acct One', currency: 'USD', timezone_name: 'UTC',
        account_status: 1, business: { id: 'bm_1', name: 'SGP BM' } },
      { account_id: '222', name: 'Acct Two', currency: 'USD', timezone_name: 'UTC',
        account_status: 2, business: { id: 'bm_1', name: 'SGP BM' } }, // flipped
    ];

    const setupMocks = (adAccounts) => mockGraphResponses([
      ['debug_token', { data: { expires_at: 1900000000 } }],
      ['/me/businesses', { data: [{ id: 'bm_1', name: 'SGP BM' }] }],
      ['/me/adaccounts', { data: adAccounts }],
      ['/me?', { id: 'sysuser_1', name: 'System User One' }],
    ]);

    setupMocks(firstAdAccounts);
    const first = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'SYS_TOKEN' });
    expect(first.status).toBe(200);

    const snapshot = {
      bms: bmRows.size,
      systemUsers: systemUserRows.size,
      adAccounts: adAccountRows.size,
    };
    expect(snapshot).toEqual({ bms: 1, systemUsers: 1, adAccounts: 2 });
    expect(adAccountRows.get('act_222').status).toBe('active');

    setupMocks(secondAdAccounts);
    const second = await request(app)
      .post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'SYS_TOKEN' });
    expect(second.status).toBe(200);

    // No duplicates: row counts identical after second call.
    expect(bmRows.size).toBe(snapshot.bms);
    expect(systemUserRows.size).toBe(snapshot.systemUsers);
    expect(adAccountRows.size).toBe(snapshot.adAccounts);

    // Latest write wins.
    expect(adAccountRows.get('act_222').status).toBe('disabled');
    expect(adAccountRows.get('act_111').status).toBe('active');
    expect(systemUserRows.get('sysuser_1|bm_1').access_token).toBe('SYS_TOKEN');
  });

  test('account_status: 100 maps to restricted, unknown code maps to unknown', async () => {
    mockGraphResponses([
      ['debug_token', { data: { expires_at: 0 } }],
      ['/me/businesses', { data: [{ id: 'bm_1', name: 'SGP' }] }],
      ['/me/adaccounts', { data: [
        { account_id: '111', name: 'Restricted', currency: 'USD', timezone_name: 'UTC',
          account_status: 100, business: { id: 'bm_1', name: 'SGP' } },
        { account_id: '222', name: 'Mystery', currency: 'USD', timezone_name: 'UTC',
          account_status: 999, business: { id: 'bm_1', name: 'SGP' } },
      ] }],
      ['/me?', { id: 'sysuser_1', name: 'SU' }],
    ]);

    await request(app).post('/api/fb-accounts/system-users/register')
      .send({ access_token: 'SYS_TOKEN' });

    expect(FacebookAuthDB.upsertAdAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'act_111', status: 'restricted' })
    );
    expect(FacebookAuthDB.upsertAdAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'act_222', status: 'unknown' })
    );
  });
});

describe('POST /api/fb-accounts/system-users/:fbUserId/:bmId/revalidate', () => {
  test('updates expires_at, marks validation ok, refreshes ad accounts', async () => {
    FacebookAuthDB.getSystemUserForBm.mockResolvedValue({
      fb_user_id: 'sysuser_1',
      business_manager_id: 'bm_1',
      access_token: 'SYS_TOKEN',
    });
    mockGraphResponses([
      ['debug_token', { data: { expires_at: 1900000000 } }],
      ['/me/adaccounts', { data: [
        { account_id: '111', name: 'Acct One', currency: 'USD', timezone_name: 'UTC',
          account_status: 2, business: { id: 'bm_1', name: 'SGP' } },
      ] }],
      ['/me?', { id: 'sysuser_1', name: 'SU' }],
    ]);

    const res = await request(app)
      .post('/api/fb-accounts/system-users/sysuser_1/bm_1/revalidate')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.validated_at).toBeDefined();
    expect(res.body.expires_at).toMatch(/^20\d\d-/);
    expect(FacebookAuthDB.markValidation).toHaveBeenCalledWith(
      expect.objectContaining({ fb_user_id: 'sysuser_1', business_manager_id: 'bm_1', ok: true })
    );
    expect(FacebookAuthDB.upsertAdAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'act_111', status: 'disabled' })
    );
  });

  test('returns 404 if system user not found for BM', async () => {
    FacebookAuthDB.getSystemUserForBm.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/fb-accounts/system-users/sysuser_1/bm_1/revalidate')
      .send({});
    expect(res.status).toBe(404);
  });

  test('returns 404 if fb_user_id does not match stored row', async () => {
    FacebookAuthDB.getSystemUserForBm.mockResolvedValue({
      fb_user_id: 'sysuser_other',
      business_manager_id: 'bm_1',
      access_token: 'SYS_TOKEN',
    });
    const res = await request(app)
      .post('/api/fb-accounts/system-users/sysuser_1/bm_1/revalidate')
      .send({});
    expect(res.status).toBe(404);
  });

  test('marks validation ok=false if /me fails', async () => {
    FacebookAuthDB.getSystemUserForBm.mockResolvedValue({
      fb_user_id: 'sysuser_1',
      business_manager_id: 'bm_1',
      access_token: 'SYS_TOKEN',
    });
    axiosModule.get.mockImplementation((url) => {
      if (url.includes('/me?')) {
        return Promise.reject({ response: { data: { error: { message: 'expired' } } } });
      }
      return Promise.reject(new Error('unreachable'));
    });

    const res = await request(app)
      .post('/api/fb-accounts/system-users/sysuser_1/bm_1/revalidate')
      .send({});

    expect(res.status).toBe(400);
    expect(FacebookAuthDB.markValidation).toHaveBeenCalledWith(
      expect.objectContaining({ fb_user_id: 'sysuser_1', business_manager_id: 'bm_1', ok: false })
    );
  });
});

describe('GET /api/fb-accounts/system-users', () => {
  test('returns all system users with token preview, access_token redacted', async () => {
    FacebookAuthDB.listSystemUsers.mockResolvedValue([
      { fb_user_id: 'sysuser_1', business_manager_id: 'bm_1', name: 'SU One',
        access_token: 'EAABwzLtest', expires_at: null,
        last_validated_at: '2026-01-01', last_validation_ok: 1 },
      { fb_user_id: 'sysuser_2', business_manager_id: 'bm_2', name: 'SU Two',
        access_token: 'EAABotherX', expires_at: '2026-06-01',
        last_validated_at: null, last_validation_ok: 0 },
    ]);

    const res = await request(app).get('/api/fb-accounts/system-users');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].token_preview).toBe('EAABwzL...');
    expect(res.body[0].access_token).toBeUndefined();
    expect(res.body[1].token_preview).toBe('EAABoth...');
    expect(res.body[1].access_token).toBeUndefined();
  });
});

describe('DELETE /api/fb-accounts/system-users/:fbUserId/:bmId', () => {
  test('removes the row and returns ok', async () => {
    FacebookAuthDB.deleteSystemUser.mockResolvedValue({ changes: 1 });
    const res = await request(app).delete('/api/fb-accounts/system-users/sysuser_1/bm_1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(FacebookAuthDB.deleteSystemUser).toHaveBeenCalledWith('sysuser_1', 'bm_1');
  });
});

describe('GET /api/fb-accounts/business-managers', () => {
  test('returns list with no filters', async () => {
    FacebookAuthDB.listBusinessManagers.mockResolvedValue([
      { id: 'bm_1', name: 'SGP', role: 'launching', status: 'active' },
    ]);
    const res = await request(app).get('/api/fb-accounts/business-managers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(FacebookAuthDB.listBusinessManagers).toHaveBeenCalledWith({});
  });

  test('forwards role and status filters', async () => {
    FacebookAuthDB.listBusinessManagers.mockResolvedValue([]);
    const res = await request(app).get('/api/fb-accounts/business-managers?role=tm&status=active');
    expect(res.status).toBe(200);
    expect(FacebookAuthDB.listBusinessManagers).toHaveBeenCalledWith({ role: 'tm', status: 'active' });
  });
});

describe('GET /api/fb-accounts/business-managers/:id/ad-accounts', () => {
  test('returns ad accounts under that BM', async () => {
    FacebookAuthDB.listAdAccountsForBm.mockResolvedValue([
      { id: 'act_111', account_id: '111', business_manager_id: 'bm_1', name: 'A' },
      { id: 'act_222', account_id: '222', business_manager_id: 'bm_1', name: 'B' },
    ]);
    const res = await request(app).get('/api/fb-accounts/business-managers/bm_1/ad-accounts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(FacebookAuthDB.listAdAccountsForBm).toHaveBeenCalledWith('bm_1');
  });
});
