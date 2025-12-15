/**
 * Account ID Utilities
 * Handles normalization and formatting of ad account IDs
 */

/**
 * Normalize ad account ID by removing 'act_' prefix
 * @param {string} adAccountId - The account ID
 * @returns {string} - Normalized account ID
 */
export function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return adAccountId;
  const original = adAccountId.toString();
  const normalized = original.replace(/^act_/, "");

  if (original !== normalized) {
    console.log(`Normalized account ID: ${original} -> ${normalized}`);
  }

  return normalized;
}

/**
 * Format account ID with 'act_' prefix
 * @param {string} accountId - The account ID
 * @returns {string} - Formatted account ID
 */
export function formatAccountId(accountId) {
  if (!accountId) return accountId;
  const cleanId = String(accountId).trim();
  return cleanId.startsWith("act_") ? cleanId : `act_${cleanId}`;
}
