/**
 * Adaptive Serial Queue for Meta API Operations
 * Processes operations sequentially with adaptive rate limiting
 * Designed for Development Tier (60 points / 5 minutes)
 */

import { rateLimitTracker, enforceRateLimit } from "./rate-limit-tracker.js";

export class AdaptiveSerialQueue {
  constructor(accountId, options = {}) {
    this.accountId = accountId;
    this.queue = [];
    this.processing = false;
    this.completed = 0;
    this.failed = 0;
    this.results = [];

    // Options
    this.maxRetries = options.maxRetries || 3;
    this.onProgress = options.onProgress || null;
    this.onError = options.onError || null;
    this.onComplete = options.onComplete || null;

    // Operation tracking
    this.currentOperation = null;
    this.startTime = null;

    // TIER-based rate limiting settings
    this.tierSystem = {
      BLOCKED: { name: "BLOCKED", baseDelay: 0 }, // Will wait for ETA
      CRITICAL: { name: "CRITICAL", delay: 300000 }, // 300 seconds
      WARNING: { name: "WARNING", delayMin: 15000, delayMax: 20000 }, // 15-20 seconds
      SAFE: { name: "SAFE", delay: 5000 }, // 5 seconds
    };
  }

  /**
   * Add operation to queue
   * @param {object} operation - Operation object with execute function
   * @returns {Promise<void>}
   */
  enqueue(operation) {
    if (!operation.execute || typeof operation.execute !== "function") {
      throw new Error("Operation must have an execute() function");
    }

    // Add default properties
    const enhancedOperation = {
      id: operation.id || `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: operation.type || "unknown",
      execute: operation.execute,
      metadata: operation.metadata || {},
      retryCount: 0,
      status: "pending",
    };

    this.queue.push(enhancedOperation);
    console.log(`[AdaptiveSerialQueue] Enqueued operation ${enhancedOperation.id} (type: ${enhancedOperation.type})`);
  }

  /**
   * Process all operations in queue sequentially
   * @returns {Promise<Array>} Array of results
   */
  async processQueue() {
    if (this.processing) {
      console.warn("[AdaptiveSerialQueue] Queue is already processing");
      return this.results;
    }

    this.processing = true;
    this.startTime = Date.now();
    this.results = [];

    console.log(`[AdaptiveSerialQueue] Starting queue processing for account ${this.accountId}`);
    console.log(`[AdaptiveSerialQueue] Total operations: ${this.queue.length}`);

    while (this.queue.length > 0) {
      const operation = this.queue.shift();
      this.currentOperation = operation;

      try {
        // ✅ ADAPTIVE RATE LIMIT CHECK BEFORE OPERATION
        await this.checkAndEnforceRateLimit(operation);

        // Execute operation
        console.log(`[AdaptiveSerialQueue] Executing operation ${operation.id} (${operation.type})...`);
        const result = await this.executeWithRetry(operation);

        // Mark as success
        operation.status = "completed";
        this.completed++;
        this.results.push({
          id: operation.id,
          type: operation.type,
          status: "success",
          result: result,
          metadata: operation.metadata,
        });

        // Progress callback
        if (this.onProgress) {
          this.onProgress({
            completed: this.completed,
            failed: this.failed,
            total: this.completed + this.failed + this.queue.length,
            currentOperation: operation.type,
            accountId: this.accountId,
          });
        }

        console.log(`[AdaptiveSerialQueue] ✅ Operation ${operation.id} completed successfully`);
      } catch (error) {
        // Mark as failed
        operation.status = "failed";
        this.failed++;
        this.results.push({
          id: operation.id,
          type: operation.type,
          status: "failed",
          error: error.message,
          metadata: operation.metadata,
        });

        // Error callback
        if (this.onError) {
          this.onError({
            operation: operation,
            error: error,
            accountId: this.accountId,
          });
        }

        // Enhanced error logging with specific details
        const errorDetails = this.extractErrorDetails(error);
        console.error(`[AdaptiveSerialQueue] ❌ Operation ${operation.id} failed`);
        console.error(`   Type: ${operation.type}`);
        console.error(`   Status Code: ${errorDetails.statusCode || 'N/A'}`);
        console.error(`   Error Message: ${errorDetails.message}`);
        console.error(`   Error Code: ${errorDetails.code || 'N/A'}`);
        if (errorDetails.fbErrorMessage) {
          console.error(`   Facebook Error: ${errorDetails.fbErrorMessage}`);
        }
        console.error(`   Retries: ${operation.retryCount}/${this.maxRetries}`);
      }

      this.currentOperation = null;
    }

    // Finalize
    this.processing = false;
    const duration = Date.now() - this.startTime;

    console.log(`[AdaptiveSerialQueue] Queue processing completed`);
    console.log(`[AdaptiveSerialQueue]   Completed: ${this.completed}`);
    console.log(`[AdaptiveSerialQueue]   Failed: ${this.failed}`);
    console.log(`[AdaptiveSerialQueue]   Duration: ${(duration / 1000).toFixed(2)}s`);

    // Completion callback
    if (this.onComplete) {
      this.onComplete({
        completed: this.completed,
        failed: this.failed,
        results: this.results,
        duration: duration,
        accountId: this.accountId,
      });
    }

    return this.results;
  }

  /**
   * Execute operation with retry logic
   * @param {object} operation - Operation to execute
   * @returns {Promise<any>} Operation result
   */
  async executeWithRetry(operation) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await operation.execute();
        return result;
      } catch (error) {
        lastError = error;
        operation.retryCount++;

        // Check if it's a rate limit error
        const isRateLimitError = error.response?.status === 429 || error.response?.data?.error?.code === 80004 || error.response?.data?.error?.error_subcode === 2446079;

        if (isRateLimitError && attempt < this.maxRetries) {
          // Exponential backoff for rate limit errors
          const backoffDelay = this.calculateBackoffDelay(attempt);
          console.warn(`[AdaptiveSerialQueue] Rate limit hit for operation ${operation.id}. ` + `Retry ${attempt}/${this.maxRetries} after ${backoffDelay}ms`);

          await new Promise((resolve) => setTimeout(resolve, backoffDelay));

          // Re-check rate limit before retry
          await this.checkAndEnforceRateLimit(operation);
        } else if (!isRateLimitError && attempt < this.maxRetries) {
          // Regular retry with shorter delay
          const retryDelay = 1000 * attempt;
          console.warn(`[AdaptiveSerialQueue] Operation ${operation.id} failed. ` + `Retry ${attempt}/${this.maxRetries} after ${retryDelay}ms`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          // Max retries reached or non-retryable error
          throw lastError;
        }
      }
    }

    throw lastError;
  }

  /**
   * Check rate limit and enforce delay if needed
   * @param {object} operation - Current operation
   * @returns {Promise<void>}
   */
  async checkAndEnforceRateLimit(operation) {
    const usage = rateLimitTracker.getUsage(this.accountId);

    if (usage) {
      console.log(`[AdaptiveSerialQueue] Rate limit status for ${this.accountId}: ` + `Calls: ${usage.callCount}, CPU Time: ${usage.totalCpuTime}, ` + `Total Time: ${usage.totalTime}`);

      // Apply TIER-based delay
      await this.applyTierRateLimit(usage.callCount, usage.estimatedTimeToRegainAccess);
    }

    // Enforce rate limit with adaptive delay
    await enforceRateLimit(this.accountId);

    // Additional operation-type specific delays
    const operationDelay = this.getOperationSpecificDelay(operation.type);
    if (operationDelay > 0) {
      console.log(`[AdaptiveSerialQueue] Operation-specific delay for ${operation.type}: ${operationDelay}ms`);
      await new Promise((resolve) => setTimeout(resolve, operationDelay));
    }
  }

  /**
   * Apply TIER-based rate limiting with intelligent delays
   * Checks call_count and estimated_time_to_regain_access to determine tier
   * 
   * @param {number} callCount - Current API call count
   * @param {number} estimatedTimeToRegainAccess - Seconds until access regained
   * @returns {Promise<void>}
   */
  async applyTierRateLimit(callCount, estimatedTimeToRegainAccess) {
    const tierInfo = this.getTierDelay(callCount, estimatedTimeToRegainAccess);
    
    console.log(`[AdaptiveSerialQueue] ${tierInfo.message}`);

    if (tierInfo.delay > 0) {
      console.log(`[AdaptiveSerialQueue] 💤 Applying TIER ${tierInfo.tier} delay: ${tierInfo.delay}ms (${(tierInfo.delay / 1000).toFixed(2)}s)`);
      await new Promise((resolve) => setTimeout(resolve, tierInfo.delay));
    }
  }

  /**
   * Get operation-specific delay based on operation type
   * @param {string} operationType - Type of operation
   * @returns {number} Delay in milliseconds
   */
  getOperationSpecificDelay(operationType) {
    // Different operations have different "weights" in Meta's rate limiting
    const delayMap = {
      image_upload: 500, // Image uploads are heavier
      video_upload: 1000, // Video uploads are heaviest
      creative_create: 300, // Creative creation is medium
      ad_create: 200, // Ad creation is lighter
      fetch_details: 100, // Fetching is lightest
      default: 200,
    };

    return delayMap[operationType] || delayMap.default;
  }

  /**
   * TIER-BASED RATE LIMIT SYSTEM
   * Determines delay based on current call_count and estimated_time_to_regain_access
   * 
   * TIER 1 — BLOCKED: If ETA > 0, wait until regain access
   * TIER 2 — CRITICAL: If call_count > 85, delay 300s
   * TIER 3 — WARNING: If call_count >= 50 && call_count <= 85, delay 15-20s (random)
   * TIER 4 — SAFE: If call_count < 50, delay 5s
   * 
   * @param {number} callCount - Current API call count
   * @param {number} estimatedTimeToRegainAccess - ETA in seconds
   * @returns {object} { tier, delay, message }
   */
  getTierDelay(callCount, estimatedTimeToRegainAccess) {
    // TIER 1 - BLOCKED: estimated_time_to_regain_access > 0
    if (estimatedTimeToRegainAccess > 0) {
      const delayMs = estimatedTimeToRegainAccess * 1000;
      return {
        tier: "BLOCKED",
        delay: delayMs,
        message: `🛑 TIER 1 BLOCKED: Rate limited by Meta. Waiting ${estimatedTimeToRegainAccess}s to regain access`,
      };
    }

    // TIER 2 - CRITICAL: call_count > 85
    if (callCount > 85) {
      return {
        tier: "CRITICAL",
        delay: this.tierSystem.CRITICAL.delay,
        message: `⚠️  TIER 2 CRITICAL: Call count ${callCount}/100. Waiting ${this.tierSystem.CRITICAL.delay / 1000}s`,
      };
    }

    // TIER 3 - WARNING: 50 <= call_count <= 85
    if (callCount >= 50 && callCount <= 85) {
      const randomDelay = Math.random() * (this.tierSystem.WARNING.delayMax - this.tierSystem.WARNING.delayMin) + this.tierSystem.WARNING.delayMin;
      return {
        tier: "WARNING",
        delay: randomDelay,
        message: `⚡ TIER 3 WARNING: Call count ${callCount}/100. Waiting ${(randomDelay / 1000).toFixed(1)}s (random: 15-20s)`,
      };
    }

    // TIER 4 - SAFE: call_count < 50
    return {
      tier: "SAFE",
      delay: this.tierSystem.SAFE.delay,
      message: `✅ TIER 4 SAFE: Call count ${callCount}/100. Waiting ${this.tierSystem.SAFE.delay / 1000}s`,
    };
  }

  /**
   * Calculate exponential backoff delay
   * @param {number} attempt - Retry attempt number
   * @returns {number} Delay in milliseconds
   */
  calculateBackoffDelay(attempt) {
    // Exponential backoff: 5s, 10s, 30s, 60s, etc.
    const baseDelay = 5000; // 5 seconds
    const maxDelay = 5 * 60 * 1000; // 5 minutes
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    return delay;
  }

  /**
   * Extract specific error details from axios error or generic error
   * @param {Error} error - Error object
   * @returns {object} Extracted error details
   */
  extractErrorDetails(error) {
    const details = {
      message: error.message || 'Unknown error',
      statusCode: null,
      code: null,
      fbErrorMessage: null,
    };

    // Handle axios error with response
    if (error.response) {
      details.statusCode = error.response.status;
      
      // Try to extract Facebook-specific error message
      if (error.response.data) {
        const data = error.response.data;
        
        if (data.error) {
          if (typeof data.error === 'object') {
            details.fbErrorMessage = data.error.message || JSON.stringify(data.error);
            details.code = data.error.code || data.error.error_subcode;
          } else {
            details.fbErrorMessage = data.error;
          }
        }
        
        // Extract the actual error message if different
        if (data.message && data.message !== details.message) {
          details.message = data.message;
        }
      }
    }

    // Handle rate limit errors specifically
    if (error.response?.status === 429) {
      details.message = `Rate limit exceeded (429) - API throttled`;
    } else if (error.response?.data?.error?.code === 80004) {
      details.message = `Rate limit error (code 80004) - API throttled`;
    } else if (error.response?.data?.error?.error_subcode === 2446079) {
      details.message = `Application request limit reached (2446079)`;
    }

    return details;
  }

  /**
   * Get current queue status
   * @returns {object} Status object
   */
  getStatus() {
    return {
      accountId: this.accountId,
      processing: this.processing,
      queueLength: this.queue.length,
      completed: this.completed,
      failed: this.failed,
      currentOperation: this.currentOperation
        ? {
            id: this.currentOperation.id,
            type: this.currentOperation.type,
            retryCount: this.currentOperation.retryCount,
          }
        : null,
      rateLimitStatus: rateLimitTracker.getUsage(this.accountId),
    };
  }

  /**
   * Wait until queue processing is complete
   * @returns {Promise<Array>} Results array
   */
  async waitUntilComplete() {
    if (!this.processing && this.queue.length === 0) {
      return this.results;
    }

    // If not processing yet, start it
    if (!this.processing && this.queue.length > 0) {
      return await this.processQueue();
    }

    // Wait for processing to complete
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.processing && this.queue.length === 0) {
          clearInterval(checkInterval);
          resolve(this.results);
        }
      }, 100);
    });
  }

  /**
   * Clear queue and reset state
   */
  clear() {
    this.queue = [];
    this.processing = false;
    this.completed = 0;
    this.failed = 0;
    this.results = [];
    this.currentOperation = null;
    console.log(`[AdaptiveSerialQueue] Queue cleared for account ${this.accountId}`);
  }

  /**
   * LOOP-BASED ADSET CREATION WITH PER-ITERATION RATE LIMIT CHECKING
   * 
   * Creates adsets one at a time (1 adset per iteration) with:
   * - Rate limit check after each adset
   * - TIER-based delay between iterations
   * - Support for creative uploading after each adset
   * - Detailed progress tracking and logging
   * 
   * @param {Array} adsetConfigs - Array of adset configuration objects
   * @param {Function} createAdsetFn - Function to create single adset: async (config) => result
   * @param {Function} uploadCreativesFn - Function to upload creatives: async (adsetId, creatives) => result
   * @param {object} options - Additional options like onIterationComplete callback
   * @returns {Promise<object>} { successful, failed, results }
   */
  async processAdsetCreationLoop(adsetConfigs, createAdsetFn, uploadCreativesFn = null, options = {}) {
    const totalAdsets = adsetConfigs.length;
    console.log(`\n[AdaptiveSerialQueue] 🚀 Starting LOOP-BASED ADSET CREATION`);
    console.log(`[AdaptiveSerialQueue] Total adsets to create: ${totalAdsets}`);
    console.log(`[AdaptiveSerialQueue] ════════════════════════════════════════\n`);

    const results = {
      successful: [],
      failed: [],
      totalCreated: 0,
      totalFailed: 0,
      details: [],
    };

    for (let i = 0; i < totalAdsets; i++) {
      const adsetConfig = adsetConfigs[i];
      const iterationNumber = i + 1;
      const completed = results.totalCreated;
      const failed = results.totalFailed;
      const pending = totalAdsets - iterationNumber;

      // Progress header
      console.log(`\n[AdaptiveSerialQueue] ┌────────────────────────────────────────────────────┐`);
      console.log(`[AdaptiveSerialQueue] │ PROGRESS: ${completed}/${totalAdsets} created, ${failed} failed, ${pending} pending`);
      console.log(`[AdaptiveSerialQueue] │ ITERATION ${iterationNumber}/${totalAdsets}: ${adsetConfig.name || `Adset ${iterationNumber}`}`);
      console.log(`[AdaptiveSerialQueue] └────────────────────────────────────────────────────┘`);

      try {
        // ✅ STEP 1: Check rate limit BEFORE creating adset
        console.log(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] [Step 1/3] Checking rate limit...`);
        await this.checkAndEnforceRateLimit({ type: "adset_create" });

        // ✅ STEP 2: Create the adset
        const adsetName = adsetConfig.name || `Adset ${iterationNumber}`;
        console.log(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] [Step 2/3] Creating adset: "${adsetName}"...`);
        const adsetResult = await createAdsetFn(adsetConfig);

        if (!adsetResult || !adsetResult.id) {
          throw new Error("Failed to create adset: no ID returned from API");
        }

        const adsetId = adsetResult.id;
        console.log(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] ✅ Adset created: ${adsetId}`);

