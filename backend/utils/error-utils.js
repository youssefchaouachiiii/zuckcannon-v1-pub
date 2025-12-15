/**
 * Error Handling Utilities
 * Provides error extraction and classification functions
 */

/**
 * Extract error message from API response or error object
 * @param {Error} error - The error object
 * @returns {string} - Extracted error message
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
 * Meta/Facebook rate limit codes:
 * - 429: HTTP status code for Too Many Requests
 * - 80004: Facebook API rate limit code
 * - 2446079: Another Facebook rate limit error code
 * 
 * @param {Error} error - The error object
 * @returns {boolean} - Is rate limit error
 */
export function isRateLimitError(error) {
  const status = error.response?.status;
  const code = error.response?.data?.error?.code;
  return status === 429 || code === 80004 || code === 2446079;
}
