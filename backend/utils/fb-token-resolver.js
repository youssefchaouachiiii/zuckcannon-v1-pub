// backend/utils/fb-token-resolver.js
import { selectFbToken } from './fb-token-selector.js';

/**
 * Resolves the FB token for an ads-ops request.
 * - Reads: always system-user routing (selectFbToken), with OAuth fallback if no system user.
 * - Writes: system-user routing ONLY when USE_SYSTEM_USER_FOR_WRITES=true; otherwise the
 *   logged-in OAuth session token (preserves pre-flip behavior — no regression until flipped).
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
    // selectFbToken null → fall back to OAuth session token so the request doesn't
    // hard-fail before a system user is registered for this account's BM.
    result = sel?.token ? sel : (oauth ? { token: oauth, type: 'oauth', reason: 'no_system_user' } : null);
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
