// Helper utility functions

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

/**
 * Extract error message from API response
 * @param {Error} error - The error object
 * @returns {string} - Error message
 */
export function getErrorMessage(error) {
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  if (error.response?.data?.error) {
    return JSON.stringify(error.response.data.error);
  }
  return error.message || "Unknown error";
}

/**
 * Check if error is a rate limit error
 * @param {Error} error - The error object
 * @returns {boolean} - Is rate limit error
 */
export function isRateLimitError(error) {
  const status = error.response?.status;
  const code = error.response?.data?.error?.code;
  return status === 429 || code === 80004 || code === 2446079;
}

/**
 * Safe JSON parse with fallback
 * @param {string} json - JSON string
 * @param {*} fallback - Fallback value if parse fails
 * @returns {*} - Parsed JSON or fallback
 */
export function safeJsonParse(json, fallback = null) {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error("JSON parse error:", err.message);
    return fallback;
  }
}

/**
 * Convert cents to dollars
 * @param {number} cents - Amount in cents
 * @returns {number} - Amount in dollars
 */
export function centsToDollars(cents) {
  return Math.round(cents) / 100;
}

/**
 * Convert dollars to cents
 * @param {number} dollars - Amount in dollars
 * @returns {number} - Amount in cents
 */
export function dollarsToCents(dollars) {
  return Math.round(parseFloat(dollars) * 100);
}

/**
 * Generate unique session ID
 * @returns {string} - Unique session ID
 */
export function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Check if value is empty
 * @param {*} value - Value to check
 * @returns {boolean} - Is empty
 */
export function isEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && Object.keys(value).length === 0)
  );
}

/**
 * Merge objects deeply
 * @param {...Object} objects - Objects to merge
 * @returns {Object} - Merged object
 */
export function deepMerge(...objects) {
  const result = {};

  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
          result[key] = deepMerge(result[key] || {}, obj[key]);
        } else {
          result[key] = obj[key];
        }
      }
    }
  }

  return result;
}
