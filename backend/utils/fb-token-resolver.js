// backend/utils/fb-token-resolver.js
import { selectFbToken } from './fb-token-selector.js';

/**
 * Resolves the FB token for an ads-ops request.
 * - Reads: always system-user routing (selectFbToken), with OAuth fallback if no system user.
 * - Writes: system-user routing ONLY when USE_SYSTEM_USER_FOR_WRITES=true; otherwise the
 *   logged-in OAuth session token (preserves pre-flip behavior — no regression until flipped).
 * - Strict mode (OAUTH_STRICT_ADS_OPS=true): when system-user routing finds no healthy
 *   system user, HARD-FAIL instead of falling back to the personal OAuth token — returns a
 *   token-less result { token: null, reason: 'strict_mode_no_system_user' } so the write path
 *   blocks (HTTP 403). Default off → OAuth fallback unchanged.
 * Returns { token, type, bm_id?, fb_user_id?, reason? } or null when no token at all.
 */
export async function resolveFbToken(req, adAccountId, { write = false } = {}) {
  const oauth = req.user?.facebook_access_token || null;
  let result;

  // Flag-gated writes: before the flag is flipped, behave exactly as today (OAuth session token).
  if (write && process.env.USE_SYSTEM_USER_FOR_WRITES !== 'true') {
    result = oauth ? { token: oauth, type: 'oauth', reason: 'flag_off' } : null;
  } else {
    const sel = await selectFbToken(req.user?.id, adAccountId || null);
    if (sel?.token) {
      result = sel;
    } else if (write && process.env.OAUTH_STRICT_ADS_OPS === 'true') {
      // Strict mode (WRITES only): no healthy system user for this account's BM →
      // HARD-FAIL. NEVER fall back to the personal OAuth token. Return a token-less
      // result so the caller's `!tokenData?.token` guard fires (HTTP 403) and the
      // reason is surfaced as the 403 `detail`. Reads keep their OAuth fallback.
      result = { token: null, type: 'none', reason: 'strict_mode_no_system_user' };
    } else {
      // selectFbToken null → fall back to OAuth session token so the request doesn't
      // hard-fail before a system user is registered for this account's BM.
      result = oauth ? { token: oauth, type: 'oauth', reason: 'no_system_user' } : null;
    }
  }

  // Observability (never logs the token itself): which identity each ads-op resolves to.
  console.log(
    `[fb-token] ${write ? 'WRITE' : 'READ '} acct=${adAccountId ?? '-'} -> ` +
    (result
      ? `type=${result.type} bm=${result.bm_id ?? '-'} su=${result.fb_user_id ?? '-'}` +
        (result.reason ? ` reason=${result.reason}` : '')
      : 'NULL (no token)')
  );

  return result;
}
