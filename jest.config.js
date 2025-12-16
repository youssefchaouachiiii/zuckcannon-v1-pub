
/**
 * Jest configuration for ZuckCannon application
 * Supports ES modules and provides comprehensive testing setup
 */

export default {
  // Use ES module resolver
  preset: 'ts-jest/preset-default-esm',
  
  // Test environment setup
  testEnvironment: 'node',
  
  // Module file extensions
  moduleFileExtensions: ['js', 'mjs', 'json'],
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.js',
    '**/__tests__/**/*.mjs',
    '**/*.test.js',
    '**/*.test.mjs',
    '**/*.spec.js',
    '**/*.spec.mjs'
  ],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'backend/**/*.js',
    'backend/**/*.mjs',
    '!backend/**/*.test.js',
    '!backend/**/*.test.mjs',
    '!backend/**/*.spec.js',
    '!backend/**/*.spec.mjs'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Module name mapping for path aliases
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/backend/$1',
    '^#/(.*)$': '<rootDir>/tests/helpers/$1'
  },
  
  // Test timeout
  testTimeout: 30000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  
  // Transform configuration for ES modules
  transform: {},
  
  // Ignore patterns
  testPathIgnorePatterns: [
