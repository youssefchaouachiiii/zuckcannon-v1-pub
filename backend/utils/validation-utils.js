/**
 * Validation Utilities
 * Helper functions for common validation patterns
 */

/**
 * Validate that a value is present and not empty
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {Object|null} - Error object or null if valid
 */
export function validateRequired(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    return { field: fieldName, error: `${fieldName} is required` }
  }
  return null
}

/**
 * Validate multiple required fields
 * @param {Object} data - Object containing fields to validate
 * @param {Array<string>} requiredFields - Array of field names that are required
 * @returns {Array<Object>|null} - Array of error objects or null if all valid
 */
export function validateRequiredFields(data, requiredFields) {
  const errors = []
  
  for (const field of requiredFields) {
    const error = validateRequired(data[field], field)
    if (error) errors.push(error)
  }
  
  return errors.length > 0 ? errors : null
}

/**
 * Validate that a value is one of allowed options
 * @param {any} value - Value to validate
 * @param {Array} allowedValues - Array of allowed values
 * @param {string} fieldName - Field name for error message
 * @returns {Object|null} - Error object or null if valid
 */
export function validateEnum(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    return {
      field: fieldName,
      error: `${fieldName} must be one of: ${allowedValues.join(', ')}`
    }
  }
  return null
}

/**
 * Validate that a value is a valid number
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options (min, max, integer)
 * @returns {Object|null} - Error object or null if valid
 */
export function validateNumber(value, fieldName, options = {}) {
  const num = parseFloat(value)
  
  if (isNaN(num)) {
    return { field: fieldName, error: `${fieldName} must be a valid number` }
  }
  
  if (options.min !== undefined && num < options.min) {
    return { field: fieldName, error: `${fieldName} must be at least ${options.min}` }
  }
  
  if (options.max !== undefined && num > options.max) {
    return { field: fieldName, error: `${fieldName} must be at most ${options.max}` }
  }
  
  if (options.integer && !Number.isInteger(num)) {
    return { field: fieldName, error: `${fieldName} must be an integer` }
  }
  
  return null
}

/**
 * Validate that a value is an array
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options (minItems, maxItems)
 * @returns {Object|null} - Error object or null if valid
 */
export function validateArray(value, fieldName, options = {}) {
  if (!Array.isArray(value)) {
    return { field: fieldName, error: `${fieldName} must be an array` }
  }
  
  if (options.minItems !== undefined && value.length < options.minItems) {
    return { field: fieldName, error: `${fieldName} must contain at least ${options.minItems} item(s)` }
  }
  
  if (options.maxItems !== undefined && value.length > options.maxItems) {
    return { field: fieldName, error: `${fieldName} can contain at most ${options.maxItems} item(s)` }
  }
  
  return null
}

/**
 * Validate that a value is a string
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {Object} options - Validation options (minLength, maxLength, pattern)
 * @returns {Object|null} - Error object or null if valid
 */
export function validateString(value, fieldName, options = {}) {
  if (typeof value !== 'string') {
    return { field: fieldName, error: `${fieldName} must be a string` }
  }
  
  if (options.minLength !== undefined && value.length < options.minLength) {
    return { field: fieldName, error: `${fieldName} must be at least ${options.minLength} characters` }
  }
  
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    return { field: fieldName, error: `${fieldName} can be at most ${options.maxLength} characters` }
  }
  
  if (options.pattern && !options.pattern.test(value)) {
    return { field: fieldName, error: `${fieldName} format is invalid` }
  }
  
  return null
}

/**
 * Validate file size
 * @param {number} fileSize - File size in bytes
 * @param {number} maxSize - Maximum allowed size in bytes
 * @param {string} fileName - File name for error message
 * @returns {Object|null} - Error object or null if valid
 */
export function validateFileSize(fileSize, maxSize, fileName) {
  if (fileSize > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2)
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2)
    return {
      field: 'file',
      error: `File ${fileName} is ${fileSizeMB}MB, exceeds maximum size of ${maxSizeMB}MB`
    }
  }
  return null
}

/**
 * Validate file type (MIME type)
 * @param {string} mimeType - MIME type of the file
 * @param {Array<string>} allowedTypes - Array of allowed MIME types
 * @param {string} fileName - File name for error message
 * @returns {Object|null} - Error object or null if valid
 */
export function validateFileType(mimeType, allowedTypes, fileName) {
  if (!allowedTypes.includes(mimeType)) {
    return {
      field: 'file',
      error: `File ${fileName} type (${mimeType}) is not allowed. Allowed types: ${allowedTypes.join(', ')}`
    }
  }
  return null
}

/**
 * Validate that at least one field from a list has a value
 * @param {Object} data - Object containing fields
 * @param {Array<string>} fieldNames - Array of field names to check
 * @param {string} groupName - Name of the field group for error message
 * @returns {Object|null} - Error object or null if valid
 */
export function validateAtLeastOne(data, fieldNames, groupName) {
  const hasValue = fieldNames.some(field => data[field] !== null && data[field] !== undefined && data[field] !== '')
  
  if (!hasValue) {
    return {
      group: groupName,
      error: `At least one of these fields is required: ${fieldNames.join(', ')}`
    }
  }
  return null
}

/**
 * Validate that only one field from a list has a value
 * @param {Object} data - Object containing fields
 * @param {Array<string>} fieldNames - Array of field names to check
 * @param {string} groupName - Name of the field group for error message
 * @returns {Object|null} - Error object or null if valid
 */
export function validateOnlyOne(data, fieldNames, groupName) {
  const valueCount = fieldNames.filter(field => data[field] !== null && data[field] !== undefined && data[field] !== '').length
  
  if (valueCount > 1) {
    return {
      group: groupName,
      error: `Only one of these fields should be specified: ${fieldNames.join(', ')}`
    }
  }
  return null
}

/**
 * Validate budget constraints
 * @param {Object} data - Object containing daily_budget and lifetime_budget
 * @returns {Array<Object>|null} - Array of error objects or null if valid
 */
export function validateBudget(data) {
  const errors = []
  
  if (data.daily_budget) {
    const error = validateNumber(data.daily_budget, 'daily_budget', { min: 0 })
    if (error) errors.push(error)
  }
  
  if (data.lifetime_budget) {
    const error = validateNumber(data.lifetime_budget, 'lifetime_budget', { min: 0 })
    if (error) errors.push(error)
  }
  
  if (data.daily_budget && data.lifetime_budget) {
    errors.push({
      group: 'budget',
      error: 'Cannot specify both daily_budget and lifetime_budget'
    })
  }
  
  return errors.length > 0 ? errors : null
}

/**
 * Combine multiple validation results
 * @param {...Array|Object} results - Multiple validation results
 * @returns {Array|null} - Combined errors or null if all valid
 */
export function combineValidationResults(...results) {
  const allErrors = []
  
  for (const result of results) {
    if (result === null || result === undefined) continue
    if (Array.isArray(result)) {
      allErrors.push(...result)
    } else {
      allErrors.push(result)
    }
  }
  
  return allErrors.length > 0 ? allErrors : null
}
