import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

jest.mock('../backend/db/rules-engine-db.js');
jest.mock('../backend/utils/facebook-auth-db.js');
jest.mock('../backend/utils/facebook-cache-db.js');

import { RulesEngineDB } from '../backend/db/rules-engine-db.js';
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';
import { FacebookCacheDB } from '../backend/utils/facebook-cache-db.js';

const { rulesEngineN8nRouter } = await import('../backend/routes/rules-engine-n8n.js');

const app = express();
app.use(express.json());
app.use('/api/rules-engine', rulesEngineN8nRouter);

beforeEach(() => {
  jest.clearAllMocks();
  RulesEngineDB.listActiveRules = jest.fn().mockResolvedValue([]);
  RulesEngineDB.addLog = jest.fn().mockResolvedValue({});
  RulesEngineDB.setExemption = jest.fn().mockResolvedValue({});
  RulesEngineDB.listActiveSchedules = jest.fn().mockResolvedValue([]);
  RulesEngineDB.getCampaignsForSchedule = jest.fn().mockResolvedValue([]);
  RulesEngineDB.getAssignmentsForRule = jest.fn().mockResolvedValue([]);
  RulesEngineDB.upsertRtDaily = jest.fn().mockResolvedValue({});
  RulesEngineDB.upsertFbDaily = jest.fn().mockResolvedValue({});
  RulesEngineDB.pruneDaily = jest.fn().mockResolvedValue({});
  RulesEngineDB.getFbDailyWindow = jest.fn().mockResolvedValue(null);
  RulesEngineDB.getRtDailyWindow = jest.fn().mockResolvedValue(null);
  RulesEngineDB.autoAssignVerticalLabels = jest.fn().mockResolvedValue({});
  RulesEngineDB.getAllRedtrackSnapshots = jest.fn().mockResolvedValue([]);
  FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([]);
  FacebookAuthDB.getExpiringTokens = jest.fn().mockResolvedValue([]);
  FacebookCacheDB.getCampaigns = jest.fn().mockResolvedValue([]);
});

describe('GET /api/rules-engine/health', () => {
  test('returns 200 ok', async () => {
    const res = await request(app).get('/api/rules-engine/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('GET /api/rules-engine/active-rules', () => {
  test('returns rules with resolved entities and token', async () => {
    RulesEngineDB.listActiveRules = jest.fn().mockResolvedValue([
      { id: 1, name: 'Spend Cap', scope: 'campaign', conditions_json: '[]',
        action: 'pause', action_params_json: null, cooldown_hours: 4, is_dry_run: 0 }
    ]);
    RulesEngineDB.getAssignmentsForRule = jest.fn().mockResolvedValue([
      { entity_type: 'campaign', entity_id: 'camp_123' },
      { entity_type: 'campaign', entity_id: 'camp_456' },
    ]);
    FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([
      { business_manager_id: 'bm_1', access_token: 'SYS_TOKEN' }
    ]);

    const res = await request(app).get('/api/rules-engine/active-rules');
    expect(res.status).toBe(200);
    expect(res.body[0].entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: 'camp_123', token: 'SYS_TOKEN' }),
      expect.objectContaining({ entityId: 'camp_456', token: 'SYS_TOKEN' }),
    ]));
    expect(res.body[0].token).toBeUndefined();
  });
});

describe('POST /api/rules-engine/log', () => {
  test('saves a log entry', async () => {
    const res = await request(app)
      .post('/api/rules-engine/log')
      .send({
        rule_id: 1, entity_type: 'campaign', entity_id: 'camp_123',
        entity_name: 'Test Campaign', action_taken: 'paused',
        trigger_data_json: '{"spend":312}', is_dry_run: 0,
      });
    expect(res.status).toBe(200);
    expect(RulesEngineDB.addLog).toHaveBeenCalled();
  });
});

describe('POST /api/rules-engine/exemptions', () => {
  test('sets a cooldown exemption', async () => {
    const res = await request(app)
      .post('/api/rules-engine/exemptions')
      .send({ rule_id: 1, entity_id: 'camp_123', type: 'cooldown', cooldown_hours: 4 });
    expect(res.status).toBe(200);
    expect(RulesEngineDB.setExemption).toHaveBeenCalledWith(
      1, 'camp_123', 'cooldown', expect.any(String)
    );
  });
});

