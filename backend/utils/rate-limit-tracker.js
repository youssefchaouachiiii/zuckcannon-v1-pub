/**
 * Rate Limit Tracker for Facebook Graph API
 * Monitors X-Business-Use-Case-Usage header to track API quota usage
 */

export class RateLimitTracker {
  constructor() {
    this.usageHistory = new Map(); // accountId -> usage data
    this.operationTypeHistory = new Map(); // accountId -> { operationType -> count }
    this.warningThreshold = 42; // Warn at 70% (42/60 for development tier)
    this.criticalThreshold = 51; // Critical at 85% (51/60 for development tier)
  }

  /**
   * Parse X-Business-Use-Case-Usage header from Facebook API response
   * @param {string} headerValue - Raw header value from response.headers['x-business-use-case-usage']
   * @returns {object|null} Parsed usage data or null if parsing fails
   */
  parseBusinessUsageHeader(headerValue) {
    if (!headerValue) return null;

    try {
      const parsed = JSON.parse(headerValue);
      const accountId = Object.keys(parsed)[0];

      if (!accountId || !parsed[accountId] || !parsed[accountId][0]) {
        return null;
      }

      const [usage] = parsed[accountId];

      return {
        accountId,
        type: usage.type || "ads_management",
        callCount: usage.call_count || 0,
        totalCpuTime: usage.total_cputime || 0,
        totalTime: usage.total_time || 0,
        estimatedTimeToRegainAccess: usage.estimated_time_to_regain_access || 0,
        tier: usage.ads_api_access_tier || "unknown",
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("[RateLimitTracker] Error parsing business usage header:", error);
      return null;
    }
  }

  /**
   * Update usage history for an account
   * @param {object} usageData - Parsed usage data from parseBusinessUsageHeader
   */
  updateUsage(usageData) {
    if (!usageData || !usageData.accountId) return;

    this.usageHistory.set(usageData.accountId, usageData);

    // Log if approaching limits
    if (this.isApproachingLimit(usageData)) {
      console.warn(`[RateLimitTracker] ⚠️ Ad Account ${usageData.accountId} approaching rate limit:\n` + `  Calls: ${usageData.callCount} | Tier: ${usageData.tier}\n` + `  Time to regain access: ${usageData.estimatedTimeToRegainAccess}s`);
    }

    if (this.isCritical(usageData)) {
      console.error(
        `[RateLimitTracker] 🚨 Ad Account ${usageData.accountId} CRITICAL rate limit:\n` + `  Calls: ${usageData.callCount} | Time to regain: ${usageData.estimatedTimeToRegainAccess}s\n` + `  RECOMMEND: Pause operations for this account!`
      );
    }
  }

  /**
   * Check if account is approaching rate limit
   * @param {object} usageData - Usage data object
   * @returns {boolean}
   */
  isApproachingLimit(usageData) {
    if (!usageData) return false;
    return usageData.callCount >= this.warningThreshold;
  }

  /**
   * Check if account is in critical state (near or at limit)
   * @param {object} usageData - Usage data object
   * @returns {boolean}
   */
  isCritical(usageData) {
    if (!usageData) return false;

    // Use configured threshold (85% of limit)
    // Development tier: 51/60 calls
    // Standard tier: 170/200 calls
    const isDevelopmentTier = usageData.tier === "development_access";
    const criticalCount = isDevelopmentTier ? this.criticalThreshold : 170;

    return usageData.callCount >= criticalCount || usageData.estimatedTimeToRegainAccess > 0;
  }

  /**
   * Determine if we should throttle/delay the next request
   * @param {string} accountId - Ad account ID
   * @returns {boolean}
   */
  shouldThrottleRequest(accountId) {
    const usage = this.getUsage(accountId);
    if (!usage) return false;

    return this.isCritical(usage);
  }

  /**
   * Get recommended delay in milliseconds before next request
   * 4-Tier Delay System aligned with Meta's Rolling Window principle:
   * - Tier 1 (Banned): Wait as instructed by Meta
   * - Tier 2 (Critical Zone >85%): 5 minutes to reset score
   * - Tier 3 (Warning Zone 50-85%): 15-20s to smooth traffic (NEW!)
   * - Tier 4 (Safe Zone <50%): 5s standard delay
   *
   * @param {string} accountId - Ad account ID
   * @param {string} operationType - Optional operation type for type-specific delays
   * @returns {number} Delay in milliseconds
   */
  getRecommendedDelay(accountId, operationType = null) {
    const usage = this.getUsage(accountId);
    if (!usage) return 0;

    // Calculate load percentage
    const isDevelopmentTier = usage.tier === "development_access";
    const maxCalls = isDevelopmentTier ? 60 : 200;
    const loadPercentage = (usage.callCount / maxCalls) * 100;

    // Base delay from rate limit status
    let baseDelay = 0;

    // ✅ TIER 1: BANNED - Wait as Meta instructs
    if (usage.estimatedTimeToRegainAccess > 0) {
      baseDelay = (usage.estimatedTimeToRegainAccess + 10) * 1000;
      console.log(`[RateLimitTracker] 🚫 TIER 1 BANNED - Meta requested ${usage.estimatedTimeToRegainAccess}s wait, adding 10s buffer`);
    }
    // ✅ TIER 2: CRITICAL ZONE (>85%) - 5 minute break to reset score
    else if (this.isCritical(usage)) {
      baseDelay = 5 * 60 * 1000;
      console.log(`[RateLimitTracker] 🚨 TIER 2 CRITICAL ZONE (${loadPercentage.toFixed(1)}%) - enforcing 5-minute break`);
    }
    // ✅ TIER 3: WARNING ZONE (50-85%) - Slow down mode (NEW!)
    else if (this.isApproachingLimit(usage)) {
      // Use 15-20 second delay to smooth traffic and prevent spikes
      baseDelay = 15000 + Math.random() * 5000; // 15-20s randomized
      console.log(`[RateLimitTracker] ⚠️ TIER 3 WARNING ZONE (${loadPercentage.toFixed(1)}%) - slowing down with ${(baseDelay / 1000).toFixed(1)}s delay`);
    }
    // ✅ TIER 4: SAFE ZONE (<50%) - Standard operation
    else {
      // Standard 5-second delay for normal traffic
      baseDelay = 5000;
      console.log(`[RateLimitTracker] ✅ TIER 4 SAFE ZONE (${loadPercentage.toFixed(1)}%) - standard 5s delay`);
    }

    // Add operation-specific delay only in Safe Zone (if no base delay already applied)
    if (operationType && loadPercentage < 50) {
      const operationDelay = this.getOperationSpecificDelay(operationType);
      return Math.max(baseDelay, operationDelay);
    }

    return baseDelay;
  }

  /**
   * Get operation-specific delay based on operation type
   * Different operations have different "weights" in Meta's rate limiting
   * @param {string} operationType - Type of operation
   * @returns {number} Delay in milliseconds
   */
  getOperationSpecificDelay(operationType) {
    const delayMap = {
      image_upload: 500, // Image uploads are heavier
      video_upload: 1000, // Video uploads are heaviest
      creative_create: 300, // Creative creation is medium
      ad_create: 200, // Ad creation is lighter
      fetch_details: 100, // Fetching is lightest
      batch_request: 400, // Batch requests
      default: 200,
    };

    return delayMap[operationType] || delayMap.default;
  }

  /**
   * Track operation type for an account
   * @param {string} accountId - Ad account ID
   * @param {string} operationType - Type of operation
   */
  trackOperationType(accountId, operationType) {
    if (!this.operationTypeHistory.has(accountId)) {
      this.operationTypeHistory.set(accountId, new Map());
    }

    const accountOps = this.operationTypeHistory.get(accountId);
    const currentCount = accountOps.get(operationType) || 0;
    accountOps.set(operationType, currentCount + 1);
  }

  /**
   * Get operation type statistics for an account
   * @param {string} accountId - Ad account ID
   * @returns {object} Operation type statistics
   */
  getOperationTypeStats(accountId) {
    const accountOps = this.operationTypeHistory.get(accountId);
    if (!accountOps) return {};

    const stats = {};
    accountOps.forEach((count, type) => {
      stats[type] = count;
    });
    return stats;
  }

  /**
   * Calculate safe batch size based on remaining API quota
   * @param {string} accountId - Ad account ID
   * @param {number} maxBatchSize - Maximum batch size allowed
   * @param {number} estimatedCallsPerItem - Estimated API calls per item in batch (default: 5)
   * @returns {number} Safe batch size
   */
  getSafeBatchSize(accountId, maxBatchSize = 50, estimatedCallsPerItem = 5) {
    const usage = this.getUsage(accountId);

    if (!usage) {
      console.log(`[RateLimitTracker] No usage data for ${accountId}, using max batch size: ${maxBatchSize}`);
      return maxBatchSize;
    }

    // Development tier has 60 calls per 5 minutes
    const isDevelopmentTier = usage.tier === "development_access";
    const maxCalls = isDevelopmentTier ? 60 : 200;

    const remainingCalls = maxCalls - usage.callCount;

    console.log(`[RateLimitTracker] Account ${accountId}: ` + `${usage.callCount}/${maxCalls} calls used, ` + `${remainingCalls} remaining`);

    // If critical, only allow 1 item at a time
    if (this.isCritical(usage)) {
      console.log(`[RateLimitTracker] 🚨 Critical state - batch size limited to 1`);
      return 1;
    }

    // If approaching limit, be conservative
    if (this.isApproachingLimit(usage)) {
      const conservativeBatch = Math.min(3, Math.floor(remainingCalls / estimatedCallsPerItem));
      console.log(`[RateLimitTracker] ⚠️ Approaching limit - batch size limited to ${conservativeBatch}`);
      return Math.max(1, conservativeBatch);
    }

    // Calculate safe batch size: use 50% of remaining quota
    const safeBatchSize = Math.floor((remainingCalls * 0.5) / estimatedCallsPerItem);
    const finalBatchSize = Math.max(1, Math.min(maxBatchSize, safeBatchSize));

    console.log(`[RateLimitTracker] Calculated batch size: ${finalBatchSize} ` + `(max: ${maxBatchSize}, safe: ${safeBatchSize})`);

    return finalBatchSize;
  }

  /**
   * Get current usage data for an account
   * @param {string} accountId - Ad account ID
   * @returns {object|null}
   */
  getUsage(accountId) {
    return this.usageHistory.get(accountId) || null;
  }

  /**
   * Get all tracked accounts and their usage
   * @returns {Array} Array of usage data objects
   */
  getAllUsage() {
    return Array.from(this.usageHistory.values());
  }

  /**
   * Clear usage history for an account
   * @param {string} accountId - Ad account ID
   */
  clearUsage(accountId) {
    this.usageHistory.delete(accountId);
  }

  /**
   * Clear all usage history
   */
  clearAll() {
    this.usageHistory.clear();
  }

  /**
   * Get usage summary for logging/monitoring
   * @returns {string} Formatted summary
   */
  getSummary() {
    const allUsage = this.getAllUsage();
    if (allUsage.length === 0) {
      return "[RateLimitTracker] No usage data available";
    }

    const lines = ["[RateLimitTracker] Usage Summary:"];
    allUsage.forEach((usage) => {
      const status = this.isCritical(usage) ? "🚨 CRITICAL" : this.isApproachingLimit(usage) ? "⚠️ WARNING" : "✅ OK";
      lines.push(`  ${status} Account ${usage.accountId}: ${usage.callCount} calls, ` + `Tier: ${usage.tier}, Wait: ${usage.estimatedTimeToRegainAccess}s`);
    });

    return lines.join("\n");
  }
}

// Singleton instance
export const rateLimitTracker = new RateLimitTracker();

/**
 * Axios interceptor helper to automatically track rate limits
 * @param {object} response - Axios response object
 * @returns {object} Same response (for chaining)
 */
export function trackRateLimitFromResponse(response) {
  if (!response || !response.headers) return response;

  const headerValue = response.headers["x-business-use-case-usage"];
  if (headerValue) {
    const usageData = rateLimitTracker.parseBusinessUsageHeader(headerValue);
    if (usageData) {
      rateLimitTracker.updateUsage(usageData);
    }
  }

  return response;
}

/**
 * Helper to add delay if rate limit is approaching
 * @param {string} accountId - Ad account ID
 * @param {string} operationType - Optional operation type
 * @returns {Promise<void>}
 */
export async function enforceRateLimit(accountId, operationType = null) {
  const delay = rateLimitTracker.getRecommendedDelay(accountId, operationType);

  if (operationType) {
    rateLimitTracker.trackOperationType(accountId, operationType);
  }

  if (delay > 0) {
    console.log(`[RateLimitTracker] Throttling ${operationType || "request"} for account ${accountId}, waiting ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
