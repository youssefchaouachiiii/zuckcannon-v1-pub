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
    const requiredFields = ["account_id", "name", "objective"];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // Validate objective - updated with all Meta API objectives
    const validObjectives = [
      "APP_INSTALLS",
      "BRAND_AWARENESS",
      "CONVERSIONS",
      "EVENT_RESPONSES",
      "LEAD_GENERATION",
      "LINK_CLICKS",
      "LOCAL_AWARENESS",
      "MESSAGES",
      "OFFER_CLAIMS",
      "OUTCOME_APP_PROMOTION",
      "OUTCOME_AWARENESS",
      "OUTCOME_ENGAGEMENT",
      "OUTCOME_LEADS",
      "OUTCOME_SALES",
      "OUTCOME_TRAFFIC",
      "PAGE_LIKES",
      "POST_ENGAGEMENT",
      "PRODUCT_CATALOG_SALES",
      "REACH",
      "STORE_VISITS",
      "VIDEO_VIEWS",
    ];

    if (!validObjectives.includes(req.body.objective)) {
      return res.status(400).json({
        error: `Invalid objective. Must be one of: ${validObjectives.join(", ")}`,
      });
    }

    // Validate status
    const validStatuses = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"];
    if (req.body.status && !validStatuses.includes(req.body.status)) {
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

    // Validate spend_cap if provided
    if (req.body.spend_cap && isNaN(parseInt(req.body.spend_cap))) {
      return res.status(400).json({ error: "spend_cap must be a valid integer" });
    }

    // Validate special_ad_categories if provided
    if (req.body.special_ad_categories) {
      if (!Array.isArray(req.body.special_ad_categories)) {
        return res.status(400).json({
          error: "special_ad_categories must be an array",
        });
      }

      const validCategories = ["NONE", "EMPLOYMENT", "HOUSING", "FINANCIAL_PRODUCTS_SERVICES", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING"];

      // Check for deprecated CREDIT category
      if (req.body.special_ad_categories.includes("CREDIT")) {
        return res.status(400).json({
          error: "The CREDIT special ad category is no longer available. Use FINANCIAL_PRODUCTS_SERVICES instead.",
        });
      }

      const invalidCategories = req.body.special_ad_categories.filter((cat) => !validCategories.includes(cat));

      if (invalidCategories.length > 0) {
        return res.status(400).json({
          error: `Invalid special ad categories: ${invalidCategories.join(", ")}. Must be one of: ${validCategories.join(", ")}`,
        });
      }
    }

    // Validate bid_strategy if provided
    if (req.body.bid_strategy) {
      const validStrategies = ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"];
      if (!validStrategies.includes(req.body.bid_strategy)) {
        return res.status(400).json({
          error: `Invalid bid_strategy. Must be one of: ${validStrategies.join(", ")}`,
        });
      }
    }

    // Validate special_ad_category_country if provided
    if (req.body.special_ad_category_country) {
      if (!Array.isArray(req.body.special_ad_category_country)) {
        return res.status(400).json({
          error: "special_ad_category_country must be an array",
        });
      }

      const validCountries = [
        "AD",
        "AE",
        "AF",
        "AG",
        "AI",
        "AL",
        "AM",
        "AO",
        "AQ",
        "AR",
        "AS",
        "AT",
        "AU",
        "AW",
        "AX",
        "AZ",
        "BA",
        "BB",
        "BD",
        "BE",
        "BF",
        "BG",
        "BH",
        "BI",
        "BJ",
        "BL",
        "BM",
        "BN",
        "BO",
        "BQ",
        "BR",
        "BS",
        "BT",
        "BV",
        "BW",
        "BY",
        "BZ",
        "CA",
        "CC",
        "CD",
        "CF",
        "CG",
        "CH",
        "CI",
        "CK",
        "CL",
        "CM",
        "CN",
        "CO",
        "CR",
        "CU",
        "CV",
        "CW",
        "CX",
        "CY",
        "CZ",
        "DE",
        "DJ",
        "DK",
        "DM",
        "DO",
        "DZ",
        "EC",
        "EE",
        "EG",
        "EH",
        "ER",
        "ES",
        "ET",
        "FI",
        "FJ",
        "FK",
        "FM",
        "FO",
        "FR",
        "GA",
        "GB",
        "GD",
        "GE",
        "GF",
        "GG",
        "GH",
        "GI",
        "GL",
        "GM",
        "GN",
        "GP",
        "GQ",
        "GR",
        "GS",
        "GT",
        "GU",
        "GW",
        "GY",
        "HK",
        "HM",
        "HN",
        "HR",
        "HT",
        "HU",
        "ID",
        "IE",
        "IL",
        "IM",
        "IN",
        "IO",
        "IQ",
        "IR",
        "IS",
        "IT",
        "JE",
        "JM",
        "JO",
        "JP",
        "KE",
        "KG",
        "KH",
        "KI",
        "KM",
        "KN",
        "KP",
        "KR",
        "KW",
        "KY",
        "KZ",
        "LA",
        "LB",
        "LC",
        "LI",
        "LK",
        "LR",
        "LS",
        "LT",
        "LU",
        "LV",
        "LY",
        "MA",
        "MC",
        "MD",
        "ME",
        "MF",
        "MG",
        "MH",
        "MK",
        "ML",
        "MM",
        "MN",
        "MO",
        "MP",
        "MQ",
        "MR",
        "MS",
        "MT",
        "MU",
        "MV",
        "MW",
        "MX",
        "MY",
        "MZ",
        "NA",
        "NC",
        "NE",
        "NF",
        "NG",
        "NI",
        "NL",
        "NO",
        "NP",
        "NR",
        "NU",
        "NZ",
        "OM",
        "PA",
        "PE",
        "PF",
        "PG",
        "PH",
        "PK",
        "PL",
        "PM",
        "PN",
        "PR",
        "PS",
        "PT",
        "PW",
        "PY",
        "QA",
        "RE",
        "RO",
        "RS",
        "RU",
        "RW",
        "SA",
        "SB",
        "SC",
        "SD",
        "SE",
        "SG",
        "SH",
        "SI",
        "SJ",
        "SK",
        "SL",
        "SM",
        "SN",
        "SO",
        "SR",
        "SS",
        "ST",
        "SV",
        "SX",
        "SY",
        "SZ",
        "TC",
        "TD",
        "TF",
        "TG",
        "TH",
        "TJ",
        "TK",
        "TL",
        "TM",
        "TN",
        "TO",
        "TR",
        "TT",
        "TV",
        "TW",
        "TZ",
        "UA",
        "UG",
        "UM",
        "US",
        "UY",
        "UZ",
        "VA",
        "VC",
        "VE",
        "VG",
        "VI",
        "VN",
        "VU",
        "WF",
        "WS",
        "YE",
        "YT",
        "ZA",
        "ZM",
        "ZW",
      ];

      const invalidCountries = req.body.special_ad_category_country.filter((cc) => !validCountries.includes(cc));
      if (invalidCountries.length > 0) {
        return res.status(400).json({
          error: `Invalid country codes: ${invalidCountries.join(", ")}`,
        });
      }
    }

    // Validate special_ad_category (singular) if provided
    if (req.body.special_ad_category) {
      const validCategories = ["NONE", "EMPLOYMENT", "HOUSING", "FINANCIAL_PRODUCTS_SERVICES", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING"];

      // Check for deprecated CREDIT category
      if (req.body.special_ad_category === "CREDIT") {
        return res.status(400).json({
          error: "The CREDIT special ad category is no longer available. Use FINANCIAL_PRODUCTS_SERVICES instead.",
        });
      }

      if (!validCategories.includes(req.body.special_ad_category)) {
        return res.status(400).json({
          error: `Invalid special_ad_category. Must be one of: ${validCategories.join(", ")}`,
        });
      }
    }

    // Validate that special_ad_category_country is provided when special_ad_categories are selected
    // Per Meta's API requirement: When any special_ad_categories are selected, you must also set a special_ad_category_country
    const hasSpecialCategoriesArray = req.body.special_ad_categories && req.body.special_ad_categories.length > 0 && !(req.body.special_ad_categories.length === 1 && req.body.special_ad_categories[0] === "NONE");

    const hasSpecialCategorySingular = req.body.special_ad_category && req.body.special_ad_category !== "NONE";

    const hasSpecialCategories = hasSpecialCategoriesArray || hasSpecialCategorySingular;

    if (hasSpecialCategories) {
      if (!req.body.special_ad_category_country || req.body.special_ad_category_country.length === 0) {
        return res.status(400).json({
          error: "Special Ad Category Country is required when Special Ad Categories are selected. Please select at least one country for your special ad category targeting.",
        });
      }
    }

    // Validate campaign_optimization_type if provided
    if (req.body.campaign_optimization_type) {
      const validTypes = ["NONE", "ICO_ONLY"];
      if (!validTypes.includes(req.body.campaign_optimization_type)) {
        return res.status(400).json({
          error: `Invalid campaign_optimization_type. Must be one of: ${validTypes.join(", ")}`,
        });
      }
    }

    // Validate execution_options if provided
    if (req.body.execution_options) {
      if (!Array.isArray(req.body.execution_options)) {
        return res.status(400).json({
          error: "execution_options must be an array",
        });
      }
      const validOptions = ["validate_only", "include_recommendations"];
      const invalidOptions = req.body.execution_options.filter((opt) => !validOptions.includes(opt));
      if (invalidOptions.length > 0) {
        return res.status(400).json({
          error: `Invalid execution_options: ${invalidOptions.join(", ")}. Must be one of: ${validOptions.join(", ")}`,
        });
      }
    }

    // Validate adset_budgets if provided
    if (req.body.adset_budgets) {
      if (!Array.isArray(req.body.adset_budgets)) {
        return res.status(400).json({
          error: "adset_budgets must be an array",
        });
      }
      // Validate each budget object
      for (const budget of req.body.adset_budgets) {
        if (!budget.adset_id) {
          return res.status(400).json({
            error: "Each adset_budgets entry must have an adset_id",
          });
        }
        if (!budget.daily_budget && !budget.lifetime_budget) {
          return res.status(400).json({
            error: "Each adset_budgets entry must have either daily_budget or lifetime_budget",
          });
        }
      }
    }

    // Validate adset_bid_amounts if provided
    if (req.body.adset_bid_amounts) {
      if (typeof req.body.adset_bid_amounts !== "object" || Array.isArray(req.body.adset_bid_amounts)) {
        return res.status(400).json({
          error: "adset_bid_amounts must be a JSON object mapping adset IDs to bid amounts",
        });
      }
    }

    // Validate boolean flags
    const booleanFields = ["budget_rebalance_flag", "is_adset_budget_sharing_enabled", "is_skadnetwork_attribution", "is_using_l3_schedule"];
    for (const field of booleanFields) {
      if (req.body[field] !== undefined && typeof req.body[field] !== "boolean") {
        return res.status(400).json({
          error: `${field} must be a boolean value`,
        });
      }
    }

    // Validate start_time and stop_time if provided
    if (req.body.start_time && isNaN(Date.parse(req.body.start_time))) {
      return res.status(400).json({ error: "start_time must be a valid datetime" });
    }

    if (req.body.stop_time && isNaN(Date.parse(req.body.stop_time))) {
      return res.status(400).json({ error: "stop_time must be a valid datetime" });
    }

    next();
  },

  // Validate ad set creation
  createAdSet: (req, res, next) => {
    const requiredFields = ["account_id", "campaign_id", "name", "optimization_goal", "billing_event", "status"];
    const missingFields = requiredFields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // Budget validation - Note: Budget is optional for ad sets when using Campaign Budget Optimization (CBO)
    // Meta API allows ad sets without budget when the campaign has budget optimization enabled
    // Only validate budget if provided
    if (req.body.daily_budget || req.body.lifetime_budget) {
      // Validate budget values if provided
      if (req.body.daily_budget && isNaN(parseFloat(req.body.daily_budget))) {
        return res.status(400).json({ error: "daily_budget must be a valid number" });
      }

      if (req.body.lifetime_budget && isNaN(parseFloat(req.body.lifetime_budget))) {
        return res.status(400).json({ error: "lifetime_budget must be a valid number" });
      }

      // Validate that both budget types are not provided at the same time
      if (req.body.daily_budget && req.body.lifetime_budget) {
        return res.status(400).json({
          error: "Cannot specify both daily_budget and lifetime_budget",
        });
      }

      // Validate budget is greater than 0
      if (req.body.daily_budget && parseFloat(req.body.daily_budget) <= 0) {
        return res.status(400).json({
          error: "daily_budget must be greater than 0",
        });
      }

      if (req.body.lifetime_budget && parseFloat(req.body.lifetime_budget) <= 0) {
        return res.status(400).json({
          error: "lifetime_budget must be greater than 0",
        });
      }

      // Validate end_time is required when lifetime_budget is specified
      if (req.body.lifetime_budget && !req.body.end_time) {
        return res.status(400).json({
          error: "end_time is required when using lifetime_budget",
        });
      }
    }

    // Validate status
    const validStatuses = ["ACTIVE", "PAUSED"];
    if (!validStatuses.includes(req.body.status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Validate optimization_goal
    const validOptimizationGoals = [
      "NONE",
      "APP_INSTALLS",
      "AD_RECALL_LIFT",
      "ENGAGED_USERS",
      "EVENT_RESPONSES",
      "IMPRESSIONS",
      "LEAD_GENERATION",
      "QUALITY_LEAD",
      "LINK_CLICKS",
      "OFFSITE_CONVERSIONS",
      "PAGE_LIKES",
      "POST_ENGAGEMENT",
      "QUALITY_CALL",
      "REACH",
      "LANDING_PAGE_VIEWS",
      "VISIT_INSTAGRAM_PROFILE",
      "VALUE",
      "THRUPLAY",
      "DERIVED_EVENTS",
      "APP_INSTALLS_AND_OFFSITE_CONVERSIONS",
      "CONVERSATIONS",
      "IN_APP_VALUE",
      "MESSAGING_PURCHASE_CONVERSION",
      "SUBSCRIBERS",
      "REMINDERS_SET",
      "MEANINGFUL_CALL_ATTEMPT",
      "PROFILE_VISIT",
      "MESSAGING_APPOINTMENT_CONVERSION",
    ];

    if (!validOptimizationGoals.includes(req.body.optimization_goal)) {
      return res.status(400).json({
        error: `Invalid optimization_goal. Must be one of: ${validOptimizationGoals.join(", ")}`,
      });
    }

    // Validate billing_event
    const validBillingEvents = ["APP_INSTALLS", "CLICKS", "IMPRESSIONS", "LINK_CLICKS", "NONE", "OFFER_CLAIMS", "PAGE_LIKES", "POST_ENGAGEMENT", "THRUPLAY", "PURCHASE", "LISTING_INTERACTION"];

    if (!validBillingEvents.includes(req.body.billing_event)) {
      return res.status(400).json({
        error: `Invalid billing_event. Must be one of: ${validBillingEvents.join(", ")}`,
      });
    }

    // Validate adset_schedule if provided
    if (req.body.adset_schedule) {
      if (!Array.isArray(req.body.adset_schedule)) {
        return res.status(400).json({
          error: "adset_schedule must be an array of schedule objects",
        });
      }

      // Validate each schedule object
      for (let i = 0; i < req.body.adset_schedule.length; i++) {
        const schedule = req.body.adset_schedule[i];

        // Check required fields
        if (schedule.start_minute === undefined || schedule.start_minute === null) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: start_minute is required`,
          });
        }

        if (schedule.end_minute === undefined || schedule.end_minute === null) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: end_minute is required`,
          });
        }

        if (!schedule.days || !Array.isArray(schedule.days)) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: days must be an array`,
          });
        }

        // Validate start_minute and end_minute are integers
        if (!Number.isInteger(schedule.start_minute) || !Number.isInteger(schedule.end_minute)) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: start_minute and end_minute must be integers`,
          });
        }

        // Validate minute range (0-1439 for 24 hours * 60 minutes - 1)
        if (schedule.start_minute < 0 || schedule.start_minute > 1439) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: start_minute must be between 0 and 1439`,
          });
        }

        if (schedule.end_minute < 0 || schedule.end_minute > 1439) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: end_minute must be between 0 and 1439`,
          });
        }

        // Validate hour-boundaries (multiples of 60)
        if (schedule.start_minute % 60 !== 0) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: start_minute must be a multiple of 60 (full hour)`,
          });
        }

        if (schedule.end_minute % 60 !== 0) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: end_minute must be a multiple of 60 (full hour)`,
          });
        }

        // Validate that start and end are at least 1 hour apart (60 minutes)
        const duration = schedule.end_minute - schedule.start_minute;
        if (duration < 60) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: start_minute and end_minute must be at least 60 minutes apart`,
          });
        }

        // Validate days array
        if (schedule.days.length === 0) {
          return res.status(400).json({
            error: `adset_schedule[${i}]: days array cannot be empty`,
          });
        }

        // Validate each day value is 0-6
        for (const day of schedule.days) {
          if (!Number.isInteger(day) || day < 0 || day > 6) {
            return res.status(400).json({
              error: `adset_schedule[${i}]: days must contain integers between 0 (Sunday) and 6 (Saturday)`,
            });
          }
        }

        // Validate timezone_type if provided
        if (schedule.timezone_type) {
          const validTimezoneTypes = ["USER", "ADVERTISER"];
          if (!validTimezoneTypes.includes(schedule.timezone_type)) {
            return res.status(400).json({
              error: `adset_schedule[${i}]: timezone_type must be either USER or ADVERTISER`,
            });
          }
        }
      }

      // Note: Ad scheduling only works with lifetime budgets
      // if (!req.body.lifetime_budget) {
      //   return res.status(400).json({
      //     error: "adset_schedule requires lifetime_budget to be set (ad scheduling only works with lifetime budgets)",
      //   });
      // }
    }

    // Validate bid_strategy if provided
    if (req.body.bid_strategy) {
      const validBidStrategies = ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"];

      if (!validBidStrategies.includes(req.body.bid_strategy)) {
        return res.status(400).json({
          error: `Invalid bid_strategy. Must be one of: ${validBidStrategies.join(", ")}`,
        });
      }
    }

    // Validate destination_type if provided
    if (req.body.destination_type) {
      const validDestinationTypes = [
        "WEBSITE",
        "APP",
        "MESSENGER",
        "APPLINKS_AUTOMATIC",
        "WHATSAPP",
        "INSTAGRAM_DIRECT",
        "FACEBOOK",
        "ON_AD",
        "ON_POST",
        "ON_VIDEO",
        "ON_PAGE",
        "INSTAGRAM_PROFILE",
        "MESSAGING_MESSENGER_WHATSAPP",
        "MESSAGING_INSTAGRAM_DIRECT_MESSENGER",
        "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP",
        "SHOP_AUTOMATIC",
      ];

      if (!validDestinationTypes.includes(req.body.destination_type)) {
        return res.status(400).json({
          error: `Invalid destination_type. Must be one of: ${validDestinationTypes.join(", ")}`,
        });
      }
    }

    // Validate start_time and end_time if provided
    if (req.body.start_time && isNaN(Date.parse(req.body.start_time))) {
      return res.status(400).json({ error: "start_time must be a valid ISO 8601 datetime" });
    }

    if (req.body.end_time && isNaN(Date.parse(req.body.end_time))) {
      return res.status(400).json({ error: "end_time must be a valid ISO 8601 datetime" });
    }

    // Validate age targeting if provided
    if (req.body.min_age !== undefined) {
      const minAge = parseInt(req.body.min_age);
      if (isNaN(minAge) || minAge < 13 || minAge > 65) {
        return res.status(400).json({
          error: "min_age must be a number between 13 and 65",
        });
      }
    }

    if (req.body.max_age !== undefined) {
      const maxAge = parseInt(req.body.max_age);
      if (isNaN(maxAge) || maxAge < 13 || maxAge > 65) {
        return res.status(400).json({
          error: "max_age must be a number between 13 and 65",
        });
      }
    }

    if (req.body.min_age && req.body.max_age) {
      if (parseInt(req.body.min_age) > parseInt(req.body.max_age)) {
        return res.status(400).json({
          error: "min_age cannot be greater than max_age",
        });
      }
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

  // Validate automated rule creation
  createRule: (req, res, next) => {
    const { name, ad_account_id, entity_type, conditions, action, rule_type, schedule } = req.body;

    // Required fields
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    if (!ad_account_id) {
      return res.status(400).json({ error: "ad_account_id is required" });
    }

    if (!entity_type) {
      return res.status(400).json({ error: "entity_type is required" });
    }

    // Validate entity_type
    const validEntityTypes = ["CAMPAIGN", "ADSET", "AD"];
    if (!validEntityTypes.includes(entity_type)) {
      return res.status(400).json({
        error: `Invalid entity_type. Must be one of: ${validEntityTypes.join(", ")}`,
      });
    }

    // Validate rule_type
    if (rule_type) {
      const validRuleTypes = ["TRIGGER", "SCHEDULE"];
      if (!validRuleTypes.includes(rule_type)) {
        return res.status(400).json({
          error: `Invalid rule_type. Must be one of: ${validRuleTypes.join(", ")}`,
        });
      }
    }

    // Validate conditions
    if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
      return res.status(400).json({ error: "conditions array is required and must not be empty" });
    }

    // Validate each condition
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];

      if (!condition.field) {
        return res.status(400).json({
          error: `Condition at index ${i} is missing required field: field`,
        });
      }

      if (!condition.operator) {
        return res.status(400).json({
          error: `Condition at index ${i} is missing required field: operator`,
        });
      }

      if (condition.value === undefined || condition.value === null) {
        return res.status(400).json({
          error: `Condition at index ${i} is missing required field: value`,
        });
      }

      // Validate operator
      const validOperators = ["GREATER_THAN", "LESS_THAN", "GREATER_THAN_OR_EQUAL", "LESS_THAN_OR_EQUAL", "EQUAL", "NOT_EQUAL", "IN_RANGE", "NOT_IN_RANGE"];
      if (!validOperators.includes(condition.operator)) {
        return res.status(400).json({
          error: `Condition at index ${i} has invalid operator. Must be one of: ${validOperators.join(", ")}`,
        });
      }

      // Validate array values for range operators
      if (condition.operator === "IN_RANGE" || condition.operator === "NOT_IN_RANGE") {
        if (!Array.isArray(condition.value) || condition.value.length !== 2) {
          return res.status(400).json({
            error: `Condition at index ${i} with operator ${condition.operator} must have a value array with exactly 2 elements [min, max]`,
          });
        }
        if (typeof condition.value[0] !== "number" || typeof condition.value[1] !== "number") {
          return res.status(400).json({
            error: `Condition at index ${i} with operator ${condition.operator} must have numeric values in the array`,
          });
        }
        if (condition.value[0] >= condition.value[1]) {
          return res.status(400).json({
            error: `Condition at index ${i} with operator ${condition.operator} must have min value less than max value`,
          });
        }
      }

      // Validate common metric fields
      const validFields = [
        "spend",
        "impressions",
        "clicks",
        "reach",
        "frequency",
        "cpm",
        "cpc",
        "ctr",
        "cost_per_action_type",
        "actions",
        "conversions",
        "cost_per_conversion",
        "roas",
        "purchase_value",
        "cost_per_purchase",
        "video_thruplay_watched_actions",
        "video_p100_watched_actions",
      ];

      if (!validFields.includes(condition.field)) {
        console.warn(`Warning: Condition field '${condition.field}' is not in the common fields list. It may still be valid.`);
      }
    }

    // Validate action
    if (!action) {
      return res.status(400).json({ error: "action is required" });
    }

    if (!action.type) {
      return res.status(400).json({ error: "action.type is required" });
    }

    const validActionTypes = ["PAUSE", "UNPAUSE", "CHANGE_BUDGET", "CHANGE_BID", "SEND_NOTIFICATION"];
    if (!validActionTypes.includes(action.type)) {
      return res.status(400).json({
        error: `Invalid action.type. Must be one of: ${validActionTypes.join(", ")}`,
      });
    }

    // Validate action-specific fields
    if (action.type === "CHANGE_BUDGET") {
      if (!action.budget_change_type) {
        return res.status(400).json({
          error: "action.budget_change_type is required for CHANGE_BUDGET action",
        });
      }

      // API Limitation: 'SET' is not supported for budget changes.
      if (action.budget_change_type === "SET") {
        return res.status(400).json({
          error: "Invalid action: The Meta API does not support setting a budget to a specific amount, only increasing or decreasing it.",
        });
      }

      const validBudgetChangeTypes = ["INCREASE", "DECREASE"];
      if (!validBudgetChangeTypes.includes(action.budget_change_type)) {
        return res.status(400).json({
          error: `Invalid action.budget_change_type. Must be one of: ${validBudgetChangeTypes.join(", ")}`,
        });
      }

      if (action.amount === undefined || action.amount === null) {
        return res.status(400).json({
          error: "action.amount is required for CHANGE_BUDGET action",
        });
      }

      if (isNaN(parseFloat(action.amount))) {
        return res.status(400).json({
          error: "action.amount must be a valid number",
        });
      }

      // Validate budget_type for ADSET entity_type
      if (entity_type === "ADSET") {
        if (!action.budget_type) {
          return res.status(400).json({
            error: "action.budget_type is required for CHANGE_BUDGET action on ADSET",
          });
        }

        const validBudgetTypes = ["daily_budget", "lifetime_budget"];
        if (!validBudgetTypes.includes(action.budget_type)) {
          return res.status(400).json({
            error: `Invalid action.budget_type. Must be one of: ${validBudgetTypes.join(", ")}`,
          });
        }
      }
    }

    if (action.type === "CHANGE_BID") {
      if (!action.bid_change_type) {
        return res.status(400).json({
          error: "action.bid_change_type is required for CHANGE_BID action",
        });
      }

      const validBidChangeTypes = ["INCREASE", "DECREASE", "SET"];
      if (!validBidChangeTypes.includes(action.bid_change_type)) {
        return res.status(400).json({
          error: `Invalid action.bid_change_type. Must be one of: ${validBidChangeTypes.join(", ")}`,
        });
      }

      if (action.amount === undefined || action.amount === null) {
        return res.status(400).json({
          error: "action.amount is required for CHANGE_BID action",
        });
      }

      if (isNaN(parseFloat(action.amount))) {
        return res.status(400).json({
          error: "action.amount must be a valid number",
        });
      }
    }

    // API Limitation: Scheduled rules have operator restrictions.
    // if (rule_type === "SCHEDULE") {
    //   const scheduledOperators = ["EQUAL", "IN"];
    //   for (const condition of conditions) {
    //     if (!scheduledOperators.includes(condition.operator)) {
    //       return res.status(400).json({
    //         error: `Invalid operator for scheduled rule. Operator must be EQUAL or IN.`,
    //         details: `You provided the operator '${condition.operator}' for the field '${condition.field}'.`
    //       });
    //     }
    //   }
    // }

    // Validate schedule if provided
    if (schedule) {
      if (!schedule.frequency) {
        return res.status(400).json({ error: "schedule.frequency is required" });
      }

      const validFrequencies = ["CONTINUOUSLY", "HOURLY", "SEMI_HOURLY", "DAILY", "CUSTOM"];
      if (!validFrequencies.includes(schedule.frequency)) {
        return res.status(400).json({
          error: `Invalid schedule.frequency. Must be one of: ${validFrequencies.join(", ")}`,
        });
      }

      // Validate CUSTOM schedule
      if (schedule.frequency === "CUSTOM") {
        if (!schedule.days || !Array.isArray(schedule.days) || schedule.days.length === 0) {
          return res.status(400).json({
            error: "schedule.days array is required for CUSTOM frequency",
          });
        }

        // Validate days (0-6, Sunday-Saturday)
        for (const day of schedule.days) {
          if (!Number.isInteger(day) || day < 0 || day > 6) {
            return res.status(400).json({
              error: "schedule.days must contain integers between 0 (Sunday) and 6 (Saturday)",
            });
          }
        }

        if (schedule.start_minute === undefined || schedule.start_minute === null) {
          return res.status(400).json({
            error: "schedule.start_minute is required for CUSTOM frequency",
          });
        }

        if (schedule.end_minute === undefined || schedule.end_minute === null) {
          return res.status(400).json({
            error: "schedule.end_minute is required for CUSTOM frequency",
          });
        }

        // Validate minute range (0-1439)
        if (!Number.isInteger(schedule.start_minute) || schedule.start_minute < 0 || schedule.start_minute > 1439) {
          return res.status(400).json({
            error: "schedule.start_minute must be an integer between 0 and 1439",
          });
        }

        if (!Number.isInteger(schedule.end_minute) || schedule.end_minute < 0 || schedule.end_minute > 1439) {
          return res.status(400).json({
            error: "schedule.end_minute must be an integer between 0 and 1439",
          });
        }
      }
    }

    next();
  },

  // Validate rule update
  updateRule: (req, res, next) => {
    const { name, entity_type, conditions, action, rule_type, schedule, status } = req.body;

    // At least one field must be provided for update
    if (!name && !entity_type && !conditions && !action && !rule_type && !schedule && !status) {
      return res.status(400).json({
        error: "At least one field must be provided for update",
      });
    }

    // Validate entity_type if provided
    if (entity_type) {
      const validEntityTypes = ["CAMPAIGN", "ADSET", "AD"];
      if (!validEntityTypes.includes(entity_type)) {
        return res.status(400).json({
          error: `Invalid entity_type. Must be one of: ${validEntityTypes.join(", ")}`,
        });
      }
    }

    // Validate rule_type if provided
    if (rule_type) {
      const validRuleTypes = ["TRIGGER", "SCHEDULE"];
      if (!validRuleTypes.includes(rule_type)) {
        return res.status(400).json({
          error: `Invalid rule_type. Must be one of: ${validRuleTypes.join(", ")}`,
        });
      }
    }

    // Validate status if provided
    if (status) {
      const validStatuses = ["ACTIVE", "PAUSED", "DELETED"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }
    }

    // Validate conditions if provided
    if (conditions) {
      if (!Array.isArray(conditions) || conditions.length === 0) {
        return res.status(400).json({ error: "conditions must be a non-empty array" });
      }

      // Validate each condition (same as create)
      for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i];

        if (!condition.field || !condition.operator || condition.value === undefined || condition.value === null) {
          return res.status(400).json({
            error: `Condition at index ${i} is missing required fields (field, operator, value)`,
          });
        }

        const validOperators = ["GREATER_THAN", "LESS_THAN", "GREATER_THAN_OR_EQUAL", "LESS_THAN_OR_EQUAL", "EQUAL", "NOT_EQUAL", "IN_RANGE", "NOT_IN_RANGE"];
        if (!validOperators.includes(condition.operator)) {
          return res.status(400).json({
            error: `Condition at index ${i} has invalid operator`,
          });
        }

        // Validate array values for range operators
        if (condition.operator === "IN_RANGE" || condition.operator === "NOT_IN_RANGE") {
          if (!Array.isArray(condition.value) || condition.value.length !== 2) {
            return res.status(400).json({
              error: `Condition at index ${i} with operator ${condition.operator} must have a value array with exactly 2 elements [min, max]`,
            });
          }
          if (typeof condition.value[0] !== "number" || typeof condition.value[1] !== "number") {
            return res.status(400).json({
              error: `Condition at index ${i} with operator ${condition.operator} must have numeric values in the array`,
            });
          }
          if (condition.value[0] >= condition.value[1]) {
            return res.status(400).json({
              error: `Condition at index ${i} with operator ${condition.operator} must have min value less than max value`,
            });
          }
        }
      }
    }

    // Validate action if provided
    if (action) {
      if (!action.type) {
        return res.status(400).json({ error: "action.type is required" });
      }

      const validActionTypes = ["PAUSE", "UNPAUSE", "CHANGE_BUDGET", "CHANGE_BID", "SEND_NOTIFICATION"];
      if (!validActionTypes.includes(action.type)) {
        return res.status(400).json({
          error: `Invalid action.type. Must be one of: ${validActionTypes.join(", ")}`,
        });
      }

      if (action.type === "CHANGE_BUDGET") {
        if (action.budget_change_type === "SET") {
          return res.status(400).json({
            error: "Invalid action: The Meta API does not support setting a budget to a specific amount, only increasing or decreasing it.",
          });
        }
      }
    }

    // API Limitation: Scheduled rules have operator restrictions.
    // if (rule_type === "SCHEDULE" && conditions) {
    //     const scheduledOperators = ["EQUAL", "IN"];
    //     for (const condition of conditions) {
    //         if (condition.operator && !scheduledOperators.includes(condition.operator)) {
    //             return res.status(400).json({
    //                 error: `Invalid operator for scheduled rule. Operator must be EQUAL or IN.`,
    //                 details: `You provided the operator '${condition.operator}' for the field '${condition.field}'.`
    //             });
    //         }
    //     }
    // }

    // Validate schedule if provided (same validation as create)
    if (schedule) {
      if (!schedule.frequency) {
        return res.status(400).json({ error: "schedule.frequency is required" });
      }

      const validFrequencies = ["CONTINUOUSLY", "HOURLY", "SEMI_HOURLY", "DAILY", "CUSTOM"];
      if (!validFrequencies.includes(schedule.frequency)) {
        return res.status(400).json({
          error: `Invalid schedule.frequency. Must be one of: ${validFrequencies.join(", ")}`,
        });
      }

      if (schedule.frequency === "CUSTOM") {
        if (!schedule.days || !Array.isArray(schedule.days) || schedule.days.length === 0) {
          return res.status(400).json({
            error: "schedule.days array is required for CUSTOM frequency",
          });
        }
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