        // ✅ STEP 3: Upload creatives for this adset (if provided)
        if (uploadCreativesFn && adsetConfig.creatives && adsetConfig.creatives.length > 0) {
          const creativeCount = adsetConfig.creatives.length;
          console.log(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] [Step 3/3] Uploading ${creativeCount} creative(s)...`);
          
          try {
            const creativesResult = await uploadCreativesFn(adsetId, adsetConfig.creatives);
            const uploadedCount = creativesResult?.successful || 0;
            console.log(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] ✅ Creatives uploaded: ${uploadedCount}/${creativeCount}`);
          } catch (creativeError) {
            console.warn(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] ⚠️  Creative upload failed: ${creativeError.message}`);
            // Don't fail the whole operation if creatives upload fails
          }
        } else {
          console.log(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] [Step 3/3] Skipped (no creatives)`);
        }

        // Mark as successful
        results.successful.push(adsetId);
        results.totalCreated++;
        results.details.push({
          iteration: iterationNumber,
          adsetId: adsetId,
          status: "success",
          config: adsetName,
        });

        // Log progress update
        const newCompleted = results.totalCreated;
        const newFailed = results.totalFailed;
        const newPending = totalAdsets - iterationNumber;
        console.log(`[AdaptiveSerialQueue] [✅ UPDATE] ${newCompleted}/${totalAdsets} operations completed, ${newFailed} failed, ${newPending} pending`);

        // Callback for progress tracking
        if (options.onIterationComplete) {
          options.onIterationComplete({
            iteration: iterationNumber,
            total: totalAdsets,
            completed: newCompleted,
            failed: newFailed,
            pending: newPending,
            status: "success",
            adsetId: adsetId,
            currentTask: adsetName,
          });
        }

        // ✅ STEP 4: Check rate limit AFTER creating adset and before next iteration
        if (i < totalAdsets - 1) {
          console.log(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] [Rate Limit Check] Checking before next iteration...`);
          await this.applyTierRateLimit(...this.getCurrentRateLimitStatus());
        }
      } catch (error) {
        // Mark as failed
        results.failed.push({
          iteration: iterationNumber,
          config: adsetConfig.name || `Adset ${iterationNumber}`,
          error: error.message,
        });
        results.totalFailed++;
        results.details.push({
          iteration: iterationNumber,
          status: "failed",
          error: error.message,
          config: adsetConfig.name || `Adset ${iterationNumber}`,
        });

        const errorAdsetName = adsetConfig.name || `Adset ${iterationNumber}`;
        console.error(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] ❌ FAILED: "${errorAdsetName}"`);
        console.error(`[AdaptiveSerialQueue] [${iterationNumber}/${totalAdsets}] Error: ${error.message}`);

        // Log progress update
        const newCompleted = results.totalCreated;
        const newFailed = results.totalFailed;
        const newPending = totalAdsets - iterationNumber;
        console.error(`[AdaptiveSerialQueue] [❌ UPDATE] ${newCompleted}/${totalAdsets} operations completed, ${newFailed} failed, ${newPending} pending`);

        // Callback for progress tracking
        if (options.onIterationComplete) {
          options.onIterationComplete({
            iteration: iterationNumber,
            total: totalAdsets,
            completed: newCompleted,
            failed: newFailed,
            pending: newPending,
            status: "failed",
            error: error.message,
            currentTask: errorAdsetName,
          });
        }

        // Decide if we should continue or stop on error
        if (options.stopOnError) {
          console.error(`[AdaptiveSerialQueue] ⛔ Stopping loop due to error (stopOnError: true)`);
          break;
        }
      }
    }

    // Final Summary
    console.log(`\n[AdaptiveSerialQueue] ════════════════════════════════════════`);
    console.log(`[AdaptiveSerialQueue] 🎉 LOOP COMPLETED`);
    console.log(`[AdaptiveSerialQueue] ════════════════════════════════════════`);
    console.log(`[AdaptiveSerialQueue] Total Adsets: ${totalAdsets}`);
    console.log(`[AdaptiveSerialQueue] ✅ Successful: ${results.totalCreated}`);
    console.log(`[AdaptiveSerialQueue] ❌ Failed: ${results.totalFailed}`);
    console.log(`[AdaptiveSerialQueue] Success Rate: ${((results.totalCreated / totalAdsets) * 100).toFixed(1)}%`);
    console.log(`[AdaptiveSerialQueue] ════════════════════════════════════════\n`);

    return results;
  }

  /**
   * Get current rate limit status from tracker
   * @returns {Array} [callCount, estimatedTimeToRegainAccess]
   */
  getCurrentRateLimitStatus() {
    const usage = rateLimitTracker.getUsage(this.accountId);
    if (!usage) {
      return [0, 0]; // Default to safe values if no data
    }
    return [usage.callCount, usage.estimatedTimeToRegainAccess];
  }
}

/**
 * Helper function to create and process a queue in one go
 * @param {string} accountId - Ad account ID
 * @param {Array} operations - Array of operations
 * @param {object} options - Queue options
 * @returns {Promise<Array>} Results array
 */
export async function processOperationsSerially(accountId, operations, options = {}) {
  const queue = new AdaptiveSerialQueue(accountId, options);

  // Enqueue all operations
  operations.forEach((op) => queue.enqueue(op));

  // Process and return results
  return await queue.processQueue();
}
