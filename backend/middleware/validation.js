// Request validation middleware
export const validateRequest = {
  // Validate file upload requests
  uploadFiles: (req, res, next) => {
    if (!req.body.account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Validate file size limits
    const maxFileSize = 4 * 1024 * 1024 * 1024; // 4GB
    for (const file of req.files) {
      if (file.size > maxFileSize) {
        return res.status(400).json({
          error: `File ${file.originalname} exceeds maximum size of 4GB`,
        });
      }
    }

    next();
  },

  // Validate Google Drive download request
  googleDriveDownload: (req, res, next) => {
    const { fileIds, account_id } = req.body;

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: "fileIds array is required" });
    }

    if (!account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }

    // Limit number of files per request
    if (fileIds.length > 50) {
      return res.status(400).json({
        error: "Maximum 50 files can be processed per request",
      });
    }

    next();
  },

  // Validate campaign creation
  createCampaign: (req, res, next) => {
    const requiredFields = ["account_id", "name", "objective", "status"];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // Validate objective
    const validObjectives = [
      "OUTCOME_APP_PROMOTION",
      "OUTCOME_AWARENESS",
      "OUTCOME_ENGAGEMENT",
      "OUTCOME_LEADS",
      "OUTCOME_SALES",
      "OUTCOME_TRAFFIC",
      "LINK_CLICKS",
      "PAGE_LIKES",
      "POST_ENGAGEMENT",
      "CONVERSIONS",
      "APP_INSTALLS",
      "VIDEO_VIEWS",
      "LEAD_GENERATION",
      "REACH",
      "BRAND_AWARENESS",
      "MESSAGES",
    ];

    if (!validObjectives.includes(req.body.objective)) {
      return res.status(400).json({
        error: `Invalid objective. Must be one of: ${validObjectives.join(", ")}`,
      });
    }

    // Validate status
    const validStatuses = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"];
    if (!validStatuses.includes(req.body.status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Validate budget if provided
    if (req.body.daily_budget && isNaN(parseFloat(req.body.daily_budget))) {
      return res.status(400).json({ error: "daily_budget must be a valid number" });
    }

    if (req.body.lifetime_budget && isNaN(parseFloat(req.body.lifetime_budget))) {
      return res.status(400).json({ error: "lifetime_budget must be a valid number" });
    }

    // Validate that only one budget type is provided
    if (req.body.daily_budget && req.body.lifetime_budget) {
      return res.status(400).json({
        error: "Cannot specify both daily_budget and lifetime_budget",
      });
    }

    // Validate special_ad_categories if provided
    if (req.body.special_ad_categories) {
      if (!Array.isArray(req.body.special_ad_categories)) {
        return res.status(400).json({
          error: "special_ad_categories must be an array",
        });
      }

      const validCategories = ["CREDIT", "EMPLOYMENT", "HOUSING", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING"];
      const invalidCategories = req.body.special_ad_categories.filter((cat) => !validCategories.includes(cat));

      if (invalidCategories.length > 0) {
        return res.status(400).json({
          error: `Invalid special ad categories: ${invalidCategories.join(", ")}. Must be one of: ${validCategories.join(", ")}`,
        });
      }
    }

    next();
  },

  // Validate ad set creation
  createAdSet: (req, res, next) => {
    const requiredFields = ["account_id", "campaign_id", "name", "optimization_goal", "billing_event"];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // Validate budget
    if (req.body.daily_budget && isNaN(parseFloat(req.body.daily_budget))) {
      return res.status(400).json({ error: "daily_budget must be a valid number" });
    }

    if (req.body.lifetime_budget && isNaN(parseFloat(req.body.lifetime_budget))) {
      return res.status(400).json({ error: "lifetime_budget must be a valid number" });
    }

    next();
  },

  // Validate creative upload from library
  uploadLibraryCreatives: (req, res, next) => {
    const { creativeIds, account_id } = req.body;

    if (!creativeIds || !Array.isArray(creativeIds) || creativeIds.length === 0) {
      return res.status(400).json({ error: "creativeIds array is required" });
    }

    if (!account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }

    // Limit batch size
    if (creativeIds.length > 100) {
      return res.status(400).json({
        error: "Maximum 100 creatives can be uploaded per request",
      });
    }

    next();
  },

  // Validate user creation
  createUser: (req, res, next) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters long" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long" });
    }

    // Basic password strength check
    const hasNumber = /\d/.test(password);
    const hasLetter = /[a-zA-Z]/.test(password);
    if (!hasNumber || !hasLetter) {
      return res.status(400).json({
        error: "Password must contain both letters and numbers",
      });
    }

    next();
  },

  // Validate batch ad creation request
  batchCreateAds: (req, res, next) => {
    const { account_id, adset_id, page_id, ads } = req.body;

    if (!account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }

    if (!adset_id) {
      return res.status(400).json({ error: "adset_id is required" });
    }

    if (!page_id) {
      return res.status(400).json({ error: "page_id is required" });
    }

    if (!ads || !Array.isArray(ads) || ads.length === 0) {
      return res.status(400).json({
        error: "ads array is required and must not be empty",
      });
    }

    if (ads.length > 100) {
      return res.status(400).json({
        error: "Maximum 100 ads can be created per batch request",
      });
    }

    // Validate each ad
    for (let i = 0; i < ads.length; i++) {
      const ad = ads[i];

      if (!ad.name) {
        return res.status(400).json({
          error: `Ad at index ${i} is missing required field: name`,
        });
      }

      if (!ad.imageHash && !ad.video_id) {
        return res.status(400).json({
          error: `Ad at index ${i} must have either imageHash or video_id`,
        });
      }
    }

    next();
  },

  // Validate batch ads-only creation request
  batchCreateAdsOnly: (req, res, next) => {
    const { account_id, ads } = req.body;

    if (!account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }

    if (!ads || !Array.isArray(ads) || ads.length === 0) {
      return res.status(400).json({
        error: "ads array is required and must not be empty",
      });
    }

    if (ads.length > 100) {
      return res.status(400).json({
        error: "Maximum 100 ads can be created per batch request",
      });
    }

    // Validate each ad
    for (let i = 0; i < ads.length; i++) {
      const ad = ads[i];

      if (!ad.name) {
        return res.status(400).json({
          error: `Ad at index ${i} is missing required field: name`,
        });
      }

      if (!ad.adset_id) {
        return res.status(400).json({
          error: `Ad at index ${i} is missing required field: adset_id`,
        });
      }

      if (!ad.creative_id) {
        return res.status(400).json({
          error: `Ad at index ${i} is missing required field: creative_id`,
        });
      }
    }

    next();
  },

  // Validate batch status update request
  batchUpdateStatus: (req, res, next) => {
    const { entity_ids, status } = req.body;

    if (!entity_ids || !Array.isArray(entity_ids) || entity_ids.length === 0) {
      return res.status(400).json({ error: "entity_ids array is required" });
    }

    if (entity_ids.length > 50) {
      return res.status(400).json({
        error: "Maximum 50 entities can be updated per batch request",
      });
    }

    const validStatuses = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    next();
  },

  // Validate batch fetch accounts request
  batchFetchAccounts: (req, res, next) => {
    const { account_ids } = req.body;

    if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
      return res.status(400).json({ error: "account_ids array is required" });
    }

    if (account_ids.length > 50) {
      return res.status(400).json({
        error: "Maximum 50 accounts can be fetched per batch request",
      });
    }

    next();
  },

  // Validate custom batch request
  customBatchRequest: (req, res, next) => {
    const { operations } = req.body;

    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({ error: "operations array is required" });
    }

    if (operations.length > 50) {
      return res.status(400).json({
        error: "Maximum 50 operations per batch request (Meta API limitation)",
      });
    }

    // Validate each operation has required fields
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];

      if (!op.method) {
        return res.status(400).json({
          error: `Operation at index ${i} is missing required field: method`,
        });
      }

      if (!op.relative_url) {
        return res.status(400).json({
          error: `Operation at index ${i} is missing required field: relative_url`,
        });
      }

      const validMethods = ["GET", "POST", "PUT", "DELETE"];
      if (!validMethods.includes(op.method.toUpperCase())) {
        return res.status(400).json({
          error: `Operation at index ${i} has invalid method. Must be one of: ${validMethods.join(", ")}`,
        });
      }
    }

    next();
  },
};

// Rate limiting middleware factory
export const createRateLimiter = (windowMs, maxRequests) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    // Clean up old entries
    for (const [ip, data] of requests.entries()) {
      if (now - data.firstRequest > windowMs) {
        requests.delete(ip);
      }
    }

    if (!requests.has(key)) {
      requests.set(key, { count: 1, firstRequest: now });
      return next();
    }

    const userData = requests.get(key);
    if (now - userData.firstRequest > windowMs) {
      userData.count = 1;
      userData.firstRequest = now;
    } else {
      userData.count++;
    }

    if (userData.count > maxRequests) {
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
      });
    }

    next();
  };
};

// Login rate limiter - 5 attempts per 15 minutes
export const loginRateLimiter = createRateLimiter(15 * 60 * 1000, 5);

// API rate limiter - 100 requests per minute
export const apiRateLimiter = createRateLimiter(60 * 1000, 100);
