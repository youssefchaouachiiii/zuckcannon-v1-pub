# System Users Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate zuckcannon's Facebook API authentication from personal OAuth tokens to Facebook System Users, eliminating ad account ban risk for clients.

**Architecture:** Add `system_user_tokens` table to `facebook-auth.db`. New backend routes for token CRUD + verification. Token selector utility checks for System User token first, falls back to OAuth token. New frontend page in the existing vanilla JS app.

**Tech Stack:** Node.js ESM, Express, SQLite3 (sqlite3 package, promisified), Jest + Supertest, vanilla JS frontend

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/utils/facebook-auth-db.js` | Modify | Add `system_user_tokens` table + CRUD methods |
| `backend/utils/fb-token-selector.js` | Create | Pick system user token or fallback to OAuth |
| `backend/routes/fb-accounts.js` | Create | CRUD + verify routes for System User tokens |
| `server.js` | Modify | Import + mount fb-accounts router |
| `public/index.html` | Modify | Add FB Accounts nav item + page section |
| `public/fb-accounts.js` | Create | Frontend JS for FB Accounts page |
| `tests/fb-token-selector.test.js` | Create | Unit tests for token selector |
| `tests/fb-accounts-routes.test.js` | Create | Integration tests for routes |

---

## Task 1: Jest Config for ESM

**Files:**
- Create: `jest.config.js`
- Create: `tests/setup.js`

- [ ] **Step 1: Create jest.config.js**

```js
// jest.config.js
export default {
  testEnvironment: 'node',
  transform: {},
  setupFilesAfterFramework: ['./tests/setup.js'],
};
```

- [ ] **Step 2: Create test setup**

```js
// tests/setup.js
// Silence console.log in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
};
```

- [ ] **Step 3: Run existing test suite to confirm Jest works**

```bash
cd /path/to/zuckcannon-v1-pub
npm test
```

Expected: "Test Suites: 0 passed" (no tests yet, but Jest runs without error)

- [ ] **Step 4: Commit**

```bash
git add jest.config.js tests/setup.js
git commit -m "chore: configure Jest for ESM"
```

---

## Task 2: system_user_tokens Table + DB Methods

**Files:**
- Modify: `backend/utils/facebook-auth-db.js`
- Create: `tests/facebook-auth-db.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/facebook-auth-db.test.js
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

