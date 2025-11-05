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

  console.log("Facebook auth database initialized");
}

await initializeDatabase();

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

  // Delete all user's Facebook data
  async deleteAllUserData(userId) {
    await Promise.all([
      db.runAsync("DELETE FROM facebook_tokens WHERE user_id = ?", [userId]),
      db.runAsync("DELETE FROM facebook_businesses WHERE user_id = ?", [userId]),
      db.runAsync("DELETE FROM facebook_ad_accounts WHERE user_id = ?", [userId]),
      db.runAsync("DELETE FROM facebook_pages WHERE user_id = ?", [userId]),
    ]);
  },
};

export default FacebookAuthDB;
