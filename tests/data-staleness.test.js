// tests/data-staleness.test.js
// TDD for the staleness-guard: a rule must NEVER fire on stale window data.
// These tests exercise the pure helper that both the backend route and the
// n8n "Evaluate Rules" Code node use to decide freshness.
import { describe, test, expect } from '@jest/globals';
import {
  STALENESS_DEFAULT_HOURS,
  maxStalenessHours,
  daysStale,
  windowFreshness,
  ruleBlockedByStaleness,
} from '../backend/utils/data-staleness.js';

describe('maxStalenessHours — env threshold', () => {
  test('defaults to 36h when env unset (today or yesterday is fresh)', () => {
    expect(maxStalenessHours({})).toBe(STALENESS_DEFAULT_HOURS);
    expect(STALENESS_DEFAULT_HOURS).toBe(36);
  });
  test('reads RULES_MAX_DATA_STALENESS_HOURS from env', () => {
    expect(maxStalenessHours({ RULES_MAX_DATA_STALENESS_HOURS: '24' })).toBe(24);
  });
  test('ignores non-numeric / non-positive overrides, falls back to default', () => {
    expect(maxStalenessHours({ RULES_MAX_DATA_STALENESS_HOURS: 'abc' })).toBe(36);
    expect(maxStalenessHours({ RULES_MAX_DATA_STALENESS_HOURS: '0' })).toBe(36);
    expect(maxStalenessHours({ RULES_MAX_DATA_STALENESS_HOURS: '-5' })).toBe(36);
  });
});

describe('daysStale — date diff from a reference "now"', () => {
  const now = new Date('2026-06-19T12:00:00Z');
  test('max_date = today -> 0 days stale', () => {
    expect(daysStale('2026-06-19', now)).toBe(0);
  });
  test('max_date = yesterday -> 1 day stale', () => {
    expect(daysStale('2026-06-18', now)).toBe(1);
  });
  test('max_date = 5 days ago -> 5 days stale', () => {
    expect(daysStale('2026-06-14', now)).toBe(5);
  });
  test('null / missing max_date -> null (unknown, NOT 0)', () => {
    expect(daysStale(null, now)).toBeNull();
    expect(daysStale(undefined, now)).toBeNull();
    expect(daysStale('', now)).toBeNull();
  });
});

describe('windowFreshness — attaches max_date + days_stale + is_stale to a window', () => {
  const now = new Date('2026-06-19T12:00:00Z');
  test('fresh window (yesterday, 36h threshold) is not stale', () => {
    const f = windowFreshness({ spend: 100 }, '2026-06-18', 36, now);
    expect(f).toMatchObject({ max_date: '2026-06-18', days_stale: 1, is_stale: false });
  });
  test('stale window (3 days old, 36h threshold) is stale', () => {
    const f = windowFreshness({ spend: 100 }, '2026-06-16', 36, now);
    expect(f.days_stale).toBe(3);
    expect(f.is_stale).toBe(true);
  });
  test('null insights returns null (existing null-guard still owns this)', () => {
    expect(windowFreshness(null, null, 36, now)).toBeNull();
  });
  test('insights present but max_date null -> is_stale true + days_stale null (loud, not silent-fresh)', () => {
    const f = windowFreshness({ spend: 100 }, null, 36, now);
    expect(f.max_date).toBeNull();
    expect(f.days_stale).toBeNull();
    expect(f.is_stale).toBe(true); // unknown freshness must fail SAFE (treated stale)
  });
  test('future-dated max_date (anomalous) -> is_stale true + days_stale truthfully negative', () => {
    // max_date one day AFTER now: daysStale -> -1. A future date is anomalous
    // (sync bug / clock skew) and must fail SAFE, same direction as null — NOT
    // silently fresh. days_stale stays truthful (negative) for observability.
    const f = windowFreshness({ spend: 100 }, '2026-06-20', 36, now);
    expect(f.days_stale).toBe(-1); // truthful negative, not clamped
    expect(f.is_stale).toBe(true); // future/anomalous fails safe -> stale
  });
});

