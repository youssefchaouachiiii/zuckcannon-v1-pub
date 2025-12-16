# Unit Testing Implementation Plan for ZuckCannon

## Overview
This document provides a comprehensive unit testing strategy for the ZuckCannon Facebook Marketing API application. The application uses ES modules and requires proper testing setup for Jest.

## Current Testing Setup Analysis

### Existing Dependencies
- ✅ Jest v29.7.0 (already in devDependencies)
- ✅ Supertest v6.3.3 (already in devDependencies)
- ❌ Missing: Jest configuration for ES modules
- ❌ Missing: Test utilities and mocking setup
- ❌ Missing: Database mocking utilities
- ❌ Missing: Test data fixtures

### Project Structure Analysis
```
backend/
├── auth/
│   ├── auth-db.js (User authentication database operations)
│   └── passport-config.js (Passport configuration)
├── middleware/
│   └── validation.js (Request validation middleware)
└── utils/
    ├── adaptive-serial-queue.js (Adaptive queue for API operations)
    ├── creative-utils.js (Creative file processing)
    ├── database.js (Creative library database operations)
    ├── facebook-cache-db.js (Facebook API caching)
    ├── meta-batch.js (Meta API batch operations)
    ├── paths.js (Path utilities)
    ├── rate-limit-tracker.js (Rate limiting)
    └── rules-db.js (Automated rules database)
```

## Implementation Plan

### 1. Jest Configuration for ES Modules
Create `jest.config.js` with ES module support:

```javascript
export default {
  preset: 'ts-jest/preset-default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.js', '.mjs'],
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/backend/$1',
    '^#/(.*)$': '<rootDir>/tests/helpers/$1'
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  transform: {},
  globals: {
    'process.env': {}
  }
};
```

### 2. Test Utilities and Mocking Setup

#### Test Database Setup (`tests/helpers/test-db.js`)
```javascript
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { Database } from 'sqlite3';

export async function createTestDatabase() {
  const db = await open({
    filename: ':memory:',
    driver: Database
  });
  
  // Initialize schema
  await db.exec(`
    CREATE TABLE creatives (
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
    );
    
    CREATE TABLE creative_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE creative_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creative_id INTEGER NOT NULL,
      ad_account_id TEXT NOT NULL,
      facebook_creative_id TEXT,
      facebook_video_id TEXT,
      facebook_image_hash TEXT,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creative_id) REFERENCES creatives(id) ON DELETE CASCADE,
      UNIQUE(creative_id, ad_account_id)
    );
  `);
  
  return db;
}
```

#### Mock Utilities (`tests/helpers/mocks.js`)
```javascript
import jest from 'jest';

// Mock external APIs
export const mockAxios = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn()
};

export const mockFs = {
  existsSync: jest.fn(),
  createReadStream: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: jest.fn()
};

export const mockFfmpeg = {
  seekInput: jest.fn(() => mockFfmpeg),
  screenshots: jest.fn(() => mockFfmpeg),
  on: jest.fn(() => mockFfmpeg)
};

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
  }
};
```

### 3. Core Component Unit Tests

#### Database Operations Tests (`tests/database/creative-db.test.js`)
```javascript
import { createTestDatabase } from '../helpers/test-db.js';
import { CreativeDB, CreativeAccountDB, BatchDB } from '../../backend/utils/database.js';

describe('CreativeDB', () => {
  let testDb;
  
  beforeEach(async () => {
    testDb = await createTestDatabase();
  });
  
  describe('findByHash', () => {
    it('should return creative when hash exists', async () => {
      // Setup test data
      await testDb.run(`
        INSERT INTO creatives (file_hash, file_name, original_name, file_path, file_type, file_size)
        VALUES ('test_hash', 'test.jpg', 'test.jpg', '/path/to/test.jpg', 'image/jpeg', 1024)
      `);
      
      const result = await CreativeDB.findByHash('test_hash');
      expect(result).toBeDefined();
      expect(result.file_hash).toBe('test_hash');
    });
    
    it('should return null when hash does not exist', async () => {
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
      
      const id = await CreativeDB.create(creativeData);
      expect(id).toBeDefined();
      expect(typeof id).toBe('number');
      
      const created = await testDb.get('SELECT * FROM creatives WHERE id = ?', [id]);
      expect(created.file_hash).toBe('new_hash');
    });
  });
});
```

