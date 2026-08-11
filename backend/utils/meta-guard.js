/**
 * Meta Guard — the SGP Project 6 rails, applied to every Meta write this server makes.
 *
 * These sit in an axios request interceptor rather than at each call site, because there are
 * ~95 Graph API call sites in server.js and a rail that has to be remembered at each one is a
 * rail that gets skipped when someone adds number 96.
 *
 *   1. Kill switch — one flag file. Present means refuse every write to every account.
 *   2. Hourly cap  — per ad account, sliding 60 minutes, counted on disk.
 *   3. Budget ban  — no request may CHANGE a budget or bid on an entity that already exists.
 *
 * Two design notes that matter, both deliberate:
 *
 * - **State is on disk, not in memory.** pm2 runs this in cluster mode with `instances: 'max'`,
 *   so an in-process counter is really N independent counters that each think they are the
 *   whole picture. The existing rateLimitTracker has that problem; this does not.
 * - **Creating an entity with a budget is allowed; changing one is not.** A campaign cannot be
 *   created without a budget, and setting it is setting the brake. Moving it afterwards is what
 *   the plan bans, because the daily budget is what stops the bleeding when a bad number lands
 *   somewhere else.
 */

import fs from 'fs';
import path from 'path';

import { getDataDir } from './paths.js';

export const WINDOW_MS = 60 * 60 * 1000;

// Meta's own tiers are roughly 100 calls/hour on development access and 200 on standard.
// 150 leaves a normal bulk upload untouched and still catches a runaway loop.
//
// Read per call, not once at import: a value baked in at module load cannot be corrected
// without a restart, and a restart is the last thing you want while an account is being
// hammered. It is one env lookup against an HTTP request.
export const maxCallsPerHour = () => Number(process.env.META_MAX_CALLS_PER_HOUR || 150);

const GRAPH_HOST = 'graph.facebook.com';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Collections you POST to in order to CREATE something. A POST to a bare node id is an update.
const CREATE_COLLECTIONS = new Set([
  'campaigns', 'adsets', 'ads', 'adcreatives', 'adimages', 'advideos',
  'adlabels', 'adrules_library', 'customaudiences', 'adspixels', 'assigned_users',
]);

// Fields that move money on an entity that already exists.
const BUDGET_FIELDS = [
  'daily_budget', 'lifetime_budget', 'bid_amount', 'bid_strategy',
  'adset_bid_amounts', 'adset_budgets', 'budget_rebalance_flag',
];

export class MetaGuardError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MetaGuardError';
    this.code = code;
    this.isMetaGuardError = true;
  }
}

// --- paths -----------------------------------------------------------------------

export function killSwitchPath() {
  return process.env.ZUCKCANNON_KILL_SWITCH || path.join(getDataDir(), 'KILL');
}

export function rateWindowPath() {
  return process.env.ZUCKCANNON_RATE_WINDOW || path.join(getDataDir(), 'meta-rate-window.json');
}

// --- 1. kill switch --------------------------------------------------------------

export function isKillSwitchOn() {
  try {
    return fs.statSync(killSwitchPath()).isFile();
  } catch {
    return false;
  }
}

export function killSwitchReason() {
  try {
    return fs.readFileSync(killSwitchPath(), 'utf-8').trim();
  } catch {
    return '';
  }
}

export function engageKillSwitch(reason = '') {
  const p = killSwitchPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, reason.trim() ? `${reason.trim()}\n` : '', 'utf-8');
  return p;
}

export function releaseKillSwitch() {
  try {
    fs.unlinkSync(killSwitchPath());
    return true;
  } catch {
    return false;
  }
}

function assertKillSwitchOff() {
  if (!isKillSwitchOn()) return;
  const why = killSwitchReason();
  throw new MetaGuardError(
    `Kill switch is ON (${killSwitchPath()})${why ? `: ${why}` : ''} — ` +
      'refusing every write to every account. Pause by hand in Ads Manager if you need it now.',
    'KILL_SWITCH_ON'
  );
}

// --- 2. budget ban ---------------------------------------------------------------

/**
 * True when this URL addresses a bare node (`/v25.0/123456`) rather than one of its
 * collections (`/v25.0/act_123/campaigns`). A bare node POST is an edit of something live.
 */
export function isNodeUpdate(url) {
  const withoutQuery = String(url).split('?')[0];
  const last = withoutQuery.split('/').filter(Boolean).pop() || '';
  if (CREATE_COLLECTIONS.has(last)) return false;
  return /^(act_)?\d+$/.test(last);
}

function payloadKeys(data) {
  if (!data) return [];
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Object.keys(parsed || {});
    } catch {
      return [...new URLSearchParams(data).keys()];
    }
  }
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
    return [...data.keys()];
  }
  // FormData (form-data package) keeps its fields on an internal stream list.
  if (typeof data.getBuffer === 'function' || typeof data.getHeaders === 'function') {
    const buf = typeof data.getBuffer === 'function' ? data.getBuffer().toString('utf-8') : '';
    return [...buf.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  }
  if (typeof data === 'object') return Object.keys(data);
  return [];
}

/**
 * The one sanctioned exception: lowering a daily budget on an unprofitable campaign.
 *
 * Rayhan's call, 2026-08-11 — a decrease can only ever reduce spend, so it is strictly less
 * risky than a raise. Raises stay banned.
 *
 * The marker carries the budget the endpoint read back from Meta a moment earlier. The
 * interceptor re-checks the arithmetic itself, so a forged or stale marker still cannot
 * authorise a raise, and a payload that disagrees with the marker cannot ride along on it.
 * Direction is never taken on the caller's word — `decrease_pct: -50` computes to a 50% RAISE,
 * which is exactly how a rail enforced by rule name would be walked straight through.
 */