describe('SystemUserTokens', () => {
  afterEach(async () => {
    await FacebookAuthDB.deleteSystemUserToken('bm_test_123');
  });

  test('saveSystemUserToken stores a new token', async () => {
    await FacebookAuthDB.saveSystemUserToken(
      'bm_test_123',
      'Test BM',
      'EAABwzLtest',
      null
    );
    const token = await FacebookAuthDB.getSystemUserToken('bm_test_123');
    expect(token).not.toBeNull();
    expect(token.access_token).toBe('EAABwzLtest');
    expect(token.business_name).toBe('Test BM');
  });

  test('getSystemUserToken returns null if not found', async () => {
    const token = await FacebookAuthDB.getSystemUserToken('nonexistent');
    expect(token).toBeNull();
  });

  test('listSystemUserTokens returns all tokens', async () => {
    await FacebookAuthDB.saveSystemUserToken('bm_test_123', 'BM One', 'token1', null);
    const list = await FacebookAuthDB.listSystemUserTokens();
    expect(list.length).toBeGreaterThan(0);
    expect(list.some(t => t.business_manager_id === 'bm_test_123')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/facebook-auth-db.test.js
```

Expected: FAIL — "FacebookAuthDB.saveSystemUserToken is not a function"

- [ ] **Step 3: Add table creation to `initializeDatabase()` in `facebook-auth-db.js`**

Find the `initializeDatabase()` function and add after the existing CREATE TABLE statements:

```js
await db.runAsync(`
  CREATE TABLE IF NOT EXISTS system_user_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_manager_id TEXT NOT NULL UNIQUE,
    business_name TEXT NOT NULL,
    access_token TEXT NOT NULL,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
```

- [ ] **Step 4: Add CRUD methods to the `FacebookAuthDB` export object**

Add these methods inside the `export const FacebookAuthDB = { ... }` block:

```js
async saveSystemUserToken(businessManagerId, businessName, accessToken, expiresAt = null) {
  return await db.runAsync(
    `INSERT INTO system_user_tokens
      (business_manager_id, business_name, access_token, expires_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(business_manager_id)
     DO UPDATE SET
       business_name = excluded.business_name,
       access_token = excluded.access_token,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
    [businessManagerId, businessName, accessToken, expiresAt]
  );
},

async getSystemUserToken(businessManagerId) {
  return await db.getAsync(
    `SELECT * FROM system_user_tokens WHERE business_manager_id = ?`,
    [businessManagerId]
  );
},

async listSystemUserTokens() {
  return await db.allAsync(
    `SELECT * FROM system_user_tokens ORDER BY business_name ASC`,
    []
  );
},

async deleteSystemUserToken(businessManagerId) {
  return await db.runAsync(
    `DELETE FROM system_user_tokens WHERE business_manager_id = ?`,
    [businessManagerId]
  );
},
```

- [ ] **Step 5: Run tests**

```bash
npm test tests/facebook-auth-db.test.js
```

Expected: PASS — 3 tests passing

- [ ] **Step 6: Commit**

```bash
git add backend/utils/facebook-auth-db.js tests/facebook-auth-db.test.js
git commit -m "feat: add system_user_tokens table and CRUD methods"
```

---

## Task 3: Token Selector Utility

This utility is the migration bridge — when zuckcannon makes any FB API call, it calls this first to get the right token.

**Files:**
- Create: `backend/utils/fb-token-selector.js`
- Create: `tests/fb-token-selector.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/fb-token-selector.test.js
import { selectFbToken } from '../backend/utils/fb-token-selector.js';

// Mock FacebookAuthDB
jest.mock('../backend/utils/facebook-auth-db.js', () => ({
  FacebookAuthDB: {
    listSystemUserTokens: jest.fn(),
    getToken: jest.fn(),
  },
}));

import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

describe('selectFbToken', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns system user token when available', async () => {
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([
      { business_manager_id: 'bm_1', access_token: 'SYSTEM_TOKEN', expires_at: null }
    ]);

    const result = await selectFbToken(1, 'act_123');
    expect(result.token).toBe('SYSTEM_TOKEN');
    expect(result.type).toBe('system_user');
  });

  test('falls back to OAuth token when no system user token', async () => {
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([]);
    FacebookAuthDB.getToken.mockResolvedValue({ access_token: 'OAUTH_TOKEN' });

    const result = await selectFbToken(1, 'act_123');
    expect(result.token).toBe('OAUTH_TOKEN');
    expect(result.type).toBe('oauth');
  });

  test('returns null when neither token exists', async () => {
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([]);
    FacebookAuthDB.getToken.mockResolvedValue(null);

    const result = await selectFbToken(1, 'act_123');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/fb-token-selector.test.js
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create `fb-token-selector.js`**

```js
// backend/utils/fb-token-selector.js
import { FacebookAuthDB } from './facebook-auth-db.js';

/**
 * Returns the best available token for FB API calls.
 * Prefers System User token (safer for automation).
 * Falls back to OAuth token if no System User token configured.
 *
 * @param {number} userId - zuckcannon user ID (for OAuth fallback)
 * @param {string} adAccountId - FB ad account ID (for future per-account filtering)
 * @returns {Promise<{token: string, type: 'system_user'|'oauth'}|null>}
 */
export async function selectFbToken(userId, adAccountId) {
  const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();

  if (systemUserTokens.length > 0) {
    // Use first available system user token
    // (all tokens in the same BM can access all its ad accounts)
    const sut = systemUserTokens[0];
    return { token: sut.access_token, type: 'system_user' };
  }

  // Fallback to OAuth token
  const oauthToken = await FacebookAuthDB.getToken(userId);
  if (!oauthToken) return null;

  return { token: oauthToken.access_token, type: 'oauth' };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/fb-token-selector.test.js
```

Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/utils/fb-token-selector.js tests/fb-token-selector.test.js
git commit -m "feat: add token selector utility (system user > oauth fallback)"
```

---

## Task 4: FB Accounts Routes

**Files:**
- Create: `backend/routes/fb-accounts.js`
- Create: `tests/fb-accounts-routes.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/fb-accounts-routes.test.js
import request from 'supertest';
import express from 'express';
import { fbAccountsRouter } from '../backend/routes/fb-accounts.js';

jest.mock('../backend/utils/facebook-auth-db.js', () => ({
  FacebookAuthDB: {
    listSystemUserTokens: jest.fn(),
    saveSystemUserToken: jest.fn(),
    deleteSystemUserToken: jest.fn(),
  },
}));

// Mock axios for FB API verification call
jest.mock('axios', () => ({
  default: { get: jest.fn() },
}));

import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';
import axios from 'axios';

const app = express();
app.use(express.json());
app.use('/api/fb-accounts', fbAccountsRouter);

describe('GET /api/fb-accounts/tokens', () => {
  test('returns list of system user tokens', async () => {
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([
      { business_manager_id: 'bm_1', business_name: 'SGP', expires_at: null }
    ]);

    const res = await request(app).get('/api/fb-accounts/tokens');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].business_name).toBe('SGP');
  });
});

describe('POST /api/fb-accounts/tokens/verify', () => {
  test('verifies token and saves if valid', async () => {
    axios.default.get.mockResolvedValue({
      data: { id: 'bm_123', name: 'SGP Business' }
    });
    FacebookAuthDB.saveSystemUserToken.mockResolvedValue({});

    const res = await request(app)
      .post('/api/fb-accounts/tokens/verify')
      .send({ access_token: 'EAABwzLtest' });

    expect(res.status).toBe(200);
    expect(res.body.business_name).toBe('SGP Business');
  });

  test('returns 400 if token is invalid', async () => {
    axios.default.get.mockRejectedValue({ response: { data: { error: { message: 'Invalid token' } } } });

    const res = await request(app)
      .post('/api/fb-accounts/tokens/verify')
      .send({ access_token: 'bad_token' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid token');
  });
});

describe('DELETE /api/fb-accounts/tokens/:bmId', () => {
  test('deletes token by business manager ID', async () => {
    FacebookAuthDB.deleteSystemUserToken.mockResolvedValue({});

    const res = await request(app).delete('/api/fb-accounts/tokens/bm_123');
    expect(res.status).toBe(200);
    expect(FacebookAuthDB.deleteSystemUserToken).toHaveBeenCalledWith('bm_123');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/fb-accounts-routes.test.js
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create `backend/routes/fb-accounts.js`**

```js
// backend/routes/fb-accounts.js
import express from 'express';
import axios from 'axios';
import { FacebookAuthDB } from '../utils/facebook-auth-db.js';

export const fbAccountsRouter = express.Router();

// GET /api/fb-accounts/tokens
// List all system user tokens (access_token redacted)
fbAccountsRouter.get('/tokens', async (req, res) => {
  try {
    const tokens = await FacebookAuthDB.listSystemUserTokens();
    // Redact the actual token from list response
    const safe = tokens.map(({ access_token, ...rest }) => ({
      ...rest,
      token_preview: access_token.slice(0, 8) + '...',
    }));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list tokens' });
  }
});

// POST /api/fb-accounts/tokens/verify
// Verify a system user token against FB API, then save it
fbAccountsRouter.post('/tokens/verify', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'access_token is required' });

  try {
    // Verify token by calling FB Graph API /me
    const meResponse = await axios.get(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${access_token}`
    );
    const { id: businessManagerId, name: businessName } = meResponse.data;

    await FacebookAuthDB.saveSystemUserToken(
      businessManagerId,
      businessName,
      access_token,
      null // system user tokens can be non-expiring
    );

    res.json({ business_manager_id: businessManagerId, business_name: businessName });
  } catch (err) {
    const message = err?.response?.data?.error?.message || 'Token verification failed';
    res.status(400).json({ error: message });
  }
});

// DELETE /api/fb-accounts/tokens/:bmId
fbAccountsRouter.delete('/tokens/:bmId', async (req, res) => {
  try {
    await FacebookAuthDB.deleteSystemUserToken(req.params.bmId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete token' });
  }
});
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/fb-accounts-routes.test.js
```

Expected: PASS — 4 tests passing

- [ ] **Step 5: Mount router in `server.js`**

Find the imports section at the top of `server.js` and add:

```js
import { fbAccountsRouter } from './backend/routes/fb-accounts.js';
```

Find where other routes are registered (search for `app.get` or `app.use`) and add after existing route registrations:

```js
app.use('/api/fb-accounts', ensureAuthenticatedAPI, fbAccountsRouter);
```

- [ ] **Step 6: Restart dev server and test manually**

```bash
npm run dev
# In another terminal:
curl http://localhost:6969/api/fb-accounts/tokens
```

Expected: `[]` (empty array, not a 404 or 500)

- [ ] **Step 7: Commit**

```bash
git add backend/routes/fb-accounts.js tests/fb-accounts-routes.test.js server.js
git commit -m "feat: add FB Accounts routes for System User token management"
```

---

## Task 5: FB Accounts Frontend Page

**Files:**
- Create: `public/fb-accounts.js`
- Modify: `public/index.html`

- [ ] **Step 1: Add nav item and page section to `public/index.html`**

Find the sidebar navigation in `index.html` (look for `<nav>` or navigation links). Add:

```html
<a href="#fb-accounts" class="nav-item" data-page="fb-accounts">
  FB Accounts
</a>
```

Find the main content area and add a new page section:

```html
<section id="page-fb-accounts" class="page" style="display:none;">
  <h2>FB Accounts</h2>
  <p class="subtitle">Manage Facebook System User tokens for safe API automation.</p>

  <div class="card" id="add-token-card">
    <h3>Add Business Manager</h3>
    <p>Create a System User in <a href="https://business.facebook.com" target="_blank">Facebook Business Manager</a>
      → Business Settings → System Users → Generate Token (scopes: ads_management, ads_read, business_management)</p>
    <div class="form-row">
      <input type="text" id="system-user-token-input" placeholder="Paste System User token..." />
      <button id="verify-token-btn" class="btn-primary">Verify &amp; Save</button>
    </div>
    <div id="verify-token-status"></div>
  </div>

  <div class="card">
    <h3>Connected Business Managers</h3>
    <table id="system-user-tokens-table">
      <thead>
        <tr>
          <th>Business Manager</th>
          <th>ID</th>
          <th>Token</th>
          <th>Expires</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="system-user-tokens-body">
        <tr><td colspan="6">Loading...</td></tr>
      </tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 2: Create `public/fb-accounts.js`**

```js
// public/fb-accounts.js

async function loadSystemUserTokens() {
  const tbody = document.getElementById('system-user-tokens-body');
  try {
    const res = await fetch('/api/fb-accounts/tokens');
    const tokens = await res.json();

    if (tokens.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No tokens configured. Add one above.</td></tr>';
      return;
    }

    tbody.innerHTML = tokens.map(t => {
      const expires = t.expires_at
        ? new Date(t.expires_at).toLocaleDateString()
        : 'Never';
      const daysLeft = t.expires_at
        ? Math.ceil((new Date(t.expires_at) - new Date()) / 86400000)
        : null;
      const statusBadge = !t.expires_at
        ? '<span class="badge badge-success">✅ Active</span>'
        : daysLeft > 7
        ? '<span class="badge badge-success">✅ Active</span>'
        : daysLeft > 0
        ? `<span class="badge badge-warning">⚠️ Expires in ${daysLeft}d</span>`
        : '<span class="badge badge-error">🔴 Expired</span>';

      return `<tr>
        <td>${t.business_name}</td>
        <td><code>${t.business_manager_id}</code></td>
        <td><code>${t.token_preview}</code></td>
        <td>${expires}</td>
        <td>${statusBadge}</td>
        <td>
          <button class="btn-danger btn-sm"
            onclick="deleteSystemUserToken('${t.business_manager_id}', '${t.business_name}')">
            Remove
          </button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6">Failed to load tokens.</td></tr>';
  }
}

async function verifyAndSaveToken() {
  const input = document.getElementById('system-user-token-input');
  const status = document.getElementById('verify-token-status');
  const btn = document.getElementById('verify-token-btn');

  const token = input.value.trim();
  if (!token) return;

  btn.disabled = true;
  status.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/fb-accounts/tokens/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token }),
    });
    const data = await res.json();

    if (!res.ok) {
      status.innerHTML = `<span class="error">❌ ${data.error}</span>`;
      return;
    }

    status.innerHTML = `<span class="success">✅ Connected: ${data.business_name}</span>`;
    input.value = '';
    await loadSystemUserTokens();
  } catch (err) {
    status.innerHTML = '<span class="error">❌ Network error. Try again.</span>';
  } finally {
    btn.disabled = false;
  }
}

