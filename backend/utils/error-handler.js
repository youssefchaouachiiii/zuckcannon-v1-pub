// Error handling utilities

import { HTTP_STATUS, ERROR_CODES } from "../config/constants.js";
import { getErrorMessage } from "./helpers.js";

/**
 * Standard API error response
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} details - Additional error details
 * @returns {Object} - Error response object
 */
export function apiError(statusCode, message, details = {}) {
  return {
    success: false,
    error: message,
    status: statusCode,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Success API response
 * @param {*} data - Response data
 * @param {string} message - Success message
 * @returns {Object} - Success response object
 */
export function apiSuccess(data, message = "Success") {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Handle axios error with appropriate response
 * @param {Error} error - The error object
 * @param {Object} options - Options { defaultStatus, logError, context }
 * @returns {Object} - Error response
 */
export function handleAxiosError(error, options = {}) {
  const { defaultStatus = HTTP_STATUS.INTERNAL_SERVER_ERROR, logError = true, context = "" } = options;

  const status = error.response?.status || defaultStatus;
  const message = getErrorMessage(error);

  if (logError) {
    console.error(`[${context}] API Error (${status}):`, message);
  }

  const details = {
    code: error.response?.data?.error?.code,
    endpoint: error.config?.url,
  };

  return apiError(status, message, details);
}

/**
 * Handle database error
 * @param {Error} error - The error object
 * @param {string} operation - Database operation (insert, update, delete, query)
 * @returns {Object} - Error response
 */
export function handleDbError(error, operation = "database") {
  console.error(`Database ${operation} error:`, error.message);

  const message = error.message.includes("duplicate")
    ? "Record already exists"
    : error.message.includes("not found")
      ? "Record not found"
      : `Database ${operation} failed`;

  return apiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, message, {
    operation,
    error: error.message,
  });
}

/**
 * Handle validation error
 * @param {Array|Object|string} errors - Validation errors
 * @returns {Object} - Error response
 */
export function handleValidationError(errors) {
  let details = [];

  if (typeof errors === "string") {
    details = [errors];
  } else if (Array.isArray(errors)) {
    details = errors.map((e) => (typeof e === "string" ? e : e.message));
  } else if (typeof errors === "object") {
    details = Object.entries(errors).map(([key, value]) => `${key}: ${value}`);
  }

  return apiError(HTTP_STATUS.BAD_REQUEST, "Validation failed", { errors: details });
}

/**
 * Handle rate limit error
 * @param {number} retryAfter - Seconds to retry after
 * @returns {Object} - Error response
 */
export function handleRateLimitError(retryAfter = 60) {
  return apiError(HTTP_STATUS.TOO_MANY_REQUESTS, "Rate limit exceeded. Please try again later.", {
    retryAfter,
  });
}

/**
 * Handle authentication error
 * @param {string} reason - Reason for auth failure
 * @returns {Object} - Error response
 */
export function handleAuthError(reason = "Invalid credentials") {
  return apiError(HTTP_STATUS.UNAUTHORIZED, reason);
}

/**
 * Handle forbidden error
 * @param {string} resource - Resource being accessed
 * @returns {Object} - Error response
 */
export function handleForbiddenError(resource = "resource") {
  return apiError(HTTP_STATUS.FORBIDDEN, `Access denied to ${resource}`);
}

/**
 * Handle not found error
 * @param {string} resource - Resource not found
 * @returns {Object} - Error response
 */
export function handleNotFoundError(resource = "Resource") {
  return apiError(HTTP_STATUS.NOT_FOUND, `${resource} not found`);
}

/**
 * Check if error is retriable
 * @param {Error} error - The error object
 * @param {number} attemptNumber - Current attempt number
 * @param {number} maxRetries - Maximum retries allowed
 * @returns {boolean} - Is retriable
 */
export function isRetriableError(error, attemptNumber = 1, maxRetries = 3) {
  if (attemptNumber >= maxRetries) return false;

  const status = error.response?.status;
  // Retry on 429 (rate limit), 5xx (server errors), and timeout
  return status === 429 || (status >= 500 && status < 600) || error.code === "ECONNABORTED";
}

/**
 * Calculate backoff delay for retry
 * @param {number} attemptNumber - Attempt number (1-based)
 * @param {number} baseDelay - Base delay in ms
 * @returns {number} - Delay in ms
 */
export function getBackoffDelay(attemptNumber, baseDelay = 1000) {
  // Exponential backoff with jitter
  const exponentialDelay = baseDelay * Math.pow(2, attemptNumber - 1);
  const jitter = Math.random() * 1000;
  return exponentialDelay + jitter;
}
