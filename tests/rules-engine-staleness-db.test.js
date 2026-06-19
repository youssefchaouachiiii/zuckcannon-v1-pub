// tests/rules-engine-staleness-db.test.js
// DB-layer tests for the staleness-guard max-date helpers. Runs against the
// real local SQLite (no network) — seeds rows at dates relative to "now" so the
// `date >= date('now', '-N days')` window logic is exercised exactly as in prod.
import { RulesEngineDB } from '../backend/db/rules-engine-db.js';

const isoDaysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
};

describe('RulesEngineDB - daily max-date (staleness signal)', () => {
  afterEach(async () => {
    await RulesEngineDB._db.runAsync('DELETE FROM redtrack_daily');
    await RulesEngineDB._db.runAsync('DELETE FROM fb_daily');
  });

  it('getRtDailyByIdMaxDate returns the freshest date in the window (yesterday)', async () => {
    await RulesEngineDB.upsertRtDaily('Stale Camp', isoDaysAgo(2), { revenue: 100, profit: 20, conversions: 2, cost: 80, campaign_id: 'c_stale' });
    await RulesEngineDB.upsertRtDaily('Stale Camp', isoDaysAgo(1), { revenue: 200, profit: 40, conversions: 4, cost: 160, campaign_id: 'c_stale' });
    const max = await RulesEngineDB.getRtDailyByIdMaxDate('c_stale', 'stale camp', 3);
    expect(max).toBe(isoDaysAgo(1)); // newest = yesterday
  });

  it('getRtDailyByIdMaxDate returns an OLD max when sync is broken (3 days stale)', async () => {
    await RulesEngineDB.upsertRtDaily('Frozen Camp', isoDaysAgo(3), { revenue: 100, profit: 20, conversions: 2, cost: 80, campaign_id: 'c_frozen' });
    const max = await RulesEngineDB.getRtDailyByIdMaxDate('c_frozen', 'frozen camp', 7);
    expect(max).toBe(isoDaysAgo(3));
  });

  it('getRtDailyByIdMaxDate returns null when no rows in window', async () => {
    const max = await RulesEngineDB.getRtDailyByIdMaxDate('c_missing', 'nope', 3);
    expect(max).toBeNull();
  });

  it('getRtDailyByIdMaxDate matches NULL-id rows by name (name fallback path)', async () => {
    // no campaign_id stamped, no snapshot to inherit from -> stays NULL-id
    await RulesEngineDB._db.runAsync(
      `INSERT INTO redtrack_daily (campaign_name, date, revenue, profit, conversions, cost, roi) VALUES ('Name Only', ?, 100, 20, 2, 80, 0.25)`,
      [isoDaysAgo(1)]
    );
    const max = await RulesEngineDB.getRtDailyByIdMaxDate('does_not_match_id', 'name only', 3);
    expect(max).toBe(isoDaysAgo(1));
  });

  it('getFbDailyMaxDate returns the freshest fb_daily date in the window', async () => {
    await RulesEngineDB.upsertFbDaily('camp_fb', 'campaign', isoDaysAgo(2), { spend: 200, conversions: 5, revenue: 250 });
    await RulesEngineDB.upsertFbDaily('camp_fb', 'campaign', isoDaysAgo(1), { spend: 300, conversions: 8, revenue: 380 });
    const max = await RulesEngineDB.getFbDailyMaxDate('camp_fb', 3);
    expect(max).toBe(isoDaysAgo(1));
  });

  it('getFbDailyMaxDate returns null when no rows in window', async () => {
    const max = await RulesEngineDB.getFbDailyMaxDate('camp_none', 3);
    expect(max).toBeNull();
  });

  it('max-date respects the day window (a row OUTSIDE the window is excluded)', async () => {
    // 10 days ago is outside a 3-day window
    await RulesEngineDB.upsertFbDaily('camp_old', 'campaign', isoDaysAgo(10), { spend: 50, conversions: 1, revenue: 60 });
    const max3 = await RulesEngineDB.getFbDailyMaxDate('camp_old', 3);
    expect(max3).toBeNull();
    const max14 = await RulesEngineDB.getFbDailyMaxDate('camp_old', 14);
    expect(max14).toBe(isoDaysAgo(10));
  });
});