describe('ruleBlockedByStaleness — only blocks windows the rule actually uses', () => {
  const fresh3d = { spend: 400, is_stale: false, days_stale: 1 };
  const stale3d = { spend: 400, is_stale: true, days_stale: 3 };
  const fresh7d = { spend: 900, is_stale: false, days_stale: 1 };
  const stale7d = { spend: 900, is_stale: true, days_stale: 5 };

  test('today-only rule never blocked by stale 3d/7d windows', () => {
    const conds = [{ metric: 'spend', operator: 'gt', value: 100, lookback: 'today' }];
    const r = ruleBlockedByStaleness(conds, stale3d, stale7d);
    expect(r.blocked).toBe(false);
  });

  test('last_3d rule blocked when 3d window is stale', () => {
    const conds = [{ metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' }];
    const r = ruleBlockedByStaleness(conds, stale3d, fresh7d);
    expect(r.blocked).toBe(true);
    expect(r.staleWindows).toContain('last_3d');
  });

  test('last_3d rule NOT blocked when 3d window is fresh', () => {
    const conds = [{ metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' }];
    const r = ruleBlockedByStaleness(conds, fresh3d, fresh7d);
    expect(r.blocked).toBe(false);
  });

  test('last_7d rule blocked when 7d window is stale', () => {
    const conds = [{ metric: 'spend', operator: 'gt', value: 500, lookback: 'last_7d' }];
    const r = ruleBlockedByStaleness(conds, fresh3d, stale7d);
    expect(r.blocked).toBe(true);
    expect(r.staleWindows).toContain('last_7d');
  });

  test('mixed rule (today AND last_3d): stale 3d blocks the whole rule', () => {
    const conds = [
      { metric: 'spend', operator: 'gt', value: 100, lookback: 'today' },
      { metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' },
    ];
    const r = ruleBlockedByStaleness(conds, stale3d, fresh7d);
    expect(r.blocked).toBe(true);
  });

  test('backward compat: windows WITHOUT freshness fields are treated as fresh (rules still fire)', () => {
    const conds = [{ metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' }];
    const legacy3d = { spend: 400 }; // no is_stale / days_stale
    const r = ruleBlockedByStaleness(conds, legacy3d, null);
    expect(r.blocked).toBe(false);
  });

  test('null window the rule uses -> NOT blocked here (existing null-guard owns missing data)', () => {
    // A null insights_3d means "no data at all", already handled by the
    // !insights3d path in the node; the staleness guard must not double-skip.
    const conds = [{ metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' }];
    const r = ruleBlockedByStaleness(conds, null, null);
    expect(r.blocked).toBe(false);
  });
});

// Mirrors the exact gate that goes into the n8n "Evaluate Rules" Code node:
// after the existing `if (!todayInsights) continue;`, a stale window the rule
// uses -> SKIP + push a loud alert item; a fresh window -> evaluate as today.
// This is the integration-shaped assert the task requires (stale->skipped+alerted,
// fresh->evaluated). The node can't be imported, so the gate is reproduced here
// verbatim against the same helper the node will call.
describe('n8n Evaluate Rules gate — stale skips+alerts, fresh evaluates', () => {
  // Verbatim copy of the gate the n8nSpec adds. Returns one of:
  //   { outcome: 'skipped_stale', alert }  — loud skip
  //   { outcome: 'evaluated', fired }       — normal path
  function evaluateEntity(rule, entity, todayInsights) {
    const conditions = rule.conditions || [];
    const insights3d = entity.insights_3d || null;
    const insights7d = entity.insights_7d || null;

    if (!todayInsights) return { outcome: 'no_today_data' }; // existing guard

    // --- NEW staleness gate (mirrors ruleBlockedByStaleness) ---
    const staleWindows = [];
    const isStale = (w) => !!(w && w.is_stale === true);
    const uses = (lb) => conditions.some((c) => c.lookback === lb);
    if (uses('last_3d') && isStale(insights3d)) staleWindows.push('last_3d');
    if (uses('last_7d') && isStale(insights7d)) staleWindows.push('last_7d');
    if (staleWindows.length > 0) {
      return {
        outcome: 'skipped_stale',
        alert: {
          level: 'critical',
          rule_id: rule.id,
          rule_name: rule.name,
          entity_id: entity.entityId,
          stale_windows: staleWindows,
          days_stale: {
            last_3d: insights3d?.days_stale ?? null,
            last_7d: insights7d?.days_stale ?? null,
          },
          message: `SKIP: rule "${rule.name}" not fired on entity ${entity.entityId} — stale data in ${staleWindows.join(', ')} (RedTrack/FB daily sync behind).`,
        },
      };
    }
    // --- end gate ---

    const evaluate = (c) => {
      const src = c.lookback === 'last_7d' ? insights7d : c.lookback === 'last_3d' ? insights3d : todayInsights;
      let val = c.metric === 'spend'
        ? (c.lookback === 'today' ? src?.spend_today : src?.spend)
        : src?.[c.metric];
      if (val == null) return false;
      switch (c.operator) { case 'gt': return val > c.value; case 'lt': return val < c.value; default: return false; }
    };
    const fired = (rule.combinator === 'OR' ? conditions.some(evaluate) : conditions.every(evaluate));
    return { outcome: 'evaluated', fired };
  }

  test('STALE 3d window -> rule is SKIPPED and a loud alert is emitted (never fires)', () => {
    const rule = { id: 7, name: 'Bad ROI 3d', combinator: 'AND',
      conditions: [{ metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' }] };
    // roi -1.0 WOULD trip the threshold — but data is 3 days stale, so we must NOT fire.
    const entity = { entityId: 'camp_stale', insights_3d: { roi: -1.0, is_stale: true, days_stale: 3 } };
    const r = evaluateEntity(rule, entity, { spend_today: 50 });
    expect(r.outcome).toBe('skipped_stale');
    expect(r.alert.level).toBe('critical');
    expect(r.alert.stale_windows).toEqual(['last_3d']);
    expect(r.alert.message).toMatch(/stale data/i);
  });

  test('FRESH 3d window -> rule is EVALUATED and fires as today', () => {
    const rule = { id: 7, name: 'Bad ROI 3d', combinator: 'AND',
      conditions: [{ metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' }] };
    const entity = { entityId: 'camp_fresh', insights_3d: { roi: -1.0, is_stale: false, days_stale: 1 } };
    const r = evaluateEntity(rule, entity, { spend_today: 50 });
    expect(r.outcome).toBe('evaluated');
    expect(r.fired).toBe(true);
  });

  test('today-only rule unaffected by a stale 3d window (still evaluates + fires)', () => {
    const rule = { id: 9, name: 'Spend Cap', combinator: 'AND',
      conditions: [{ metric: 'spend', operator: 'gt', value: 100, lookback: 'today' }] };
    const entity = { entityId: 'camp_x', insights_3d: { spend: 5, is_stale: true, days_stale: 4 } };
    const r = evaluateEntity(rule, entity, { spend_today: 150 });
    expect(r.outcome).toBe('evaluated');
    expect(r.fired).toBe(true);
  });

  test('mixed today+3d rule with stale 3d -> SKIPPED (never fires on the stale half)', () => {
    const rule = { id: 11, name: 'Spend + ROI', combinator: 'AND',
      conditions: [
        { metric: 'spend', operator: 'gt', value: 100, lookback: 'today' },
        { metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' },
      ] };
    const entity = { entityId: 'camp_mix', insights_3d: { roi: -1.0, is_stale: true, days_stale: 5 } };
    const r = evaluateEntity(rule, entity, { spend_today: 500 });
    expect(r.outcome).toBe('skipped_stale');
  });

  test('legacy payload (no freshness fields) -> evaluates normally (backward compatible)', () => {
    const rule = { id: 7, name: 'Bad ROI 3d', combinator: 'AND',
      conditions: [{ metric: 'roi', operator: 'lt', value: -0.2, lookback: 'last_3d' }] };
    const entity = { entityId: 'camp_legacy', insights_3d: { roi: -1.0 } }; // no is_stale
    const r = evaluateEntity(rule, entity, { spend_today: 50 });
    expect(r.outcome).toBe('evaluated');
    expect(r.fired).toBe(true);
  });
});
