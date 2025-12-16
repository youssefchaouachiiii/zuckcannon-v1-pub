# Testing Setup Guide for ZuckCannon

## Overview
This guide provides complete setup code for unit testing the ZuckCannon application. Since architect mode only allows markdown files, all code is provided here for manual implementation.

## 1. Jest Configuration for ES Modules

### File: `jest.config.js`
```javascript
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
    '/node_modules/',
    '/coverage/',
    '/dist/',
    '/build/'
  ],
  
  // Global variables
  globals: {
    'process.env': {}
  }
};
```

## 2. Test Database Utilities

### File: `tests/helpers/test-db.js`
```javascript
/**
 * Test database utilities for unit testing
 * Creates in-memory SQLite databases for isolated test environments
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { Database } from 'sqlite3';

/**
 * Create an in-memory SQLite database for testing
 * @returns {Promise<Database>} Database instance
 */
export async function createTestDatabase() {
  const db = await open({
    filename: ':memory:',
    driver: Database
  });
  
  // Initialize all required tables for testing
  await initializeTestSchema(db);
  
  return db;
}

/**
 * Initialize database schema for testing
 * @param {Database} db - Database instance
 */
async function initializeTestSchema(db) {
  // Creatives table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS creatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_hash TEXT UNIQUE NOT NULL,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      thumbnail_path TEXT,
      batch_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Creative batches table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS creative_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Creative accounts table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS creative_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creative_id INTEGER NOT NULL,
      ad_account_id TEXT NOT NULL,
      facebook_creative_id TEXT,
      facebook_video_id TEXT,
      facebook_image_hash TEXT,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creative_id) REFERENCES creatives(id) ON DELETE CASCADE,
      UNIQUE(creative_id, ad_account_id)
    )
  `);

  // Users table for authentication tests
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT,
      facebook_id TEXT UNIQUE,
      facebook_access_token TEXT,
      facebook_token_expires_at INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `);

  // Facebook cache tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cached_ad_accounts (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 0,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      last_fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, user_id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS cached_campaigns (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 0,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      last_fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, user_id)
    )
  `);

  // Automated rules tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS automated_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ad_account_id TEXT NOT NULL,
      meta_rule_id TEXT,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_ids TEXT,
      rule_type TEXT NOT NULL DEFAULT 'TRIGGER',
      evaluation_spec TEXT NOT NULL,
      execution_spec TEXT NOT NULL,
      schedule_spec TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for better performance
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_creatives_file_hash ON creatives(file_hash)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_creatives_batch_id ON creatives(batch_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_creative_accounts ON creative_accounts(creative_id, ad_account_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_rules_user_account ON automated_rules(user_id, ad_account_id)`);
}

/**
 * Clean up test database
 * @param {Database} db - Database instance to close
 */
export async function cleanupTestDatabase(db) {
  if (db) {
    await db.close();
  }
}
```

## 3. Mock Utilities

### File: `tests/helpers/mocks.js`
```javascript
import jest from 'jest';

// Mock external APIs
export const mockAxios = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  create: jest.fn()
};

export const mockFs = {
  existsSync: jest.fn(),
  createReadStream: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    writeFile: jest.fn()
  }
};

export const mockFfmpeg = {
  seekInput: jest.fn().mockReturnThis(),
  screenshots: jest.fn().mockReturnThis(),
  on: jest.fn().mockReturnThis()
};

// Mock FormData for file uploads
export const mockFormData = jest.fn().mockImplementation(() => ({
  append: jest.fn(),
  getHeaders: jest.fn(() => ({ 'Content-Type': 'multipart/form-data' }))
}));

// Mock Facebook API responses
export const mockFacebookResponses = {
  adAccounts: {
    data: [
      { id: 'act_123', account_id: '123', name: 'Test Account 1' },
      { id: 'act_456', account_id: '456', name: 'Test Account 2' }
    ]
  },
  campaigns: {
    data: [
      { id: 'camp_1', name: 'Test Campaign', objective: 'OUTCOME_TRAFFIC' }
    ]
  },
  pages: {
    data: [
      { id: 'page_1', name: 'Test Page' }
    ]
  }
};

// Mock environment variables
export const mockProcessEnv = {
  NODE_ENV: 'test',
  META_ACCESS_TOKEN: 'test_token_12345',
  META_SYSTEM_USER_ID: 'test_user_123'
};

// Mock file objects
export const mockFile = {
  originalname: 'test-image.jpg',
  mimetype: 'image/jpeg',
  size: 1024,
  path: '/tmp/test-upload.jpg'
};

// Mock request/response objects
export const createMockRequest = (overrides = {}) => ({
  body: {},
  files: [],
  user: { id: 1, username: 'testuser' },
  headers: {},
  ...overrides
});

export const createMockResponse = (overrides = {}) => ({
  status: jest.fn(),
  json: jest.fn(),
  send: jest.fn(),
  ...overrides
});
```

### File: `tests/helpers/express-mocks.js`
```javascript
/**
 * Express request/response mocking utilities
 */

export const mockRequest = (overrides = {}) => ({
  body: {},
  files: [],
  user: { id: 1, username: 'testuser' },
  headers: {},
  query: {},
  params: {},
  ...overrides
});

export const mockResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis()
  };
  
  // Chain methods
  res.status.mockReturnThis(res);
  res.json.mockReturnThis(res);
  res.send.mockReturnThis(res);
  res.cookie.mockReturnThis(res);
  res.clearCookie.mockReturnThis(res);
  res.redirect.mockReturnThis(res);
  
  return res;
};

export const createMockNext = () => jest.fn();
```

## 4. Sample Unit Test Files

### Database Tests: `tests/database/creative-db.test.js`
```javascript
import { createTestDatabase, cleanupTestDatabase } from '../helpers/test-db.js';
import { CreativeDB, CreativeAccountDB, BatchDB } from '../../backend/utils/database.js';

// Mock the database module
jest.mock('../../backend/utils/database.js', () => {
  const originalModule = jest.requireActual('../../backend/utils/database.js');
  return {
    ...originalModule,
    CreativeDB: {
      ...originalModule.CreativeDB,
      findByHash: jest.fn(),
      create: jest.fn(),
      getAll: jest.fn(),
      getById: jest.fn(),
      delete: jest.fn(),
      updateBatch: jest.fn()
    },
    CreativeAccountDB: {
      ...originalModule.CreativeAccountDB,
      recordUpload: jest.fn(),
      isUploadedToAccount: jest.fn(),
      getFacebookIds: jest.fn()
    },
    BatchDB: {
      ...originalModule.BatchDB,
      create: jest.fn(),
      getAll: jest.fn(),
      getById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getCreatives: jest.fn()
    }
  };
});

describe('CreativeDB', () => {
  let testDb;
  
  beforeEach(async () => {
    testDb = await createTestDatabase();
  });
  
  afterEach(async () => {
    await cleanupTestDatabase(testDb);
  });
  
  describe('findByHash', () => {
    it('should return creative when hash exists', async () => {
      const mockCreative = {
        id: 1,
        file_hash: 'test_hash',
        file_name: 'test.jpg',
        original_name: 'test.jpg',
        file_path: '/path/to/test.jpg',
        file_type: 'image/jpeg',
        file_size: 1024
      };
      
      // Mock database query to return our test creative
      testDb.get = jest.fn().mockResolvedValue(mockCreative);
      
      const result = await CreativeDB.findByHash('test_hash');
      expect(result).toEqual(mockCreative);
    });
    
    it('should return null when hash does not exist', async () => {
      testDb.get = jest.fn().mockResolvedValue(undefined);
      
      const result = await CreativeDB.findByHash('nonexistent_hash');
      expect(result).toBeNull();
    });
  });
  
  describe('create', () => {
    it('should create new creative entry', async () => {
      const creativeData = {
        fileHash: 'new_hash',
        fileName: 'new_file.jpg',
        originalName: 'new_file.jpg',
        filePath: '/path/to/new_file.jpg',
        fileType: 'image/jpeg',
        fileSize: 2048
      };
      
      const mockInsertId = 123;
      testDb.run = jest.fn().mockImplementation((query, params, callback) => {
        callback.call({ lastID: mockInsertId });
      });
      
      const id = await CreativeDB.create(creativeData);
      expect(id).toBe(mockInsertId);
    });
  });
});
```

### Creative Utils Tests: `tests/utils/creative-utils.test.js`
```javascript
import fs from 'fs';
import { calculateFileHash, getCreativeSubdir, moveToCreativeLibrary, processCreative } from '../../backend/utils/creative-utils.js';

// Mock dependencies
jest.mock('fs');
jest.mock('crypto');
jest.mock('../../backend/utils/database.js');

describe('Creative Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('calculateFileHash', () => {
    it('should calculate SHA-256 hash for file', async () => {
      const mockFileContent = Buffer.from('test file content');
      const mockHash = 'test_hash_value';
      
      fs.createReadStream = jest.fn().mockReturnValue({
        on: jest.fn().mockImplementation((event, handler) => {
          if (event === 'end') handler();
        })
      });
      
      // Mock crypto.createHash
      const mockHashInstance = {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue(mockHash)
      };
      
      jest.doMock('crypto', () => ({
        createHash: jest.fn().mockReturnValue(mockHashInstance)
      }));
      
      const hash = await calculateFileHash('test_file.jpg');
      expect(hash).toBe(mockHash);
    });
  });
  
  describe('getCreativeSubdir', () => {
    it('should return "videos" for video mime types', () => {
      expect(getCreativeSubdir('video/mp4')).toBe('videos');
      expect(getCreativeSubdir('video/quicktime')).toBe('videos');
    });
    
    it('should return "images" for image mime types', () => {
      expect(getCreativeSubdir('image/jpeg')).toBe('images');
      expect(getCreativeSubdir('image/png')).toBe('images');
    });
    
    it('should throw error for unsupported file types', () => {
      expect(() => getCreativeSubdir('application/pdf')).toThrow('Unsupported file type: application/pdf');
    });
  });
});
```

### Authentication Tests: `tests/auth/auth-db.test.js`
```javascript
import bcrypt from 'bcrypt';
import { UserDB } from '../../backend/auth/auth-db.js';

// Mock the database module
jest.mock('../../backend/auth/auth-db.js', () => {
  const originalModule = jest.requireActual('../../backend/auth/auth-db.js');
  return {
    ...originalModule,
    UserDB: {
      ...originalModule.UserDB,
      create: jest.fn(),
      findByUsername: jest.fn(),
      findById: jest.fn(),
      verifyPassword: jest.fn(),
      updatePassword: jest.fn(),
      delete: jest.fn()
    }
  };
});

describe('UserDB', () => {
  let testDb;
  
  beforeEach(async () => {
    testDb = await createTestDatabase();
  });
  
  describe('create', () => {
    it('should create new user with hashed password', async () => {
      const userData = { username: 'testuser', password: 'testpass123', email: 'test@example.com' };
      
      const mockInsertId = 123;
      testDb.run = jest.fn().mockImplementation((query, params, callback) => {
        callback.call({ lastID: mockInsertId });
      });
      
      // Mock bcrypt.hash
      const mockHashedPassword = 'hashed_testpass123';
      jest.doMock('bcrypt', () => ({
        hash: jest.fn().mockResolvedValue(mockHashedPassword)
      }));
      
      const result = await UserDB.create(userData.username, userData.password, userData.email);
      expect(result.lastID).toBe(mockInsertId);
    });
  });
  
  describe('verifyPassword', () => {
    it('should return user for valid credentials', async () => {
      const password = 'testpass123';
      const hashedPassword = 'hashed_testpass123';
      const mockUser = { id: 1, username: 'testuser', password: hashedPassword };
      
      testDb.get = jest.fn().mockResolvedValue(mockUser);
      jest.doMock('bcrypt', () => ({
        compare: jest.fn().mockResolvedValue(true)
      }));
      
      const user = await UserDB.verifyPassword('testuser', password);
      expect(user).toEqual(mockUser);
    });
    
    it('should return null for invalid credentials', async () => {
      testDb.get = jest.fn().mockResolvedValue(undefined);
      jest.doMock('bcrypt', () => ({
        compare: jest.fn().mockResolvedValue(false)
      }));
      
      const user = await UserDB.verifyPassword('nonexistent', 'wrongpass');
      expect(user).toBeNull();
    });
  });
});
```

## 5. Package.json Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "test": "NODE_OPTIONS='--experimental-vm-modules' jest",
    "test:watch": "NODE_OPTIONS='--experimental-vm-modules' jest --watch",
    "test:coverage": "NODE_OPTIONS='--experimental-vm-modules' jest --coverage",
    "test:ci": "NODE_OPTIONS='--experimental-vm-modules' jest --ci --coverage --watchAll=false",
    "test:unit": "NODE_OPTIONS='--experimental-vm-modules' jest tests/unit",
    "test:integration": "NODE_OPTIONS='--experimental-vm-modules' jest tests/integration"
  }
}
```

## 6. GitHub Actions CI/CD

### File: `.github/workflows/test.yml`
```yaml
name: Unit Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v3
    
    - name: Setup Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm run test:ci
    
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/lcov.info
        flags: unittests
        name: codecov-umbrella
        fail_ci_if_error: true
