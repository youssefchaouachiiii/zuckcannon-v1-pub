import sqlite3 from "sqlite3";
import { getDbPath } from "./paths.js";

const db = new sqlite3.Database(getDbPath("facebook-auth.db"));

// Promisify database methods
db.runAsync = function (sql, params) {
  return new Promise((resolve, reject) => {
    this.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

db.getAsync = function (sql, params) {
  return new Promise((resolve, reject) => {
    this.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

db.allAsync = function (sql, params) {
  return new Promise((resolve, reject) => {
    this.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Enable foreign keys
await db.runAsync("PRAGMA foreign_keys = ON");
await db.runAsync("PRAGMA journal_mode = WAL");

// Initialize Facebook auth tables
async function initializeDatabase() {
  // Table to store Facebook access tokens for users
  // Note: No foreign keys since user data is in a separate database (auth-db.js)
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS facebook_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      facebook_user_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      token_type TEXT DEFAULT 'user',
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, facebook_user_id)
    )
  `);

  // Table to store business portfolios
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS facebook_businesses (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Table to store ad accounts associated with users
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS facebook_ad_accounts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      business_id TEXT,
      name TEXT NOT NULL,
      currency TEXT,
      timezone_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (business_id) REFERENCES facebook_businesses(id) ON DELETE SET NULL
    )
  `);

  // Table to store Facebook pages
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS facebook_pages (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      access_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Table to store system user tokens for Business Managers
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

  // ---- Multi-BM schema (additive; alongside legacy tables above) ----
  // Business Managers: top-level org unit for per-ad-account → BM → system-user routing.
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS business_managers (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      role                TEXT NOT NULL DEFAULT 'launching'
                            CHECK (role IN ('tm', 'launching', 'archived')),
      status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'disabled', 'restricted', 'unknown')),
      notes               TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_business_managers_role   ON business_managers(role)`);
  await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_business_managers_status ON business_managers(status)`);

  // System Users: per-BM system-user tokens (composite PK: fb_user_id + BM).
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS system_users (
      fb_user_id          TEXT NOT NULL,
      business_manager_id TEXT NOT NULL,
      name                TEXT NOT NULL,
      access_token        TEXT NOT NULL,
      expires_at          DATETIME,
      last_validated_at   DATETIME,
      last_validation_ok  INTEGER DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (fb_user_id, business_manager_id),
      FOREIGN KEY (business_manager_id) REFERENCES business_managers(id) ON DELETE CASCADE
    )
  `);
  await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_system_users_bm      ON system_users(business_manager_id)`);
  await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_system_users_expires ON system_users(expires_at)`);

  // Ad Accounts (BM-scoped, new schema).
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS ad_accounts (
      id                  TEXT PRIMARY KEY,
      account_id          TEXT NOT NULL,
      business_manager_id TEXT NOT NULL,
      name                TEXT NOT NULL,
      currency            TEXT,
      timezone_name       TEXT,
      status              TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (status IN ('active', 'disabled', 'restricted', 'unknown')),
      last_synced_at      DATETIME,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (business_manager_id) REFERENCES business_managers(id) ON DELETE CASCADE
    )
  `);
  await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_ad_accounts_bm     ON ad_accounts(business_manager_id)`);
  await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_ad_accounts_status ON ad_accounts(status)`);

  console.log("Facebook auth database initialized");
}

await initializeDatabase();

// Normalize an ad account ID. Accepts either `act_123` or `123`.
// Returns { id: 'act_123', accountId: '123' }.
function normalizeAdAccountId(input) {
  const s = String(input);
  if (s.startsWith("act_")) return { id: s, accountId: s.slice(4) };
  return { id: `act_${s}`, accountId: s };
}

export const FacebookAuthDB = {
  // Token management
  async saveToken(userId, facebookUserId, accessToken, tokenType = "user", expiresIn = null) {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    return await db.runAsync(
      `
      INSERT INTO facebook_tokens (user_id, facebook_user_id, access_token, token_type, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, facebook_user_id) 
      DO UPDATE SET 
        access_token = excluded.access_token,
        token_type = excluded.token_type,
        expires_at = excluded.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `,
      [userId, facebookUserId, accessToken, tokenType, expiresAt]
    );
  },

  async getToken(userId) {
    return await db.getAsync(
      `
      SELECT * FROM facebook_tokens 
      WHERE user_id = ? 
      ORDER BY updated_at DESC 
      LIMIT 1
    `,
      [userId]
    );
  },

  async getValidToken(userId) {
    const token = await this.getToken(userId);
    if (!token) return null;

    // Check if token is expired
    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      return null;
    }

    return token;
  },

  async deleteToken(userId) {
    return await db.runAsync(
      `
      DELETE FROM facebook_tokens WHERE user_id = ?
    `,
      [userId]
    );
  },

  // Business management
  async saveBusiness(businessId, userId, name) {
    return await db.runAsync(
      `
      INSERT INTO facebook_businesses (id, user_id, name)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name
    `,
      [businessId, userId, name]
    );
  },

  async getBusinesses(userId) {
    return await db.allAsync(
      `
      SELECT * FROM facebook_businesses WHERE user_id = ?
    `,
      [userId]
    );
  },

  // Ad account management
  async saveAdAccount(id, accountId, userId, businessId, name, currency, timezoneName) {
    return await db.runAsync(
      `
      INSERT INTO facebook_ad_accounts (id, account_id, user_id, business_id, name, currency, timezone_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        name = excluded.name,
        business_id = excluded.business_id,
        currency = excluded.currency,
        timezone_name = excluded.timezone_name
    `,
      [id, accountId, userId, businessId, name, currency, timezoneName]
    );
  },

  async getAdAccounts(userId) {
    return await db.allAsync(
      `
      SELECT * FROM facebook_ad_accounts WHERE user_id = ?
    `,
      [userId]
    );
  },

  async deleteAdAccount(id) {
    return await db.runAsync(
      `
      DELETE FROM facebook_ad_accounts WHERE id = ?
    `,
      [id]
    );
  },

  // Page management
  async savePage(pageId, userId, name, accessToken = null) {
    return await db.runAsync(
      `
      INSERT INTO facebook_pages (id, user_id, name, access_token)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        name = excluded.name,
        access_token = COALESCE(excluded.access_token, access_token)
    `,
      [pageId, userId, name, accessToken]
    );
  },

  async getPages(userId) {
    return await db.allAsync(
      `
      SELECT * FROM facebook_pages WHERE user_id = ?
    `,
      [userId]
    );
  },

  async deletePage(id) {
    return await db.runAsync(
      `
      DELETE FROM facebook_pages WHERE id = ?
    `,
      [id]
    );
  },

  // Check if user has connected Facebook
  async isConnected(userId) {
    const token = await this.getValidToken(userId);
    return token !== null;
  },

  // Get all user's Facebook data
  async getUserFacebookData(userId) {
    const [token, businesses, adAccounts, pages] = await Promise.all([this.getValidToken(userId), this.getBusinesses(userId), this.getAdAccounts(userId), this.getPages(userId)]);

    return {
      connected: token !== null,
      token: token?.access_token,
      businesses,
      adAccounts,
      pages,
    };
  },

  // System user token management
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
    return (await db.getAsync(
      `SELECT * FROM system_user_tokens WHERE business_manager_id = ?`,
      [businessManagerId]
    )) || null;
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

  async getExpiringTokens(daysAhead = 7) {
    const threshold = new Date(Date.now() + daysAhead * 86400000).toISOString();
    return db.allAsync(
      `SELECT id, business_name, business_manager_id, expires_at
       FROM system_user_tokens
       WHERE expires_at IS NOT NULL AND expires_at <= ?`,
      [threshold]
    );
  },

  // Delete all user's Facebook data
  async deleteAllUserData(userId) {
    await Promise.all([
      db.runAsync("DELETE FROM facebook_tokens WHERE user_id = ?", [userId]),
      db.runAsync("DELETE FROM facebook_businesses WHERE user_id = ?", [userId]),
      db.runAsync("DELETE FROM facebook_ad_accounts WHERE user_id = ?", [userId]),
      db.runAsync("DELETE FROM facebook_pages WHERE user_id = ?", [userId]),
    ]);
  },

  // ==== Multi-BM schema methods (additive; new tables only) ====

  // ---- Business Managers ----
  async upsertBusinessManager({ id, name, role = "launching", status = "active", notes = null }) {
    return await db.runAsync(
      `INSERT INTO business_managers (id, name, role, status, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         role = excluded.role,
         status = excluded.status,
         notes = excluded.notes,
         updated_at = CURRENT_TIMESTAMP`,
      [id, name, role, status, notes]
    );
  },

  async listBusinessManagers({ role, status } = {}) {
    const where = [];
    const params = [];
    if (role) {
      where.push("role = ?");
      params.push(role);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    const sql = `SELECT * FROM business_managers ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name ASC`;
    return await db.allAsync(sql, params);
  },

  async getBusinessManager(id) {
    return (await db.getAsync(`SELECT * FROM business_managers WHERE id = ?`, [id])) || null;
  },

  // ---- System Users ----
  async upsertSystemUser({ fb_user_id, business_manager_id, name, access_token, expires_at = null }) {
    return await db.runAsync(
      `INSERT INTO system_users
         (fb_user_id, business_manager_id, name, access_token, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(fb_user_id, business_manager_id) DO UPDATE SET
         name = excluded.name,
         access_token = excluded.access_token,
         expires_at = excluded.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
      [fb_user_id, business_manager_id, name, access_token, expires_at]
    );
  },

  async getSystemUserForBm(business_manager_id) {
    return (
      (await db.getAsync(
        `SELECT * FROM system_users
         WHERE business_manager_id = ?
         ORDER BY last_validation_ok DESC, updated_at DESC
         LIMIT 1`,
        [business_manager_id]
      )) || null
    );
  },

  async listSystemUsers() {
    return await db.allAsync(
      `SELECT * FROM system_users ORDER BY business_manager_id ASC, fb_user_id ASC`,
      []
    );
  },

  async getAnyHealthySystemUser() {
    return (
      (await db.getAsync(
        `SELECT * FROM system_users
         WHERE last_validation_ok = 1
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY updated_at DESC
         LIMIT 1`,
        [new Date().toISOString()]
      )) || null
    );
  },

  async deleteSystemUser(fb_user_id, business_manager_id) {
    return await db.runAsync(
      `DELETE FROM system_users WHERE fb_user_id = ? AND business_manager_id = ?`,
      [fb_user_id, business_manager_id]
    );
  },

  async markValidation({ fb_user_id, business_manager_id, ok, expires_at }) {
    if (expires_at !== undefined) {
      return await db.runAsync(
        `UPDATE system_users
         SET last_validated_at = CURRENT_TIMESTAMP,
             last_validation_ok = ?,
             expires_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE fb_user_id = ? AND business_manager_id = ?`,
        [ok ? 1 : 0, expires_at, fb_user_id, business_manager_id]
      );
    }
    return await db.runAsync(
      `UPDATE system_users
       SET last_validated_at = CURRENT_TIMESTAMP,
           last_validation_ok = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE fb_user_id = ? AND business_manager_id = ?`,
      [ok ? 1 : 0, fb_user_id, business_manager_id]
    );
  },

  async getExpiringSystemUsers(daysAhead = 7) {
    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
    return await db.allAsync(
      `SELECT * FROM system_users
       WHERE expires_at IS NOT NULL AND expires_at <= ?
       ORDER BY expires_at ASC`,
      [cutoff]
    );
  },

  // ---- Ad Accounts (BM-scoped, new schema) ----
  async upsertAdAccount({ id, account_id, business_manager_id, name, currency = null, timezone_name = null, status = "unknown" }) {
    return await db.runAsync(
      `INSERT INTO ad_accounts
         (id, account_id, business_manager_id, name, currency, timezone_name, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         account_id = excluded.account_id,
         business_manager_id = excluded.business_manager_id,
         name = excluded.name,
         currency = excluded.currency,
         timezone_name = excluded.timezone_name,
         status = excluded.status,
         updated_at = CURRENT_TIMESTAMP`,
      [id, account_id, business_manager_id, name, currency, timezone_name, status]
    );
  },

  async getAdAccount(idOrAccountId) {
    const { id, accountId } = normalizeAdAccountId(idOrAccountId);
    return (
      (await db.getAsync(`SELECT * FROM ad_accounts WHERE id = ? OR account_id = ? LIMIT 1`, [id, accountId])) || null
    );
  },

  async listAdAccountsForBm(business_manager_id) {
    return await db.allAsync(
      `SELECT * FROM ad_accounts WHERE business_manager_id = ? ORDER BY name ASC`,
      [business_manager_id]
    );
  },
};

export default FacebookAuthDB;