#### Creative Utilities Tests (`tests/utils/creative-utils.test.js`)
```javascript
import fs from 'fs';
import { calculateFileHash, getCreativeSubdir, moveToCreativeLibrary, processCreative } from '../../backend/utils/creative-utils.js';

// Mock fs functions
jest.mock('fs');
jest.mock('../../backend/utils/database.js');

describe('Creative Utils', () => {
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
      jest.doMock('crypto', () => ({
        createHash: jest.fn().mockReturnValue({
          update: jest.fn().mockReturnThis(),
          digest: jest.fn().mockReturnValue(mockHash)
        })
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

#### Facebook Cache Tests (`tests/utils/facebook-cache-db.test.js`)
```javascript
import { FacebookCacheDB } from '../../backend/utils/facebook-cache-db.js';

describe('FacebookCacheDB', () => {
  let testDb;
  
  beforeEach(async () => {
    testDb = await createTestDatabase();
    // Mock the database instance
    jest.doMock('../../backend/utils/facebook-cache-db.js', () => {
      const originalModule = jest.requireActual('../../backend/utils/facebook-cache-db.js');
      return {
        ...originalModule,
        saveAdAccounts: jest.fn(),
        getAdAccounts: jest.fn(),
        saveCampaigns: jest.fn(),
        getCampaigns: jest.fn(),
        isCacheValid: jest.fn()
      };
    });
  });
  
  describe('saveAdAccounts', () => {
    it('should save ad accounts to cache', async () => {
      const accounts = [
        { id: 'act_123', account_id: '123', name: 'Test Account' }
      ];
      
      await FacebookCacheDB.saveAdAccounts(accounts);
      expect(FacebookCacheDB.saveAdAccounts).toHaveBeenCalledWith(accounts);
    });
  });
  
  describe('isCacheValid', () => {
    it('should return true when cache is fresh', async () => {
      FacebookCacheDB.isCacheValid.mockReturnValue(true);
      
      const isValid = await FacebookCacheDB.isCacheValid(60);
      expect(isValid).toBe(true);
      expect(FacebookCacheDB.isCacheValid).toHaveBeenCalledWith(60);
    });
    
    it('should return false when cache is expired', async () => {
      FacebookCacheDB.isCacheValid.mockReturnValue(false);
      
      const isValid = await FacebookCacheDB.isCacheValid(60);
      expect(isValid).toBe(false);
    });
  });
});
```

#### Authentication Tests (`tests/auth/auth-db.test.js`)
```javascript
import bcrypt from 'bcrypt';
import { UserDB } from '../../backend/auth/auth-db.js';

describe('UserDB', () => {
  let testDb;
  
  beforeEach(async () => {
    testDb = await createTestDatabase();
  });
  
  describe('create', () => {
    it('should create new user with hashed password', async () => {
      const userData = { username: 'testuser', password: 'testpass123', email: 'test@example.com' };
      
      const result = await UserDB.create(userData.username, userData.password, userData.email);
      expect(result.lastID).toBeDefined();
      
      const createdUser = await testDb.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
      expect(createdUser.username).toBe('testuser');
      expect(createdUser.email).toBe('test@example.com');
      
      // Verify password is hashed
      const isPasswordValid = await bcrypt.compare(userData.password, createdUser.password);
      expect(isPasswordValid).toBe(true);
    });
  });
  
  describe('verifyPassword', () => {
    it('should return user for valid credentials', async () => {
      const password = 'testpass123';
      const hashedPassword = await bcrypt.hash(password, 10);
      
      await testDb.run(`
        INSERT INTO users (username, password, email)
        VALUES (?, ?, ?)
      `, ['testuser', hashedPassword, 'test@example.com']);
      
      const user = await UserDB.verifyPassword('testuser', password);
      expect(user).toBeDefined();
      expect(user.username).toBe('testuser');
    });
    
    it('should return null for invalid credentials', async () => {
      const user = await UserDB.verifyPassword('nonexistent', 'wrongpass');
      expect(user).toBeNull();
    });
  });
});
```

#### Validation Middleware Tests (`tests/middleware/validation.test.js`)
```javascript
import { validateRequest } from '../../backend/middleware/validation.js';
import { mockRequest, mockResponse } from '../helpers/express-mocks.js';

