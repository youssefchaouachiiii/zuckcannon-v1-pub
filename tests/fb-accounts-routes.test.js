// tests/fb-accounts-routes.test.js
import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

jest.mock('../backend/utils/facebook-auth-db.js');
jest.mock('axios');

import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';
import axiosModule from 'axios';

const { fbAccountsRouter } = await import('../backend/routes/fb-accounts.js');

const app = express();
app.use(express.json());
app.use('/api/fb-accounts', fbAccountsRouter);

beforeEach(() => {
  jest.clearAllMocks();
  FacebookAuthDB.listSystemUserTokens = jest.fn();
  FacebookAuthDB.saveSystemUserToken = jest.fn();
  FacebookAuthDB.deleteSystemUserToken = jest.fn();
  axiosModule.get = jest.fn();
});

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
