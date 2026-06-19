// backend/utils/data-staleness.js
//
// Staleness guard for the rules engine. The daily tables (redtrack_daily,
// fb_daily) carry only a `date` TEXT column (YYYY-MM-DD) with no sync
// timestamp, so freshness can only be derived from max(date) vs "now".
//
// RedTrack daily is synced 1x/day; if the sync runs late (e.g. 11pm ET) and a
// rule cycle runs early next morning, the freshest row is "yesterday" — that is
// NORMAL and must count as fresh. Anything older than the threshold means the
// sync is broken (the known failure mode: a 502 froze "Daily Sync" and rules
// kept firing last_3d on a single stale day). On stale data we SKIP + alert,
// never fire.
//
// Fail-safe direction: better to skip-and-alert than fire-on-stale. But a
// missing/null max_date must NOT silently disable rules forever — it is treated
// as stale (is_stale: true) so the caller skips loudly, and the existing
// null-insights guard still owns the "no data at all" case.
//
// This module is the single source of truth; the n8n "Evaluate Rules" Code node
// mirrors `ruleBlockedByStaleness` verbatim (it cannot import from the repo).

// Default tied to the 1x/day RedTrack sync cadence: 36h = "today or yesterday is
// fresh, 2+ days old is stale". One day of slack absorbs a late nightly sync.
export const STALENESS_DEFAULT_HOURS = 36;

const MS_PER_DAY = 86400000;

// Resolve the configured staleness threshold (hours). Invalid / non-positive
// overrides fall back to the default so a typo can't silently disable the guard.
export function maxStalenessHours(env = process.env) {
  const raw = env?.RULES_MAX_DATA_STALENESS_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : STALENESS_DEFAULT_HOURS;
}

// Whole days between a YYYY-MM-DD max_date and a reference "now" (default: real
// now). UTC-midnight floored on both sides so DST / wall-clock time never shifts
// the count. Returns null for a missing/blank date (unknown, NOT zero).
export function daysStale(maxDate, now = new Date()) {
  if (!maxDate) return null;
  const d = new Date(`${maxDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.round((today.getTime() - d.getTime()) / MS_PER_DAY);
}

// Attach freshness metadata to a window's merged insights object. Returns null
// when insights are null (the existing null-guard owns the "no data" case).
// A present window with a null max_date is marked is_stale:true (fail-safe).
// A future-dated max_date (negative days_stale, e.g. sync bug / clock skew) is
// anomalous and also marked is_stale:true — same fail-safe direction as null.
// days_stale always reports the TRUE value (including negative) for observability.
export function windowFreshness(insights, maxDate, thresholdHours = STALENESS_DEFAULT_HOURS, now = new Date()) {
  if (!insights) return null;
  const ds = daysStale(maxDate, now);
  const maxDays = thresholdHours / 24;
  // Unknown (null) or future/negative freshness fails safe -> stale.
  const is_stale = (ds == null || ds < 0) ? true : ds > maxDays;
  return { ...insights, max_date: maxDate ?? null, days_stale: ds, is_stale };
}

// Decide whether a rule must be SKIPPED because a window it actually conditions
// on is stale. Only blocks for lookbacks the rule uses (today-only rules are
// never blocked by stale 3d/7d windows). Backward compatible: a window without
// freshness fields (legacy payload) is treated as fresh so existing rules fire.
// A null window is NOT blocked here — "no data" is the existing null-guard's job.
export function ruleBlockedByStaleness(conditions, insights3d, insights7d) {
  const conds = conditions || [];
  const staleWindows = [];
  const isStale = (w) => !!(w && w.is_stale === true); // legacy/no-field => false
  const uses = (lb) => conds.some((c) => c.lookback === lb);

  if (uses('last_3d') && isStale(insights3d)) staleWindows.push('last_3d');
  if (uses('last_7d') && isStale(insights7d)) staleWindows.push('last_7d');

  return { blocked: staleWindows.length > 0, staleWindows };
}
