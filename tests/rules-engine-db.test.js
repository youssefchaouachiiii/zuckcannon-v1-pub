// tests/rules-engine-db.test.js
import { RulesEngineDB } from '../backend/db/rules-engine-db.js';

describe('RulesEngineDB - rules', () => {
  let ruleId;

  afterEach(async () => {
    if (ruleId) await RulesEngineDB.deleteRule(ruleId);
  });

  test('createRule saves and returns a rule', async () => {
    const rule = await RulesEngineDB.createRule({
      name: 'Spend Cap Test',
      scope: 'campaign',
      conditions_json: JSON.stringify([{ metric: 'spend_today', operator: 'gt', value: 300, lookback: 'today' }]),
      action: 'pause',
      action_params_json: null,
      cooldown_hours: 4,
      is_active: 1,
      is_dry_run: 0,
    });
    ruleId = rule.id;
    expect(rule.name).toBe('Spend Cap Test');
    expect(rule.scope).toBe('campaign');
  });

  test('getRuleById returns null for missing rule', async () => {
    const rule = await RulesEngineDB.getRuleById(99999);
    expect(rule).toBeNull();
  });

  test('listActiveRules returns only active rules', async () => {
    const rule = await RulesEngineDB.createRule({
      name: 'Active Rule', scope: 'campaign',
      conditions_json: '[]', action: 'pause',
      action_params_json: null, cooldown_hours: 1,
      is_active: 1, is_dry_run: 0,
    });
    ruleId = rule.id;
    const active = await RulesEngineDB.listActiveRules();
    expect(active.some(r => r.id === rule.id)).toBe(true);
  });
});

describe('RulesEngineDB - exemptions', () => {
  test('isExempt returns true during snooze period', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    await RulesEngineDB.setExemption(1, 'entity_123', 'snooze', future);
    const exempt = await RulesEngineDB.isExempt(1, 'entity_123');
    expect(exempt).toBe(true);
    await RulesEngineDB.clearExemption(1, 'entity_123');
  });

  test('isExempt returns false after exemption expires', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await RulesEngineDB.setExemption(1, 'entity_456', 'cooldown', past);
    const exempt = await RulesEngineDB.isExempt(1, 'entity_456');
    expect(exempt).toBe(false);
    await RulesEngineDB.clearExemption(1, 'entity_456');
  });
});

describe('RulesEngineDB - snapshots + pause-pending', () => {
  it('saves and retrieves spend snapshots', async () => {
    await RulesEngineDB.saveSpendSnapshot('camp_1', 'campaign', 42.5);
    const snaps = await RulesEngineDB.getSpendSnapshots('camp_1', 60);
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    expect(snaps.find(s => s.spend === 42.5)).toBeTruthy();
  });

  it('sets and checks pause-pending', async () => {
    await RulesEngineDB.setPausePending(1, 'camp_pp_test');
    const pending = await RulesEngineDB.isPausePending(1, 'camp_pp_test');
    expect(pending).toBe(true);
    await RulesEngineDB.clearPausePending(1, 'camp_pp_test');
    const cleared = await RulesEngineDB.isPausePending(1, 'camp_pp_test');
    expect(cleared).toBe(false);
  });
});
