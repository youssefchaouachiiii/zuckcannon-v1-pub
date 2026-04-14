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
  FacebookAuthDB.listSystemUserTokens = jest.fn().mockResolvedValue([]);
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
    expect(res.body[0].entities).toEqual(['camp_123', 'camp_456']);
    expect(res.body[0].token).toBe('SYS_TOKEN');
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
