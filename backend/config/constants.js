// API and application constants

export const API_VERSION = "v24.0";

export const TIMEOUTS = {
  BATCH: 30000,
  STANDARD: 15000,
  VIDEO: 120000,
  DEFAULT: 60000,
};

export const BATCH_CONFIG = {
  SIZE_ADS: 25,
  SIZE_IMAGES: 10,
  SIZE_VIDEOS: 5,
  DELAY_BETWEEN: 5000,
};

export const LIMITS = {
  ADS_PER_ADSET: 50,
  MAX_BATCH_SIZE: 50,
  PAGINATION: 500,
};

export const FILE_UPLOAD_LIMITS = {
  MAX_FILE_SIZE: 4 * 1024 * 1024 * 1024, // 4GB
  MAX_FILES: 50,
};

export const CACHE_CONFIG = {
  VALIDITY_MINUTES: 60,
};

export const ERROR_CODES = {
  RATE_LIMIT_429: 429,
  FB_THROTTLE: 80004,
  APP_REQUEST_LIMIT: 2446079,
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export const SESSION_CONFIG = {
  MAX_AGE: 7 * 24 * 60 * 60 * 1000, // 7 days
};