describe('Validation Middleware', () => {
  describe('uploadFiles', () => {
    it('should pass validation for valid files', () => {
      const req = {
        body: { account_id: 'act_123' },
        files: [
          { originalname: 'test.jpg', mimetype: 'image/jpeg', size: 1024 }
        ]
      };
      const res = mockResponse();
      const next = jest.fn();
      
      validateRequest.uploadFiles(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
    
    it('should reject when account_id is missing', () => {
      const req = { body: {}, files: [] };
      const res = mockResponse();
      const next = jest.fn();
      
      validateRequest.uploadFiles(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "account_id is required" });
      expect(next).not.toHaveBeenCalled();
    });
    
    it('should reject when no files uploaded', () => {
      const req = { body: { account_id: 'act_123' }, files: [] };
      const res = mockResponse();
      const next = jest.fn();
      
      validateRequest.uploadFiles(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "No files uploaded" });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
```

#### Meta Batch Operations Tests (`tests/utils/meta-batch.test.js`)
```javascript
import axios from 'axios';
import { executeBatchRequest, createBatchOperation, batchCreateAds } from '../../backend/utils/meta-batch.js';

describe('Meta Batch Operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('createBatchOperation', () => {
    it('should create valid batch operation', () => {
      const operation = createBatchOperation('POST', 'act_123/ads', { name: 'Test Ad' });
      
      expect(operation.method).toBe('POST');
      expect(operation.relative_url).toBe('act_123/ads');
      expect(operation.body).toContain('name=Test+Ad');
    });
    
    it('should handle GET operations', () => {
      const operation = createBatchOperation('GET', 'act_123/campaigns');
      
      expect(operation.method).toBe('GET');
      expect(operation.body).toBeUndefined();
    });
  });
  
  describe('executeBatchRequest', () => {
    it('should execute batch request successfully', async () => {
      const operations = [
        createBatchOperation('GET', 'act_123/campaigns'),
        createBatchOperation('POST', 'act_123/ads', { name: 'Test Ad' })
      ];
      
      // Mock axios response
      axios.post = jest.fn().mockResolvedValue({
        data: [
          { code: 200, body: JSON.stringify({ id: 'camp_1', name: 'Test Campaign' }) },
          { code: 200, body: JSON.stringify({ id: 'ad_1', name: 'Test Ad' }) }
        ]
      });
      
      const results = await executeBatchRequest(operations, 'test_token');
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
    
    it('should handle batch request errors', async () => {
      const operations = [createBatchOperation('GET', 'act_123/campaigns')];
      
      axios.post = jest.fn().mockRejectedValue(new Error('Network error'));
      
      await expect(executeBatchRequest(operations, 'test_token')).rejects.toThrow('Network error');
    });
  });
});
```

#### Rate Limiting Tests (`tests/utils/rate-limit-tracker.test.js`)
```javascript
import { rateLimitTracker } from '../../backend/utils/rate-limit-tracker.js';

describe('Rate Limit Tracker', () => {
  beforeEach(() => {
    rateLimitTracker.clearAll();
  });
  
  describe('parseBusinessUsageHeader', () => {
    it('should parse valid usage header', () => {
      const headerValue = JSON.stringify({
        'act_123': {
          type: 'ads_management',
          call_count: 50,
          total_cputime: 1000,
          total_time: 2000,
          estimated_time_to_regain_access: 0,
          ads_api_access_tier: 'development_access'
        }
      });
      
      const result = rateLimitTracker.parseBusinessUsageHeader(headerValue);
      expect(result).toBeDefined();
      expect(result.accountId).toBe('act_123');
      expect(result.callCount).toBe(50);
      expect(result.tier).toBe('development_access');
    });
    
    it('should return null for invalid header', () => {
      const result = rateLimitTracker.parseBusinessUsageHeader('invalid json');
      expect(result).toBeNull();
    });
  });
  
  describe('isApproachingLimit', () => {
    it('should return true when call count >= 25', () => {
      const usageData = { callCount: 30, tier: 'development_access' };
      expect(rateLimitTracker.isApproachingLimit(usageData)).toBe(true);
    });
    
    it('should return false when call count < 25', () => {
      const usageData = { callCount: 20, tier: 'development_access' };
      expect(rateLimitTracker.isApproachingLimit(usageData)).toBe(false);
    });
  });
  
  describe('isCritical', () => {
    it('should return true when call count >= 80 for development', () => {
      const usageData = { callCount: 85, tier: 'development_access' };
      expect(rateLimitTracker.isCritical(usageData)).toBe(true);
    });
    
    it('should return true when estimated_time_to_regain_access > 0', () => {
      const usageData = { callCount: 50, estimated_time_to_regain_access: 300 };
      expect(rateLimitTracker.isCritical(usageData)).toBe(true);
    });
  });
});
```

#### Rules Engine Tests (`tests/utils/rules-db.test.js`)
```javascript
import { RulesDB } from '../../backend/utils/rules-db.js';

describe('RulesDB', () => {
  let testDb;
  
  beforeEach(async () => {
    testDb = await createTestDatabase();
  });
  
  describe('createRule', () => {
    it('should create new automated rule', async () => {
      const ruleData = {
        user_id: 1,
        ad_account_id: 'act_123',
        name: 'Test Rule',
        entity_type: 'CAMPAIGN',
        entity_ids: ['camp_1', 'camp_2'],
        rule_type: 'TRIGGER',
        evaluation_spec: {
          conditions: [
            { field: 'spend', operator: 'GREATER_THAN', value: 100 }
          ]
        },
        execution_spec: {
          action: 'PAUSE'
        }
      };
      
      const result = RulesDB.createRule(ruleData);
      expect(result.id).toBeDefined();
      expect(result.name).toBe('Test Rule');
    });
  });
  
  describe('getRules', () => {
    it('should return rules for user', async () => {
      // Setup test data
      await RulesDB.createRule({
        user_id: 1,
        ad_account_id: 'act_123',
        name: 'Test Rule 1',
        entity_type: 'CAMPAIGN',
        rule_type: 'TRIGGER',
        evaluation_spec: { conditions: [] },
        execution_spec: { action: 'PAUSE' }
      });
      
      const rules = RulesDB.getRules(1);
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Test Rule 1');
    });
    
    it('should return rules filtered by account', async () => {
      const rules = RulesDB.getRules(1, 'act_123');
      expect(rules).toBeDefined();
    });
  });
  
  describe('updateRule', () => {
    it('should update existing rule', async () => {
      const createdRule = RulesDB.createRule({
        user_id: 1,
        ad_account_id: 'act_123',
        name: 'Original Rule',
        entity_type: 'CAMPAIGN',
        rule_type: 'TRIGGER',
        evaluation_spec: { conditions: [] },
        execution_spec: { action: 'PAUSE' }
      });
      
      const updatedRule = RulesDB.updateRule(createdRule.id, 1, {
        name: 'Updated Rule',
        status: 'INACTIVE'
      });
      
      expect(updatedRule.name).toBe('Updated Rule');
      expect(updatedRule.status).toBe('INACTIVE');
    });
  });
});
```

### 4. Integration Tests

#### API Endpoint Tests (`tests/integration/api.test.js`)
```javascript
import request from 'supertest';
import express from 'express';
import { createTestDatabase } from '../helpers/test-db.js';

describe('API Integration Tests', () => {
  let app;
  let testDb;
  
  beforeAll(async () => {
    testDb = await createTestDatabase();
    
    // Create test app with all routes
    app = express();
    app.use(express.json());
    
    // Import and use routes (mocked dependencies)
    // This would require importing the actual route handlers with mocked dependencies
  });
  
  describe('POST /api/users', () => {
    it('should create new user', async () => {
      const userData = {
        username: 'testuser',
        password: 'testpass123',
        email: 'test@example.com'
      };
      
      const response = await request(app)
        .post('/api/users')
        .send(userData)
        .expect(200);
      
      expect(response.body.message).toBe('User created successfully');
    });
    
    it('should reject duplicate username', async () => {
      // Create user first
      await request(app)
        .post('/api/users')
        .send({
          username: 'testuser',
          password: 'testpass123',
          email: 'test@example.com'
        });
      
      // Try to create same user again
      const response = await request(app)
        .post('/api/users')
        .send({
          username: 'testuser',
          password: 'anotherpass',
          email: 'another@example.com'
        })
        .expect(400);
      
      expect(response.body.error).toBe('Username already exists');
    });
  });
  
  describe('GET /api/fetch-meta-data', () => {
    it('should return cached data when available', async () => {
      // Setup cached data
      const response = await request(app)
        .get('/api/fetch-meta-data')
        .expect(200);
      
      expect(response.body).toHaveProperty('adAccounts');
      expect(response.body).toHaveProperty('campaigns');
      expect(response.body).toHaveProperty('pages');
    });
    
    it('should fetch fresh data when cache expired', async () => {
      const response = await request(app)
        .get('/api/fetch-meta-data?refresh=true')
        .expect(200);
      
      expect(response.body.fromCache).toBe(false);
    });
  });
});
```

### 5. Test Scripts Configuration

#### Package.json Updates
```json
{
  "scripts": {
    "test": "NODE_OPTIONS='--experimental-vm-modules' jest",
    "test:watch": "NODE_OPTIONS='--experimental-vm-modules' jest --watch",
    "test:coverage": "NODE_OPTIONS='--experimental-vm-modules' jest --coverage",
    "test:ci": "NODE_OPTIONS='--experimental-vm-modules' jest --ci --coverage --watchAll=false"
  }
}
```

### 6. CI/CD Configuration

#### GitHub Actions Workflow (`.github/workflows/test.yml`)
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
    - uses: actions/checkout@v3
    
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
```

## Implementation Priority

### Phase 1: Core Infrastructure (Week 1)
1. ✅ Jest configuration for ES modules
2. 🔄 Test database utilities and mocking setup
3. 📋 Basic test helpers and mocks

### Phase 2: Database Layer (Week 2)
1. 📋 CreativeDB operations tests
2. 📋 FacebookCacheDB operations tests
3. 📋 UserDB authentication tests
4. 📋 RulesDB operations tests

### Phase 3: Business Logic (Week 3)
1. 📋 Creative utilities tests
2. 📋 Meta batch operations tests
3. 📋 Rate limiting tests
4. 📋 Adaptive queue tests

### Phase 4: API Layer (Week 4)
1. 📋 Validation middleware tests
2. 📋 API endpoint integration tests
3. 📋 Error handling tests

### Phase 5: Advanced Testing (Week 5)
1. 📋 Performance tests
2. 📋 Load tests
3. 📋 End-to-end workflow tests
4. 📋 CI/CD pipeline setup

## Best Practices

### Testing Principles
1. **Arrange-Act-Assert**: Structure tests clearly
2. **Descriptive Names**: Test names should describe what they test
3. **One Assertion Per Test**: Focus on single behavior
4. **Mock External Dependencies**: Isolate units from external APIs
5. **Test Error Cases**: Verify error handling works correctly
6. **Coverage Requirements**: Aim for 80% coverage across all modules

### Mock Strategy
1. **Database**: Use in-memory SQLite for each test
2. **External APIs**: Mock axios, fs, ffmpeg
3. **Environment Variables**: Use test-specific values
4. **File System**: Mock file operations for predictable testing

### Test Data Management
1. **Fixtures**: Store test data in separate files
2. **Factories**: Create helper functions to generate test data
3. **Cleanup**: Ensure tests don't interfere with each other
4. **Isolation**: Each test should be independent

## Next Steps

1. Create the directory structure under `tests/`
2. Implement test helpers and utilities
3. Start with database layer tests (most critical)
4. Progress through business logic tests
5. Add API integration tests
6. Set up CI/CD pipeline

This comprehensive testing plan will ensure robust unit test coverage for the ZuckCannon application, focusing on the core components you mentioned: filtering logic, decision making, permissions, rules, and data transformation.