async function deleteSystemUserToken(bmId, bmName) {
  if (!confirm(`Remove token for "${bmName}"? This will revert FB API calls to OAuth tokens for this Business Manager.`)) return;

  try {
    await fetch(`/api/fb-accounts/tokens/${bmId}`, { method: 'DELETE' });
    await loadSystemUserTokens();
  } catch (err) {
    alert('Failed to remove token. Try again.');
  }
}

// Initialize when page becomes active
function initFbAccountsPage() {
  document.getElementById('verify-token-btn')
    .addEventListener('click', verifyAndSaveToken);
  loadSystemUserTokens();
}

window.deleteSystemUserToken = deleteSystemUserToken;
window.initFbAccountsPage = initFbAccountsPage;
```

- [ ] **Step 3: Load the script in `index.html`**

Find where other scripts are loaded (near the bottom of `<body>`) and add:

```html
<script src="/fb-accounts.js"></script>
```

- [ ] **Step 4: Wire page navigation in `public/script.js`**

Find the navigation/page-switching logic in `script.js` (look for `data-page` or `showPage` function). Add `fb-accounts` to the page map and call `initFbAccountsPage()` when that page is shown. The exact code depends on the existing nav pattern — find `init()` or the click handler and add:

```js
// In the nav click handler or page switch function:
case 'fb-accounts':
  initFbAccountsPage();
  break;
