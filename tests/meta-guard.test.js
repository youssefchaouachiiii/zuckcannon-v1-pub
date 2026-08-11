import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  WINDOW_MS, MetaGuardError,
  isKillSwitchOn, killSwitchReason, engageKillSwitch, releaseKillSwitch,
  isNodeUpdate, assertNoBudgetChange, accountFromUrl, recentCalls, consumeRateSlot,
  isMetaWrite, guardMetaWrite, metaGuardRequestInterceptor, maxCallsPerHour, markBudgetDecrease,
} from '../backend/utils/meta-guard.js';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-guard-'));
  process.env.ZUCKCANNON_KILL_SWITCH = path.join(dir, 'KILL');
  process.env.ZUCKCANNON_RATE_WINDOW = path.join(dir, 'rate.json');
});

afterEach(() => {
  delete process.env.ZUCKCANNON_KILL_SWITCH;
  delete process.env.ZUCKCANNON_RATE_WINDOW;
  fs.rmSync(dir, { recursive: true, force: true });
});

const GRAPH = 'https://graph.facebook.com/v25.0';

// --- 1. kill switch --------------------------------------------------------------

describe('kill switch', () => {
  test('is off until the file exists', () => {
    expect(isKillSwitchOn()).toBe(false);
  });

  test('carries its reason through', () => {
    engageKillSwitch('act_99 throttled by Meta');
    expect(isKillSwitchOn()).toBe(true);
    expect(killSwitchReason()).toBe('act_99 throttled by Meta');
  });

  test('is read per call, so a flip lands on the next request not the next run', () => {
    expect(() => guardMetaWrite({ url: `${GRAPH}/act_1/campaigns`, method: 'POST' })).not.toThrow();
    engageKillSwitch();
    expect(() => guardMetaWrite({ url: `${GRAPH}/act_1/campaigns`, method: 'POST' }))
      .toThrow(/Kill switch is ON/);
    releaseKillSwitch();
    expect(() => guardMetaWrite({ url: `${GRAPH}/act_1/campaigns`, method: 'POST' })).not.toThrow();
  });

  test('release reports whether it was on', () => {
    expect(releaseKillSwitch()).toBe(false);
    engageKillSwitch();
    expect(releaseKillSwitch()).toBe(true);
  });

  test('does not block reads — the dashboard keeps working', () => {
    engageKillSwitch();
    expect(() => guardMetaWrite({ url: `${GRAPH}/act_1/campaigns`, method: 'GET' })).not.toThrow();
  });

  test('does not touch non-Meta requests', () => {
    engageKillSwitch();
    expect(() => guardMetaWrite({ url: 'https://www.googleapis.com/upload', method: 'POST' })).not.toThrow();
  });

  test('refuses before a rate slot is spent', () => {
    engageKillSwitch();
    expect(() => guardMetaWrite({ url: `${GRAPH}/act_1/ads`, method: 'POST' })).toThrow(MetaGuardError);
    expect(recentCalls('act_1')).toHaveLength(0);
  });
});

// --- 2. budget ban ---------------------------------------------------------------

describe('budget ban', () => {
  test('tells a node update apart from a collection create', () => {
    expect(isNodeUpdate(`${GRAPH}/120210000000`)).toBe(true);
    expect(isNodeUpdate(`${GRAPH}/act_123/campaigns`)).toBe(false);
    expect(isNodeUpdate(`${GRAPH}/act_123/adsets`)).toBe(false);
    expect(isNodeUpdate(`${GRAPH}/120210000000?fields=name`)).toBe(true);
  });

  test.each([
    'daily_budget', 'lifetime_budget', 'bid_amount', 'bid_strategy', 'budget_rebalance_flag',
  ])('blocks %s on a live entity', (field) => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/120210000000`, method: 'POST', data: { [field]: 5000 },
    })).toThrow(/Refusing to change/);
  });

  test('blocks a budget change sent as a form-encoded string', () => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/120210000000`, method: 'POST', data: 'daily_budget=5000&status=ACTIVE',
    })).toThrow(MetaGuardError);
  });

  test('blocks a budget change sent as URLSearchParams', () => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/120210000000`, method: 'POST',
      data: new URLSearchParams({ daily_budget: '5000' }),
    })).toThrow(MetaGuardError);
  });

  test('blocks a budget change smuggled in the query string', () => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/120210000000?daily_budget=5000`, method: 'POST', data: {},
    })).toThrow(MetaGuardError);
  });

  test('allows a budget when CREATING a campaign — that is setting the brake, not moving it', () => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/act_123/campaigns`, method: 'POST', data: { daily_budget: 5000, name: 'X' },
    })).not.toThrow();
  });

  test('allows a budget when creating an ad set', () => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/act_123/adsets`, method: 'POST', data: { daily_budget: 5000 },
    })).not.toThrow();
  });

  test('allows pausing a live entity — the safe direction stays open', () => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/120210000000`, method: 'POST', data: { status: 'PAUSED' },
    })).not.toThrow();
  });

  test('leaves spend_cap alone — the plan names it as the sanctioned lever', () => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/120210000000`, method: 'POST', data: { spend_cap: 10000 },
    })).not.toThrow();
  });

  test('ignores reads entirely', () => {
    expect(() => assertNoBudgetChange({
      url: `${GRAPH}/120210000000?fields=daily_budget`, method: 'GET',
    })).not.toThrow();
  });
});

