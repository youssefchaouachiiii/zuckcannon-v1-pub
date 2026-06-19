// tests/fb-rules-routes.test.js
import { describe, test, expect, jest, afterEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { rulesEngineUiRouter } from '../backend/routes/rules-engine-ui.js';
import { fbRulesSync as sync } from '../backend/utils/fb-rules-sync.js';
import { RulesEngineDB } from '../backend/db/rules-engine-db.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/rules-engine/ui', rulesEngineUiRouter);
  return a;
}

afterEach(() => jest.restoreAllMocks());

describe('fb-rules routes', () => {
  test('GET /fb-rules returns mirror rows', async () => {
    jest.spyOn(RulesEngineDB, 'listAllFbNativeRules').mockResolvedValue([{ meta_rule_id: 'r1', name: 'X', synced_at: '2026-06-20 00:00:00' }]);
    const res = await request(app()).get('/api/rules-engine/ui/fb-rules');
    expect(res.status).toBe(200);
    expect(res.body.rules[0].meta_rule_id).toBe('r1');
  });

  test('PATCH status → 403 with code when no system user', async () => {
    jest.spyOn(RulesEngineDB, 'getFbNativeRule').mockResolvedValue({ meta_rule_id: 'r1', account_id: '101' });
    const err = new Error('no su'); err.code = 'no_system_user';
    jest.spyOn(sync, 'setFbRuleStatus').mockRejectedValue(err);
    const res = await request(app()).patch('/api/rules-engine/ui/fb-rules/r1/status').send({ enabled: false });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('no_system_user');
  });

  test('PATCH status → 200 on success and updates mirror', async () => {
    jest.spyOn(RulesEngineDB, 'getFbNativeRule').mockResolvedValue({ meta_rule_id: 'r1', account_id: '101' });
    jest.spyOn(sync, 'setFbRuleStatus').mockResolvedValue({ status: 'DISABLED' });
    const up = jest.spyOn(RulesEngineDB, 'upsertFbNativeRule').mockResolvedValue();
    const res = await request(app()).patch('/api/rules-engine/ui/fb-rules/r1/status').send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISABLED');
    expect(up).toHaveBeenCalled();
  });

  test('POST /fb-rules/sync → 403 with code when no system user', async () => {
    const err = new Error('no su'); err.code = 'no_system_user';
    jest.spyOn(sync, 'syncFbRulesForAccount').mockRejectedValue(err);
    const res = await request(app()).post('/api/rules-engine/ui/fb-rules/sync').send({ account_id: '101' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('no_system_user');
  });

  test('POST /fb-rules/sync → 200 happy path (syncAllFbRules)', async () => {
    jest.spyOn(sync, 'syncAllFbRules').mockResolvedValue({ synced: [{ account_id: '101', count: 2 }], errors: [] });
    const res = await request(app()).post('/api/rules-engine/ui/fb-rules/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body.synced.length).toBe(1);
    expect(res.body.errors.length).toBe(0);
  });
});
