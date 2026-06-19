// backend/utils/fb-token-selector.js
import { FacebookAuthDB } from './facebook-auth-db.js';

/**
 * Returns the best available FB API token for the given (userId, adAccountId).
 *
 * Routing priority:
 *   1. If adAccountId is provided, look up the ad account → its BM → that BM's
 *      system_user. Use it if healthy (last_validation_ok=1 + not expired).
 *   2. Otherwise (or if step 1 misses): pick any healthy system_user
 *      (latest updated_at).
 *   3. Otherwise: fall back to the OAuth user token.
 *   4. Otherwise: return `null`.
 *
 * Never throws. Returns a structured object on any path that resolves a token;
 * returns bare `null` when no token of any kind is available. This matches the
 * original selector contract so `if (!tokenData)` guards keep working in
 * callers. Fallback paths include a `reason` field for log/metric observability.
 *
 * @param {number} userId
 * @param {string|null|undefined} adAccountId  Accepts both 'act_123' and '123'.
 * @returns {Promise<null | {
 *   token: string,
 *   type: 'system_user'|'oauth',
 *   bm_id?: string,
 *   fb_user_id?: string,
 *   reason?: string,
 * }>}  null only when no token is available at all.
 */
export async function selectFbToken(userId, adAccountId) {
  // Step 1: per-ad-account routing.
  if (adAccountId !== null && adAccountId !== undefined && adAccountId !== '') {
    const adAccount = await FacebookAuthDB.getAdAccount(adAccountId);
    if (adAccount) {
      const systemUser = await FacebookAuthDB.getSystemUserForBm(adAccount.business_manager_id);
      if (isHealthy(systemUser)) {
        return {
          token: systemUser.access_token,
          type: 'system_user',
          bm_id: adAccount.business_manager_id,
          fb_user_id: systemUser.fb_user_id,
        };
      }
    }
  }

  // Step 2: fallback to ANY healthy system_user.
  const anySystemUser = await FacebookAuthDB.getAnyHealthySystemUser();
  if (anySystemUser) {
    return {
      token: anySystemUser.access_token,
      type: 'system_user',
      bm_id: anySystemUser.business_manager_id,
      fb_user_id: anySystemUser.fb_user_id,
      reason: 'fallback_no_ad_account_match',
    };
  }

  // Step 3: OAuth fallback.
  // NOTE: Kept deliberately so callers don't break before a system_user is
  // registered in production. A follow-up PR will gate this behind a
  // STRICT_SYSTEM_USER env flag once at least one system_user is healthy.
  // Uses getValidToken (not getToken) so expired OAuth tokens fall through
  // to step 4 instead of being passed to Graph API.
  const oauthToken = await FacebookAuthDB.getValidToken(userId);
  if (oauthToken) {
    return {
      token: oauthToken.access_token,
      type: 'oauth',
      reason: 'no_system_user_available',
    };
  }

  // Step 4: nothing available.
  return null;
}

/**
 * Resolves a system-user token for an account, with hard-fail (no OAuth fallback).
 *
 * This function:
 *   1. Looks up the account in the BM map.
 *   2. Resolves the BM's system_user row from the maintained system_users table.
 *   3. Gates on isHealthy (last_validation_ok=1 + not expired).
 *   4. Returns the token, or throws if either lookup fails or the user is unhealthy.
 *
 * NEVER returns an OAuth token. NEVER falls back to OAuth. If no healthy system user
 * exists, throws with code='no_system_user'.
 *
 * @param {string|number} accountId  Can be 'act_123' or '123'; will strip 'act_' prefix.
 * @returns {Promise<{ token: string, bm_id: string, bm_name: string }>}
 * @throws {Error} with `.code='no_bm_for_account'` if account not found, or
 *                 with `.code='no_system_user'` and `.bm_name` if no healthy system user.
 */
export async function resolveSystemUserTokenForAccount(accountId) {
  const acct = String(accountId).replace(/^act_/, '');
  const map = await FacebookAuthDB.getAccountBmMap();
  const bm = map[acct];
  if (!bm) { const e = new Error(`No BM mapped for account ${acct}`); e.code = 'no_bm_for_account'; throw e; }
  const su = await FacebookAuthDB.getSystemUserForBm(bm.bm_id);
  if (!isHealthy(su)) { const e = new Error(`No healthy system user for BM ${bm.bm_name}`); e.code = 'no_system_user'; e.bm_name = bm.bm_name; throw e; }
  return { token: su.access_token, bm_id: bm.bm_id, bm_name: bm.bm_name };
}

function isHealthy(systemUser) {
  if (!systemUser) return false;
  if (systemUser.last_validation_ok !== 1) return false;
  if (systemUser.expires_at && new Date(systemUser.expires_at) <= new Date()) return false;
  return true;
}