// --- 2b. the one sanctioned exception: a verified decrease ------------------------

describe('verified budget decrease', () => {
  const node = `${GRAPH}/120210000000`;
  const decrease = (from, to, data) => assertNoBudgetChange({
    url: node, method: 'POST',
    data: data ?? { daily_budget: to },
    ...markBudgetDecrease({}, { fromCents: from, toCents: to }),
  });

  test('a genuine drop is allowed', () => {
    expect(() => decrease(10000, 5000)).not.toThrow();
  });

  test('a raise wearing a decrease marker is still refused', () => {
    // The marker is not a password. The interceptor redoes the comparison itself.
    expect(() => decrease(5000, 10000)).toThrow(/Refusing to change/);
  });

  test('an unchanged budget is refused — a decrease has to decrease', () => {
    expect(() => decrease(5000, 5000)).toThrow(MetaGuardError);
  });

  test('a payload that disagrees with the marker cannot ride along', () => {
    // Vouch for a drop to 5000, then actually send 99999.
    expect(() => decrease(10000, 5000, { daily_budget: 99999 })).toThrow(MetaGuardError);
  });

  test('a lifetime budget cannot ride along on a daily-budget decrease', () => {
    expect(() => decrease(10000, 5000, { daily_budget: 5000, lifetime_budget: 999999 }))
      .toThrow(MetaGuardError);
  });

  test('a bid cannot ride along either', () => {
    expect(() => decrease(10000, 5000, { daily_budget: 5000, bid_amount: 400 }))
      .toThrow(MetaGuardError);
  });

  test('a malformed marker is refused rather than trusted', () => {
    for (const marker of [{ fromCents: 'lots', toCents: 5000 }, { fromCents: 10000 }, {}, null]) {
      expect(() => assertNoBudgetChange({
        url: node, method: 'POST', data: { daily_budget: 5000 },
        __metaGuardBudgetDecrease: marker,
      })).toThrow(MetaGuardError);
    }
  });

  test('works through the form-encoded body the endpoint actually sends', () => {
    expect(() => assertNoBudgetChange({
      url: node, method: 'POST',
      data: new URLSearchParams({ daily_budget: '5000', access_token: 'T' }),
      ...markBudgetDecrease({}, { fromCents: 10000, toCents: 5000 }),
    })).not.toThrow();
  });

  test('the kill switch still wins over a verified decrease', () => {
    engageKillSwitch('everything off');
    expect(() => guardMetaWrite({
      url: node, method: 'POST', data: { daily_budget: 5000 },
      ...markBudgetDecrease({}, { fromCents: 10000, toCents: 5000 }),
    })).toThrow(/Kill switch is ON/);
  });
});

// --- 3. hourly cap ---------------------------------------------------------------