```

- [ ] **Step 5: Manual test in browser**

```bash
npm run dev
# Open http://localhost:6969
# 1. Click "FB Accounts" in sidebar → page renders without errors
# 2. Paste an invalid token → error message shown
# 3. Paste a valid System User token → "Connected: [BM name]" shown
# 4. Token appears in table with correct status badge
# 5. Click Remove → token deleted, table updates
```

- [ ] **Step 6: Commit**

```bash
git add public/fb-accounts.js public/index.html public/script.js
git commit -m "feat: add FB Accounts page for System User token management"
```

---

## Task 6: Wire Token Selector into Existing FB API Calls

The creative upload flow currently uses personal OAuth tokens. Update it to use `selectFbToken`.

**Files:**
- Modify: `server.js` (FB API call sites)

- [ ] **Step 1: Import token selector in `server.js`**

Add to imports at top of `server.js`:

```js
import { selectFbToken } from './backend/utils/fb-token-selector.js';
```

- [ ] **Step 2: Find all FB API call sites in `server.js`**

```bash
grep -n "access_token\|FacebookAuthDB.getToken\|FacebookAuthDB.getValidToken" server.js
```

Note all line numbers returned.

- [ ] **Step 3: Replace OAuth token retrieval with `selectFbToken`**

For each location that does something like:
```js
const tokenData = await FacebookAuthDB.getValidToken(req.user.id);
const accessToken = tokenData?.access_token;
```

Replace with:
```js
const tokenData = await selectFbToken(req.user.id, req.body.adAccountId || null);
if (!tokenData) return res.status(401).json({ error: 'No Facebook token available. Connect via FB Accounts.' });
const accessToken = tokenData.token;
```

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
# Test existing creative upload flow still works
# If you have a System User token configured: confirm it uses that
# If no System User token: confirm it falls back to OAuth token
```

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: use system user token for FB API calls, fallback to oauth"
```

---

## Verification Checklist

Before calling this plan done:

- [ ] `npm test` → all tests pass
- [ ] FB Accounts page renders at `/` after login
- [ ] Can add a System User token: verify → saved → appears in table
- [ ] Token status badge shows correctly (✅ Active / ⚠️ expiring / 🔴 expired)
- [ ] Can remove a token
- [ ] Existing creative upload flow still works (with and without System User token)
- [ ] Server logs show "Using system_user token" vs "Using oauth token" (add console.log in selectFbToken if helpful for debugging)
