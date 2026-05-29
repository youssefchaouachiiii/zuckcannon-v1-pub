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

function isHealthy(systemUser) {
  if (!systemUser) return false;
  if (systemUser.last_validation_ok !== 1) return false;
  if (systemUser.expires_at && new Date(systemUser.expires_at) <= new Date()) return false;
  return true;
}
