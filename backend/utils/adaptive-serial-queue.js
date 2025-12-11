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

        console.error(`[AdaptiveSerialQueue] ❌ Operation ${operation.id} failed: ${error.message}`);
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
