import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

jest.mock('../backend/db/rules-engine-db.js');
jest.mock('../backend/utils/facebook-auth-db.js');

import { RulesEngineDB } from '../backend/db/rules-engine-db.js';
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

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
  FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([]);
  FacebookAuthDB.getExpiringTokens = jest.fn().mockResolvedValue([]);
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

describe('GET /active-rules includes insights_3d and insights_7d', () => {
  it('each entity has insights_3d and insights_7d fields', async () => {
    const res = await request(app)
      .get('/api/rules-engine/active-rules')
      .set('x-n8n-secret', process.env.N8N_SHARED_SECRET || 'test-secret');
    expect(res.status).toBe(200);
    if (res.body.length > 0 && res.body[0].entities?.length > 0) {
      const e = res.body[0].entities[0];
      expect(e).toHaveProperty('insights_3d');
      expect(e).toHaveProperty('insights_7d');
    }
  });
});
