import { describe, test, expect, afterEach } from '@jest/globals';
import { RulesEngineDB } from '../backend/db/rules-engine-db.js';

describe('fb_native_rules', () => {
  afterEach(async () => {
    await RulesEngineDB.deleteFbNativeRule?.('test_meta_1');
    await RulesEngineDB.deleteFbNativeRule?.('prune_A');
    await RulesEngineDB.deleteFbNativeRule?.('prune_B');
  });

  test('pruneFbNativeRulesForAccount removes only rules no longer on FB', async () => {
    const base = (id) => ({
      meta_rule_id: id, account_id: 'acct_prune', bm_id: 'bm1', bm_name: 'Sigma 2',
      name: id, status: 'ENABLED', action_summary: 'Turn off', condition_summary: 'No condition',
      schedule_summary: 'Default', applied_to_json: '{}', created_by: 'x', raw_json: '{}',
    });
    await RulesEngineDB.upsertFbNativeRule(base('prune_A'));
    await RulesEngineDB.upsertFbNativeRule(base('prune_B'));
    expect((await RulesEngineDB.listFbNativeRulesByAccount('acct_prune')).length).toBe(2);

    // FB now returns only prune_A → prune_B must be pruned, prune_A kept.
    await RulesEngineDB.pruneFbNativeRulesForAccount('acct_prune', ['prune_A']);
    const after = await RulesEngineDB.listFbNativeRulesByAccount('acct_prune');
    expect(after.map(r => r.meta_rule_id)).toEqual(['prune_A']);

    // empty keep-list => account fully cleared.
    await RulesEngineDB.pruneFbNativeRulesForAccount('acct_prune', []);
    expect((await RulesEngineDB.listFbNativeRulesByAccount('acct_prune')).length).toBe(0);

    // prune must NOT touch other accounts.
    await RulesEngineDB.upsertFbNativeRule({ ...base('test_meta_1'), account_id: '999' });
    await RulesEngineDB.pruneFbNativeRulesForAccount('acct_prune', []);
    expect(await RulesEngineDB.getFbNativeRule('test_meta_1')).toBeTruthy();
  });

  test('upsert then read back by account and by id', async () => {
    await RulesEngineDB.upsertFbNativeRule({
      meta_rule_id: 'test_meta_1', account_id: '101', bm_id: 'bm1', bm_name: 'Sigma 2',
      name: 'Turn off 9pm', status: 'ENABLED', action_summary: 'Turn off',
      condition_summary: 'No condition', schedule_summary: 'Custom schedule',
      applied_to_json: JSON.stringify({ entity_type: 'CAMPAIGN', count: 1 }),
      created_by: 'Youssef', raw_json: '{}',
    });
    const byId = await RulesEngineDB.getFbNativeRule('test_meta_1');
    expect(byId.name).toBe('Turn off 9pm');
    expect(byId.status).toBe('ENABLED');
    expect(byId.synced_at).toBeTruthy();

    const byAcct = await RulesEngineDB.listFbNativeRulesByAccount('101');
    expect(byAcct.some(r => r.meta_rule_id === 'test_meta_1')).toBe(true);

    // upsert updates status in place (no duplicate row)
    await RulesEngineDB.upsertFbNativeRule({
      meta_rule_id: 'test_meta_1', account_id: '101', bm_id: 'bm1', bm_name: 'Sigma 2',
      name: 'Turn off 9pm', status: 'DISABLED', action_summary: 'Turn off',
      condition_summary: 'No condition', schedule_summary: 'Custom schedule',
      applied_to_json: JSON.stringify({ entity_type: 'CAMPAIGN', count: 1 }),
      created_by: 'Youssef', raw_json: '{}',
    });
    const updated = await RulesEngineDB.getFbNativeRule('test_meta_1');
    expect(updated.status).toBe('DISABLED');
    const all = (await RulesEngineDB.listAllFbNativeRules()).filter(r => r.meta_rule_id === 'test_meta_1');
    expect(all.length).toBe(1);
  });
});