describe('hourly cap', () => {
  test('reads the account out of the url', () => {
    expect(accountFromUrl(`${GRAPH}/act_123456/campaigns`)).toBe('act_123456');
    expect(accountFromUrl(`${GRAPH}/120210000000`)).toBe('unresolved');
  });

  test('lets calls under the cap through', () => {
    for (let i = 0; i < 3; i++) consumeRateSlot('act_1', { maxCalls: 3 });
    expect(recentCalls('act_1')).toHaveLength(3);
  });

  test('refuses the call past the cap, with a time to the next slot', () => {
    const now = 1_000_000_000;
    consumeRateSlot('act_1', { maxCalls: 1, now });
    expect(() => consumeRateSlot('act_1', { maxCalls: 1, now: now + 1000 }))
      .toThrow(/cap is 1.*Next slot frees in/s);
  });

  test('counts per account, not globally', () => {
    consumeRateSlot('act_1', { maxCalls: 1 });
    expect(() => consumeRateSlot('act_2', { maxCalls: 1 })).not.toThrow();
    expect(() => consumeRateSlot('act_1', { maxCalls: 1 })).toThrow(MetaGuardError);
  });

  test('the count is on disk, so pm2 cluster workers share one window', () => {
    consumeRateSlot('act_1', { maxCalls: 2 });
    const onDisk = JSON.parse(fs.readFileSync(process.env.ZUCKCANNON_RATE_WINDOW, 'utf-8'));
    expect(onDisk.act_1).toHaveLength(1);
  });

  test('calls older than the window stop counting', () => {
    const now = 1_000_000_000;
    consumeRateSlot('act_1', { maxCalls: 1, now });
    expect(() => consumeRateSlot('act_1', { maxCalls: 1, now: now + WINDOW_MS + 1 })).not.toThrow();
  });

  test('prunes stale accounts out of the file', () => {
    const now = 1_000_000_000;
    consumeRateSlot('act_old', { maxCalls: 5, now });
    consumeRateSlot('act_new', { maxCalls: 5, now: now + WINDOW_MS + 1 });
    const onDisk = JSON.parse(fs.readFileSync(process.env.ZUCKCANNON_RATE_WINDOW, 'utf-8'));
    expect(Object.keys(onDisk)).toEqual(['act_new']);
  });

  test('a cap of zero disables it', () => {
    for (let i = 0; i < 50; i++) consumeRateSlot('act_1', { maxCalls: 0 });
    expect(fs.existsSync(process.env.ZUCKCANNON_RATE_WINDOW)).toBe(false);
  });

  test('the ceiling is read per call, so it can be changed without a restart', () => {
    // Caught end-to-end, not here: the first version read the env once at module load, so
    // raising or lowering the cap on a hammered account meant restarting the server.
    const original = process.env.META_MAX_CALLS_PER_HOUR;
    try {
      process.env.META_MAX_CALLS_PER_HOUR = '2';
      expect(maxCallsPerHour()).toBe(2);
      consumeRateSlot('act_1');
      consumeRateSlot('act_1');
      expect(() => consumeRateSlot('act_1')).toThrow(/cap is 2/);

      process.env.META_MAX_CALLS_PER_HOUR = '5';
      expect(() => consumeRateSlot('act_1')).not.toThrow();
    } finally {
      if (original === undefined) delete process.env.META_MAX_CALLS_PER_HOUR;
      else process.env.META_MAX_CALLS_PER_HOUR = original;
    }
  });

  test('falls back to 150 with no env set', () => {
    const original = process.env.META_MAX_CALLS_PER_HOUR;
    delete process.env.META_MAX_CALLS_PER_HOUR;
    try {
      expect(maxCallsPerHour()).toBe(150);
    } finally {
      if (original !== undefined) process.env.META_MAX_CALLS_PER_HOUR = original;
    }
  });
});

// --- wiring ----------------------------------------------------------------------

describe('the axios interceptor', () => {
  test('recognises a Meta write and ignores everything else', () => {
    expect(isMetaWrite({ url: `${GRAPH}/act_1/ads`, method: 'post' })).toBe(true);
    expect(isMetaWrite({ url: `${GRAPH}/act_1/ads`, method: 'get' })).toBe(false);
    expect(isMetaWrite({ url: 'https://www.googleapis.com/x', method: 'post' })).toBe(false);
  });

  test('passes a clean config straight through', () => {
    const config = { url: `${GRAPH}/act_1/ads`, method: 'post', data: { name: 'x' } };
    expect(metaGuardRequestInterceptor(config)).toBe(config);
  });

  test('throws on a budget change, so axios never sends it', () => {
    expect(() => metaGuardRequestInterceptor({
      url: `${GRAPH}/120210000000`, method: 'post', data: { daily_budget: 9999 },
    })).toThrow(MetaGuardError);
  });

  test('throws while the kill switch is on', () => {
    engageKillSwitch('deploy in progress');
    expect(() => metaGuardRequestInterceptor({ url: `${GRAPH}/act_1/ads`, method: 'post' }))
      .toThrow(/deploy in progress/);
  });
});
