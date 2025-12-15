/**
 * Parsing and Validation Utilities
 * Provides data parsing and validation helper functions
 */

/**
 * Safe JSON parse with fallback value
 * @param {string} json - JSON string to parse
 * @param {*} fallback - Fallback value if parse fails (default: null)
 * @returns {*} - Parsed JSON or fallback value
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
 * Generate unique session ID
 * Uses timestamp and random value for uniqueness
 * @returns {string} - Unique session ID
 */
export function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Check if value is empty (null, undefined, empty string, empty array, or empty object)
 * @param {*} value - Value to check
 * @returns {boolean} - True if value is empty
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
 * Deep merge multiple objects
 * Recursively merges objects, with later objects overwriting earlier ones
 * @param {...Object} objects - Objects to merge
 * @returns {Object} - Merged result object
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