export function markBudgetDecrease(config, { fromCents, toCents }) {
  return { ...config, __metaGuardBudgetDecrease: { fromCents, toCents } };
}

function decreaseIsVouchedFor(data, marker, keys) {
  if (!marker) return false;

  const from = Number(marker.fromCents);
  const to = Number(marker.toCents);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (!(to < from)) return false;                  // the whole point: strictly downward

  // Only daily_budget rides this exception. A lifetime budget or a bid alongside it does not.
  const extras = BUDGET_FIELDS.filter((f) => f !== 'daily_budget' && keys.has(f));
  if (extras.length > 0) return false;

  // The payload has to be the number the marker vouched for, or the marker means nothing.
  return Number(payloadValue(data, 'daily_budget')) === to;
}

function payloadValue(data, field) {
  if (!data) return undefined;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed?.[field];
    } catch {
      return new URLSearchParams(data).get(field) ?? undefined;
    }
  }
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
    return data.get(field) ?? undefined;
  }
  if (typeof data === 'object') return data[field];
  return undefined;
}

export function assertNoBudgetChange({ url, method, data, __metaGuardBudgetDecrease: marker }) {
  if (!WRITE_METHODS.has(String(method || 'GET').toUpperCase())) return;
  if (!isNodeUpdate(url)) return; // creating an entity with a budget is setting the brake

  const keys = new Set([...payloadKeys(data), ...[...new URLSearchParams(String(url).split('?')[1] || '')].map(([k]) => k)]);
  const offending = BUDGET_FIELDS.filter((f) => keys.has(f));
  if (offending.length === 0) return;

  if (decreaseIsVouchedFor(data, marker, keys)) return;

  throw new MetaGuardError(
    `Refusing to change ${offending.join(', ')} on a live entity (${url}). ` +
      'The daily budget is the last-resort brake on a bad bid — if our own code can move it, ' +
      'that brake is gone. Lowering a daily budget is allowed only through ' +
      'POST /api/meta/decrease-budget, which verifies the drop against Meta first.',
    'BUDGET_CHANGE_BLOCKED'
  );
}

// --- 3. hourly cap ---------------------------------------------------------------

export function accountFromUrl(url) {
  const m = String(url).match(/\/act_(\d+)\b/);
  return m ? `act_${m[1]}` : 'unresolved';
}

function withLock(fn) {
  const lock = `${rateWindowPath()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let fd;
  // pm2 cluster mode means several processes share this file. Spin briefly on an exclusive
  // create rather than trusting the event loop to keep read-modify-write atomic.
  for (let i = 0; i < 50; i++) {
    try {
      fd = fs.openSync(lock, 'wx');
      break;
    } catch {
      const until = Date.now() + 5;
      while (Date.now() < until) { /* 5ms spin */ }
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
      try { fs.unlinkSync(lock); } catch { /* another worker cleaned up */ }
    }
  }
}

function readWindow() {
  try {
    const raw = JSON.parse(fs.readFileSync(rateWindowPath(), 'utf-8'));
    return typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

function writeWindow(state) {
  const p = rateWindowPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf-8');
  fs.renameSync(tmp, p);
}

export function recentCalls(accountId, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  return (readWindow()[accountId] || []).filter((t) => t > cutoff);
}

/**
 * Record one call against an account, refusing when the rolling hour is full.
 * Unlike the queue's adaptive backoff this is a hard ceiling: it does not wait, because an
 * HTTP request holding a connection open for 50 minutes is worse than a clear refusal.
 */
export function consumeRateSlot(accountId, { maxCalls = maxCallsPerHour(), now = Date.now() } = {}) {
  if (maxCalls <= 0) return;

  withLock(() => {
    const state = readWindow();
    const cutoff = now - WINDOW_MS;
    const calls = (state[accountId] || []).filter((t) => t > cutoff);

    if (calls.length >= maxCalls) {
      const freesIn = Math.ceil((Math.min(...calls) + WINDOW_MS - now) / 1000);
      throw new MetaGuardError(
        `${accountId}: ${calls.length} Meta calls in the last hour, cap is ${maxCalls}. ` +
          `Next slot frees in ${freesIn}s.`,
        'RATE_CAP_EXCEEDED'
      );
    }

    calls.push(now);
    state[accountId] = calls;
    for (const [k, v] of Object.entries(state)) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length) state[k] = kept;
      else delete state[k];
    }
    writeWindow(state);
  });
}

// --- wiring ----------------------------------------------------------------------

export function isMetaWrite({ url, method }) {
  return String(url || '').includes(GRAPH_HOST) && WRITE_METHODS.has(String(method || 'GET').toUpperCase());
}

/**
 * Guard one Meta write. Throws MetaGuardError to refuse.
 * Reads count toward nothing: they cannot spend money and they are how the dashboard works.
 */
export function guardMetaWrite(request, options = {}) {
  const { url, method } = request;
  if (!isMetaWrite({ url, method })) return;
  assertKillSwitchOff();
  assertNoBudgetChange(request);
  // A write to a bare node id carries no account in the URL, so a caller that knows it says so
  // and gets its own window instead of sharing the coarse `unresolved` bucket.
  consumeRateSlot(request.__metaGuardAccountId || accountFromUrl(url), options);
}

/** axios request interceptor. Install once, next to the response interceptor. */
export function metaGuardRequestInterceptor(config) {
  guardMetaWrite({
    url: config.url,
    method: config.method,
    data: config.data,
    __metaGuardBudgetDecrease: config.__metaGuardBudgetDecrease,
    __metaGuardAccountId: config.__metaGuardAccountId,
  });
  return config;
}

export function installMetaGuard(axiosInstance) {
  axiosInstance.interceptors.request.use(metaGuardRequestInterceptor);
  return axiosInstance;
}
