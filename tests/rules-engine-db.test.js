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

describe('RulesEngineDB - daily snapshots', () => {
  afterEach(async () => {
    await RulesEngineDB._db.runAsync('DELETE FROM redtrack_daily');
    await RulesEngineDB._db.runAsync('DELETE FROM fb_daily');
  });

  it('upsertRtDaily stores and updates a row (no double-count on re-upsert)', async () => {
    await RulesEngineDB.upsertRtDaily('Banner - EDU', '2026-04-22', {
      revenue: 500, profit: 120, conversions: 10, cost: 380,
    });
    await RulesEngineDB.upsertRtDaily('Banner - EDU', '2026-04-22', {
      revenue: 600, profit: 150, conversions: 12, cost: 450,
    });
    const row = await RulesEngineDB.getRtDailyWindow('Banner - EDU', 3);
    expect(row.revenue).toBeCloseTo(600); // upsert updated, not doubled
    expect(row.conversions).toBeCloseTo(12);
  });

  it('getRtDailyWindow sums rows within window', async () => {
    await RulesEngineDB.upsertRtDaily('Camp A', '2026-04-21', { revenue: 400, profit: 80, conversions: 8, cost: 320 });
    await RulesEngineDB.upsertRtDaily('Camp A', '2026-04-22', { revenue: 600, profit: 120, conversions: 12, cost: 480 });
    const row3d = await RulesEngineDB.getRtDailyWindow('Camp A', 3);
    expect(row3d.revenue).toBeCloseTo(1000);
    expect(row3d.conversions).toBeCloseTo(20);
    expect(row3d.roi).toBeCloseTo(0.25, 2); // profit 200 / cost 800
  });

  it('upsertFbDaily stores and getFbDailyWindow sums', async () => {
    await RulesEngineDB.upsertFbDaily('camp_123', 'campaign', '2026-04-21', { spend: 200, conversions: 5, revenue: 250 });
    await RulesEngineDB.upsertFbDaily('camp_123', 'campaign', '2026-04-22', { spend: 300, conversions: 8, revenue: 380 });
    const row = await RulesEngineDB.getFbDailyWindow('camp_123', 3);
    expect(row.spend).toBeCloseTo(500);
    expect(row.conversions).toBeCloseTo(13);
    expect(row.cpa).toBeCloseTo(500 / 13, 2);
  });

  it('pruneDaily removes rows older than keepDays', async () => {
    await RulesEngineDB._db.runAsync(
      `INSERT INTO redtrack_daily (campaign_name, date, revenue, profit, conversions, cost, roi) VALUES ('Old Camp', '2020-01-01', 100, 20, 2, 80, 0.25)`
    );
    await RulesEngineDB.pruneDaily(30);
    const row = await RulesEngineDB._db.getAsync(`SELECT * FROM redtrack_daily WHERE campaign_name='Old Camp'`);
    expect(row).toBeUndefined();
  });
});
