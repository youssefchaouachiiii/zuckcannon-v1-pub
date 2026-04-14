// backend/utils/fb-token-selector.js
import { FacebookAuthDB } from './facebook-auth-db.js';

/**
 * Returns the best available FB API token.
 * Prefers System User token. Falls back to OAuth token.
 *
 * @param {number} userId - for OAuth fallback lookup
 * @param {string|null} adAccountId - reserved for future per-account filtering
 * @returns {Promise<{token: string, type: 'system_user'|'oauth'}|null>}
 */
export async function selectFbToken(oauthToken = null) {
  const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();

  if (systemUserTokens.length > 0) {
    return { token: systemUserTokens[0].access_token, type: 'system_user' };
  }

  if (!oauthToken) return null;

  return { token: oauthToken, type: 'oauth' };
}