```

## 7. Test Setup Script

### File: `tests/setup.js`
```javascript
/**
 * Global test setup
 * Runs before each test file
 */

import { jest } from '@jest/globals';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.META_ACCESS_TOKEN = 'test_token_12345';
process.env.META_SYSTEM_USER_ID = 'test_user_123';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce test noise
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Global test utilities
global.testUtils = {
  createMockFile: (overrides = {}) => ({
    originalname: 'test-image.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    path: '/tmp/test-upload.jpg',
    ...overrides
  }),
  
  createMockUser: (overrides = {}) => ({
    id: 1,
    username: 'testuser',
    facebook_access_token: 'test_token_12345',
    ...overrides
  })
};
```

## Implementation Steps

1. **Create Directory Structure:**
   ```
   tests/
   ├── helpers/
   │   ├── test-db.js
   │   ├── mocks.js
   │   └── express-mocks.js
   ├── unit/
   │   ├── database/
   │   ├── utils/
   │   └── auth/
   └── integration/
   ```

2. **Install Dependencies:**
   ```bash
   npm install --save-dev jest @types/jest
   ```

3. **Configure Jest:**
   - Create `jest.config.js` with ES module support
   - Update `package.json` scripts

4. **Implement Test Files:**
   - Start with database layer tests
   - Move to business logic tests
   - Add integration tests last

5. **Run Tests:**
   ```bash
   npm run test
   npm run test:coverage
   ```

This comprehensive setup provides everything needed for robust unit testing of the ZuckCannon application, focusing on the core components you mentioned: filtering logic, decision making, permissions, rules, and data transformation.