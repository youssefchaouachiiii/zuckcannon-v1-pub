/**
 * Rate Limit Tracker for Facebook Graph API
 * Monitors X-Business-Use-Case-Usage header to track API quota usage
 */

export class RateLimitTracker {
  constructor() {
    this.usageHistory = new Map(); // accountId -> usage data
    this.warningThreshold = 25; // Warn at 25 calls (Development tier ~100 calls/hour)
    this.criticalThreshold = 80; // Critical at 80% of limit
    
    // Debouncing untuk warning agar tidak berulang-ulang
    this.lastWarningTime = new Map(); // accountId -> timestamp
    this.warningDebounceMs = 5000; // 5 second debounce untuk WARNING tier
    this.criticalDebounceMs = 10000; // 10 second debounce untuk CRITICAL tier
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
   * Update usage history for an account with debounced warnings
   * @param {object} usageData - Parsed usage data from parseBusinessUsageHeader
   */
  updateUsage(usageData) {
    if (!usageData || !usageData.accountId) return;

    const accountId = usageData.accountId;
    this.usageHistory.set(accountId, usageData);

    // Get current debounce status
    const lastWarning = this.lastWarningTime.get(accountId) || 0;
    const now = Date.now();
    const timeSinceLastWarning = now - lastWarning;

    // Check if CRITICAL (high priority warning - less debounce)
    if (this.isCritical(usageData)) {
      if (timeSinceLastWarning >= this.criticalDebounceMs) {
        console.error(
          `[RateLimitTracker] 🚨 Ad Account ${accountId} CRITICAL rate limit:\n` +
          `  Calls: ${usageData.callCount} | Tier: ${usageData.tier}\n` +
          `  Time to regain: ${usageData.estimatedTimeToRegainAccess}s\n` +
          `  RECOMMEND: Pause operations for this account!`
        );
        this.lastWarningTime.set(accountId, now);
      }
    }
    // Check if APPROACHING (warning priority - more debounce)
    else if (this.isApproachingLimit(usageData)) {
      if (timeSinceLastWarning >= this.warningDebounceMs) {
        console.warn(
          `[RateLimitTracker] ⚠️ Ad Account ${accountId} approaching rate limit:\n` +
          `  Calls: ${usageData.callCount} | Tier: ${usageData.tier}\n` +
          `  Time to regain access: ${usageData.estimatedTimeToRegainAccess}s`
        );
        this.lastWarningTime.set(accountId, now);
      }
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

    // Development tier: ~100 calls/hour, so 80+ is critical
    // Standard tier: ~200 calls/hour, so 160+ is critical
    const isDevelopmentTier = usageData.tier === "development_access";
    const criticalCount = isDevelopmentTier ? 80 : 160;

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
   * @param {string} accountId - Ad account ID
   * @returns {number} Delay in milliseconds
   */
  getRecommendedDelay(accountId) {
    const usage = this.getUsage(accountId);
    if (!usage) return 0;

    if (usage.estimatedTimeToRegainAccess > 0) {
      // If Meta says we need to wait, wait that long + buffer
      return (usage.estimatedTimeToRegainAccess + 10) * 1000;
    }

    if (this.isCritical(usage)) {
      // Critical but no explicit wait time: use 5 minutes
      return 5 * 60 * 1000;
    }

    if (this.isApproachingLimit(usage)) {
      // Approaching limit: add 2-5 second delays between requests
      return 2000 + Math.random() * 3000;
    }

    return 0;
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
   * Get current TIER based on call_count for an account
   * Sesuai dengan TIER system di AdaptiveSerialQueue
   * @param {string} accountId - Ad account ID
   * @returns {object} { tier, callCount, estimatedTimeToRegainAccess, recommendation }
   */
  getCurrentTier(accountId) {
    const usage = this.getUsage(accountId);
    if (!usage) {
      return {
        tier: "UNKNOWN",
        callCount: 0,
        estimatedTimeToRegainAccess: 0,
        recommendation: "No usage data",
      };
    }

    const { callCount, estimatedTimeToRegainAccess } = usage;

    // TIER 1 - BLOCKED
    if (estimatedTimeToRegainAccess > 0) {
      return {
        tier: "BLOCKED",
        callCount,
        estimatedTimeToRegainAccess,
        recommendation: `🛑 BLOCKED: Wait ${estimatedTimeToRegainAccess}s for access to regain`,
      };
    }

    // TIER 2 - CRITICAL
    if (callCount > 85) {
      return {
        tier: "CRITICAL",
        callCount,
        estimatedTimeToRegainAccess: 0,
        recommendation: "⚠️ CRITICAL: Apply 300s delay, approaching hard limit",
      };
    }

    // TIER 3 - WARNING
    if (callCount >= 50 && callCount <= 85) {
      return {
        tier: "WARNING",
        callCount,
        estimatedTimeToRegainAccess: 0,
        recommendation: "⚡ WARNING: Apply 15-20s random delay, getting close to limit",
      };
    }

    // TIER 4 - SAFE
    return {
      tier: "SAFE",
      callCount,
      estimatedTimeToRegainAccess: 0,
      recommendation: "✅ SAFE: Apply 5s delay, normal operations",
    };
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
 * @returns {Promise<void>}
 */
export async function enforceRateLimit(accountId) {
  const delay = rateLimitTracker.getRecommendedDelay(accountId);

  if (delay > 0) {
    console.log(`[RateLimitTracker] Throttling request for account ${accountId}, waiting ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