describe('POST /api/rules-engine/snapshots', () => {
  test('saves snapshot', async () => {
    RulesEngineDB.saveSpendSnapshot = jest.fn().mockResolvedValue({});
    RulesEngineDB.pruneSpendSnapshots = jest.fn().mockResolvedValue({});
    const res = await request(app)
      .post('/api/rules-engine/snapshots')
      .send({ entity_id: 'camp_1', entity_type: 'campaign', spend: 55.0 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(RulesEngineDB.saveSpendSnapshot).toHaveBeenCalledWith('camp_1', 'campaign', 55.0);
  });
});

describe('GET /api/rules-engine/snapshots/:entityId', () => {
  test('returns snapshots array', async () => {
    RulesEngineDB.getSpendSnapshots = jest.fn().mockResolvedValue([
      { id: 1, entity_id: 'camp_1', entity_type: 'campaign', spend: 55.0, recorded_at: '2026-04-15T10:00:00Z' }
    ]);
    const res = await request(app)
      .get('/api/rules-engine/snapshots/camp_1?minutes=60');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].spend).toBe(55.0);
  });
});

describe('POST /api/rules-engine/pause-pending', () => {
  test('sets pause-pending', async () => {
    RulesEngineDB.setPausePending = jest.fn().mockResolvedValue({});
    const res = await request(app)
      .post('/api/rules-engine/pause-pending')
      .send({ rule_id: 1, entity_id: 'camp_1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(RulesEngineDB.setPausePending).toHaveBeenCalledWith(1, 'camp_1');
  });
});

describe('GET /api/rules-engine/pause-pending/check', () => {
  test('returns pending true when set', async () => {
    RulesEngineDB.isPausePending = jest.fn().mockResolvedValue(true);
    const res = await request(app)
      .get('/api/rules-engine/pause-pending/check?rule_id=1&entity_id=camp_1');
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);
  });
});

describe('DELETE /api/rules-engine/pause-pending', () => {
  test('clears pause-pending', async () => {
    RulesEngineDB.clearPausePending = jest.fn().mockResolvedValue({});
    const res = await request(app)
      .delete('/api/rules-engine/pause-pending')
      .send({ rule_id: 1, entity_id: 'camp_1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('GET /api/rules-engine/token-health', () => {
  test('returns expiring tokens', async () => {
    FacebookAuthDB.getExpiringTokens = jest.fn().mockResolvedValue([
      { id: 1, business_name: 'Test Biz', business_manager_id: 'bm_1', expires_at: '2026-04-22T00:00:00Z' }
    ]);
    const res = await request(app).get('/api/rules-engine/token-health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.expiring_soon).toEqual([
      { id: 1, business_name: 'Test Biz', business_manager_id: 'bm_1', expires_at: '2026-04-22T00:00:00Z' }
    ]);
    expect(FacebookAuthDB.getExpiringTokens).toHaveBeenCalledWith(7);
  });
});

describe('POST /daily/redtrack', () => {
  it('upserts RT daily rows and returns count', async () => {
    const res = await request(app)
      .post('/api/rules-engine/daily/redtrack')
      .set('x-n8n-secret', process.env.N8N_SHARED_SECRET || 'test-secret')
      .send([
        { campaign_name: 'Camp RT', date: '2026-04-22', revenue: 500, profit: 100, conversions: 10, cost: 400 },
      ]);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it('skips rows missing campaign_name or date', async () => {
    const res = await request(app)
      .post('/api/rules-engine/daily/redtrack')
      .set('x-n8n-secret', process.env.N8N_SHARED_SECRET || 'test-secret')
      .send([{ revenue: 100 }]);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe('POST /daily/fb', () => {
  it('upserts FB daily rows and returns count', async () => {
    const res = await request(app)
      .post('/api/rules-engine/daily/fb')
      .set('x-n8n-secret', process.env.N8N_SHARED_SECRET || 'test-secret')
      .send([
        { entity_id: 'camp_abc', entity_type: 'campaign', date: '2026-04-22', spend: 200, conversions: 5, revenue: 250 },
      ]);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(1);
  });
});

describe('GET /schedules/enforcement attaches per-campaign tokens (multi-BM)', () => {
  test('each action carries its account-resolved token; top-level fallback present', async () => {
    // Schedule with 2 campaigns in 2 different ad accounts / BMs.
    RulesEngineDB.listActiveSchedules = jest.fn().mockResolvedValue([
      { id: 1, name: 'Day Parting', timezone: 'UTC', days_json: JSON.stringify(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']), start_time: '00:00', end_time: '23:59' },
    ]);
    RulesEngineDB.getCampaignsForSchedule = jest.fn().mockResolvedValue([
      { campaign_id: 'camp_bmA' }, { campaign_id: 'camp_bmB' },
    ]);
    RulesEngineDB.isPausePending = jest.fn().mockResolvedValue(false);
    // Legacy default token (systemUserTokens[0]) — the would-be single token for all.
    FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([
      { business_manager_id: 'bm_A', access_token: 'TOKEN_A' },
    ]);
    // account derivation: each campaign -> distinct account
    FacebookCacheDB.getAccountIdForCampaign = jest.fn(async (id) =>
      id === 'camp_bmA' ? 'actA' : id === 'camp_bmB' ? 'actB' : null);
    FacebookCacheDB.getAccountIdForAdset = jest.fn().mockResolvedValue(null);
    // selectFbToken plumbing (selectFbToken is real, drives FacebookAuthDB):
    FacebookAuthDB.getAdAccount = jest.fn(async (acct) =>
      acct === 'actA' ? { business_manager_id: 'bm_A' } : { business_manager_id: 'bm_B' });
    FacebookAuthDB.getSystemUserForBm = jest.fn(async (bm) => ({
      access_token: bm === 'bm_A' ? 'TOKEN_A' : 'TOKEN_B',
      fb_user_id: 'u', last_validation_ok: 1, expires_at: null, business_manager_id: bm,
    }));
    FacebookAuthDB.getAnyHealthySystemUser = jest.fn().mockResolvedValue(null);
    FacebookAuthDB.getValidToken = jest.fn().mockResolvedValue(null);

    const res = await request(app).get('/api/rules-engine/schedules/enforcement');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token', 'TOKEN_A'); // top-level fallback kept
    const byCampaign = Object.fromEntries(res.body.actions.map(a => [a.campaign_id, a.token]));
    expect(byCampaign.camp_bmA).toBe('TOKEN_A');
    expect(byCampaign.camp_bmB).toBe('TOKEN_B'); // <- this would be TOKEN_A before the fix
  });

  test('single-BM behaviour unchanged: action token equals top-level token', async () => {
    RulesEngineDB.listActiveSchedules = jest.fn().mockResolvedValue([
      { id: 1, name: 'S', timezone: 'UTC', days_json: JSON.stringify(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']), start_time: '00:00', end_time: '23:59' },
    ]);
    RulesEngineDB.getCampaignsForSchedule = jest.fn().mockResolvedValue([{ campaign_id: 'camp_1' }]);
    RulesEngineDB.isPausePending = jest.fn().mockResolvedValue(false);
    FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([
      { business_manager_id: 'bm_1', access_token: 'ONLY_TOKEN' },
    ]);
    FacebookCacheDB.getAccountIdForCampaign = jest.fn(async () => 'acct1');
    FacebookCacheDB.getAccountIdForAdset = jest.fn().mockResolvedValue(null);
    FacebookAuthDB.getAdAccount = jest.fn(async () => ({ business_manager_id: 'bm_1' }));
    FacebookAuthDB.getSystemUserForBm = jest.fn(async () => ({ access_token: 'ONLY_TOKEN', fb_user_id: 'u', last_validation_ok: 1, expires_at: null, business_manager_id: 'bm_1' }));
    FacebookAuthDB.getAnyHealthySystemUser = jest.fn().mockResolvedValue(null);
    FacebookAuthDB.getValidToken = jest.fn().mockResolvedValue(null);

    const res = await request(app).get('/api/rules-engine/schedules/enforcement');
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('ONLY_TOKEN');
    expect(res.body.actions.every(a => a.token === 'ONLY_TOKEN')).toBe(true);
  });

  test('falls back to default token when account cannot be derived', async () => {
    RulesEngineDB.listActiveSchedules = jest.fn().mockResolvedValue([
      { id: 1, name: 'S', timezone: 'UTC', days_json: JSON.stringify(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']), start_time: '00:00', end_time: '23:59' },
    ]);
    RulesEngineDB.getCampaignsForSchedule = jest.fn().mockResolvedValue([{ campaign_id: 'unknown_camp' }]);
    RulesEngineDB.isPausePending = jest.fn().mockResolvedValue(false);
    FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([
      { business_manager_id: 'bm_1', access_token: 'DEFAULT_TOKEN' },
    ]);
    FacebookCacheDB.getAccountIdForCampaign = jest.fn().mockResolvedValue(null);
    FacebookCacheDB.getAccountIdForAdset = jest.fn().mockResolvedValue(null);

    const res = await request(app).get('/api/rules-engine/schedules/enforcement');
    expect(res.status).toBe(200);
    expect(res.body.actions[0].token).toBe('DEFAULT_TOKEN');
  });

  test('memoizes per account: getAdAccount called once per distinct account', async () => {
    RulesEngineDB.listActiveSchedules = jest.fn().mockResolvedValue([
      { id: 1, name: 'S', timezone: 'UTC', days_json: JSON.stringify(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']), start_time: '00:00', end_time: '23:59' },
    ]);
    // two campaigns share account actA, one is on actB
    RulesEngineDB.getCampaignsForSchedule = jest.fn().mockResolvedValue([
      { campaign_id: 'c1' }, { campaign_id: 'c2' }, { campaign_id: 'c3' },
    ]);
    RulesEngineDB.isPausePending = jest.fn().mockResolvedValue(false);
    FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([
      { business_manager_id: 'bm_A', access_token: 'TOKEN_A' },
    ]);
    FacebookCacheDB.getAccountIdForCampaign = jest.fn(async (id) =>
      id === 'c3' ? 'actB' : 'actA');
    FacebookCacheDB.getAccountIdForAdset = jest.fn().mockResolvedValue(null);
    FacebookAuthDB.getAdAccount = jest.fn(async (acct) =>
      ({ business_manager_id: acct === 'actA' ? 'bm_A' : 'bm_B' }));
    FacebookAuthDB.getSystemUserForBm = jest.fn(async (bm) => ({
      access_token: bm === 'bm_A' ? 'TOKEN_A' : 'TOKEN_B',
      fb_user_id: 'u', last_validation_ok: 1, expires_at: null, business_manager_id: bm,
    }));
    FacebookAuthDB.getAnyHealthySystemUser = jest.fn().mockResolvedValue(null);
    FacebookAuthDB.getValidToken = jest.fn().mockResolvedValue(null);

    const res = await request(app).get('/api/rules-engine/schedules/enforcement');
    expect(res.status).toBe(200);
    // 2 distinct accounts -> getAdAccount called exactly twice (not 3x for 3 campaigns)
    expect(FacebookAuthDB.getAdAccount).toHaveBeenCalledTimes(2);
  });
});

describe('GET /active-schedules attaches per-campaign tokens', () => {
  test('campaign_tokens map resolved per account; top-level token kept', async () => {
    RulesEngineDB.listActiveSchedules = jest.fn().mockResolvedValue([
      { id: 1, name: 'S', timezone: 'UTC', days_json: JSON.stringify(['Mon']), start_time: '09:00', end_time: '17:00' },
    ]);
    RulesEngineDB.getCampaignsForSchedule = jest.fn().mockResolvedValue([
      { campaign_id: 'camp_bmA' }, { campaign_id: 'camp_bmB' },
    ]);
    FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([
      { business_manager_id: 'bm_A', access_token: 'TOKEN_A' },
    ]);
    FacebookCacheDB.getAccountIdForCampaign = jest.fn(async (id) => id === 'camp_bmA' ? 'actA' : 'actB');
    FacebookCacheDB.getAccountIdForAdset = jest.fn().mockResolvedValue(null);
    FacebookAuthDB.getAdAccount = jest.fn(async (acct) => ({ business_manager_id: acct === 'actA' ? 'bm_A' : 'bm_B' }));
    FacebookAuthDB.getSystemUserForBm = jest.fn(async (bm) => ({ access_token: bm === 'bm_A' ? 'TOKEN_A' : 'TOKEN_B', fb_user_id: 'u', last_validation_ok: 1, expires_at: null, business_manager_id: bm }));
    FacebookAuthDB.getAnyHealthySystemUser = jest.fn().mockResolvedValue(null);
    FacebookAuthDB.getValidToken = jest.fn().mockResolvedValue(null);

    const res = await request(app).get('/api/rules-engine/active-schedules');
    expect(res.status).toBe(200);
    expect(res.body[0].token).toBe('TOKEN_A'); // fallback field retained
    expect(res.body[0].campaign_ids).toEqual(['camp_bmA', 'camp_bmB']); // existing field unchanged
    expect(res.body[0].campaign_tokens).toEqual({ camp_bmA: 'TOKEN_A', camp_bmB: 'TOKEN_B' });
  });
});

describe('GET /active-rules includes insights_3d and insights_7d', () => {
  it('each entity has insights_3d and insights_7d fields', async () => {
    RulesEngineDB.listActiveRules.mockResolvedValueOnce([{
      id: 1, name: 'Test Rule', scope: 'campaign',
      conditions_json: '[]', action: 'pause',
      action_params_json: null, cooldown_hours: 4,
      is_active: 1, is_dry_run: 0, created_at: '2026-01-01',
      combinator: 'AND', alert_level: 'warning',
    }]);
    RulesEngineDB.getAssignmentsForRule.mockResolvedValueOnce([
      { entity_type: 'campaign', entity_id: 'camp_test' },
    ]);
    // getFbDailyWindow and getRtDailyWindow already mocked to return null

    const res = await request(app)
      .get('/api/rules-engine/active-rules')
      .set('x-n8n-secret', process.env.N8N_SHARED_SECRET || 'test-secret');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const entity = res.body[0].entities[0];
    expect(entity).toHaveProperty('insights_3d');
    expect(entity).toHaveProperty('insights_7d');
    // Both null because FB window mock returns null
    expect(entity.insights_3d).toBeNull();
    expect(entity.insights_7d).toBeNull();
  });
});

describe('GET /active-rules sums RT snapshot aliases sharing one campaign_id', () => {
  it('a renamed campaign with two RT aliases gets summed today metrics, not last-alias-wins', async () => {
    RulesEngineDB.listActiveRules.mockResolvedValueOnce([{
      id: 1, name: 'Test Rule', scope: 'campaign',
      conditions_json: '[]', action: 'pause',
      action_params_json: null, cooldown_hours: 4,
      is_active: 1, is_dry_run: 0, created_at: '2026-01-01',
      combinator: 'AND', alert_level: 'warning',
    }]);
    RulesEngineDB.getAssignmentsForRule.mockResolvedValueOnce([
      { entity_type: 'campaign', entity_id: 'camp_dual' },
    ]);
    RulesEngineDB.getAllRedtrackSnapshots.mockResolvedValueOnce([
      { campaign_name: 'CHW - $23 - SAC', campaign_id: 'camp_dual',
        roi: 0.246, revenue: 100, profit: 19.76, conversions: 4, offer_name: 'CHW CPL' },
      { campaign_name: 'CHW - $25 - SAC', campaign_id: 'camp_dual',
        roi: 0.19, revenue: 300, profit: 47.74, conversions: 12, offer_name: 'CHW CPL' },
    ]);

    const res = await request(app)
      .get('/api/rules-engine/active-rules')
      .set('x-n8n-secret', process.env.N8N_SHARED_SECRET || 'test-secret');
    expect(res.status).toBe(200);
    const rt = res.body[0].entities[0].rt;
    expect(rt.revenue).toBe(400);
    expect(rt.conversions).toBe(16);
    expect(rt.profit).toBeCloseTo(67.5, 5);
    // roi recomputed from summed numbers: profit / (revenue - profit)
    expect(rt.roi).toBeCloseTo(67.5 / 332.5, 5);
  });
});

describe('GET /active-rules 3d/7d windows use max(RT cost, FB spend) floor', () => {
  it('when FB gross spend exceeds RT cost (EDU undercount), insights use FB spend and recomputed ROI/CPA', async () => {
    RulesEngineDB.listActiveRules.mockResolvedValueOnce([{
      id: 1, name: 'Test Rule', scope: 'campaign',
      conditions_json: '[]', action: 'pause',
      action_params_json: null, cooldown_hours: 4,
      is_active: 1, is_dry_run: 0, created_at: '2026-01-01',
      combinator: 'AND', alert_level: 'warning',
    }]);
    RulesEngineDB.getAssignmentsForRule.mockResolvedValueOnce([
      { entity_type: 'campaign', entity_id: 'camp_edu' },
    ]);
    // RT cost (70) understates FB gross spend (100) — the redirect-link case
    RulesEngineDB.getFbDailyWindow = jest.fn().mockResolvedValue({ spend: 100, link_clicks: 0, lp_views: 0 });
    RulesEngineDB.getRtDailyByIdWindow = jest.fn().mockResolvedValue({ cost: 70, revenue: 100, profit: 30, conversions: 4, roi: 0.428571 });
    RulesEngineDB.listVerticalsWithLpvOff = jest.fn().mockResolvedValue([]);
    RulesEngineDB.listAllVerticalLabels = jest.fn().mockResolvedValue([]);

    const res = await request(app)
      .get('/api/rules-engine/active-rules')
      .set('x-n8n-secret', process.env.N8N_SHARED_SECRET || 'test-secret');
    expect(res.status).toBe(200);
    const w = res.body[0].entities[0].insights_3d;
    expect(w.spend).toBe(100);          // max(70, 100) — FB gross floor, not RT cost
    expect(w.profit).toBeCloseTo(0, 5); // revenue 100 - spend 100
    expect(w.roi).toBeCloseTo(0, 5);    // recomputed, NOT raw rt.roi 0.4286
    expect(w.cpa).toBeCloseTo(25, 5);   // 100 / 4 conversions, not 70/4
  });
});
