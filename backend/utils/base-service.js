/**
 * Base Database Service Class
 * Provides a foundation for database operations with built-in error handling,
 * logging, and retry logic
 */

/**
 * Abstract base class for database services
 * Provides common database operation patterns and error handling
 */
export class BaseDbService {
  constructor(dbName = 'service') {
    this.dbName = dbName
  }

  /**
   * Execute a database operation with error handling and logging
   * @param {Function} operation - Async function that performs the database operation
   * @param {string} operationName - Name of the operation for logging
   * @param {Object} options - Configuration options
   * @returns {Promise} - Result of the operation
   */
  async execute(operation, operationName, options = {}) {
    const { 
      logError = true, 
      throwError = true,
      retries = 0 
    } = options

    let lastError
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        
        if (logError) {
          console.error(
            `[${this.dbName}] ${operationName} failed (attempt ${attempt + 1}/${retries + 1}):`,
            error.message
          )
        }

        // If this is not the last attempt, wait before retrying
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000 // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    // All retries exhausted
    if (throwError) {
      throw new Error(
        `${operationName} failed after ${retries + 1} attempt(s): ${lastError.message}`
      )
    }

    return null
  }

  /**
   * Execute a transaction (multiple related database operations)
   * @param {Function} transaction - Function that contains the transaction operations
   * @param {string} transactionName - Name of the transaction for logging
   * @returns {Promise} - Result of the transaction
   */
  async executeTransaction(transaction, transactionName) {
    console.log(`[${this.dbName}] Starting transaction: ${transactionName}`)
    try {
      const result = await transaction()
      console.log(`[${this.dbName}] Transaction completed: ${transactionName}`)
      return result
    } catch (error) {
      console.error(`[${this.dbName}] Transaction failed: ${transactionName}`, error)
      throw error
    }
  }

  /**
   * Execute a batch of operations
   * @param {Array<Function>} operations - Array of async operations
   * @param {string} batchName - Name of the batch for logging
   * @param {Object} options - Configuration options
   * @returns {Promise<Array>} - Array of results
   */
  async executeBatch(operations, batchName, options = {}) {
    const { parallel = false } = options

    console.log(`[${this.dbName}] Starting batch: ${batchName} (${operations.length} operations, ${parallel ? 'parallel' : 'sequential'})`)

    try {
      let results
      
      if (parallel) {
        results = await Promise.all(
          operations.map(op => 
            this.execute(op, `${batchName} - operation`, options)
          )
        )
      } else {
        results = []
        for (const op of operations) {
          const result = await this.execute(op, `${batchName} - operation`, options)
          results.push(result)
        }
      }

      console.log(`[${this.dbName}] Batch completed: ${batchName}`)
      return results
    } catch (error) {
      console.error(`[${this.dbName}] Batch failed: ${batchName}`, error)
      throw error
    }
  }

  /**
   * Measure execution time of an operation
   * @param {Function} operation - Async function to measure
   * @param {string} operationName - Name for logging
   * @returns {Promise<{result: any, duration: number}>} - Result and duration in ms
   */
  async measurePerformance(operation, operationName) {
    const startTime = performance.now()
    
    try {
      const result = await operation()
      const duration = performance.now() - startTime
      
      console.log(`[${this.dbName}] ${operationName} completed in ${duration.toFixed(2)}ms`)
      
      return { result, duration }
    } catch (error) {
      const duration = performance.now() - startTime
      
      console.error(`[${this.dbName}] ${operationName} failed after ${duration.toFixed(2)}ms:`, error)
      throw error
    }
  }

  /**
   * Log operation details
   * @param {string} level - Log level (info, warn, error)
   * @param {string} message - Log message
   * @param {any} data - Optional data to log
   */
  log(level, message, data = null) {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] [${this.dbName}] ${message}`
    
    if (data) {
      console[level](logMessage, data)
    } else {
      console[level](logMessage)
    }
  }

  info(message, data) { this.log('info', message, data) }
  warn(message, data) { this.log('warn', message, data) }
  error(message, data) { this.log('error', message, data) }
}

/**
 * Helper function to create a database operation with standard error handling
 * @param {Function} operation - The database operation
 * @param {string} context - Context/operation name for error messages
 * @returns {Promise} - Result of operation
 */
export async function withErrorHandling(operation, context) {
  try {
    return await operation()
  } catch (error) {
    console.error(`${context}:`, error)
    throw new Error(`${context}: ${error.message}`)
  }
}
