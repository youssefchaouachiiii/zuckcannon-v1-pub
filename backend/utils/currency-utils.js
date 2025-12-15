/**
 * Currency Conversion Utilities
 * Handles conversion between cents and dollars
 */

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
