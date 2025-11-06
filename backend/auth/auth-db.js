import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import { getDbPath } from "../utils/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new sqlite3.Database(getDbPath("users.db"));

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

// Check if users table needs migration
async function checkAndMigrateUsersTable() {
  try {
    // Check if table exists
    const tableInfo = await db.getAsync(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='users'
    `);

    if (!tableInfo) {
      return false; // Table doesn't exist yet, will be created
    }

    // Check if facebook columns exist
    const columnInfo = await db.allAsync(`PRAGMA table_info(users)`);
    const hasFacebookId = columnInfo.some((col) => col.name === "facebook_id");

    if (!hasFacebookId) {
      console.log("Migrating users table to add Facebook OAuth support...");

      // Add the new columns (without UNIQUE constraint - SQLite limitation)
      await db.runAsync(`ALTER TABLE users ADD COLUMN facebook_id TEXT`);
      await db.runAsync(`ALTER TABLE users ADD COLUMN facebook_access_token TEXT`);
      await db.runAsync(`ALTER TABLE users ADD COLUMN facebook_token_expires_at INTEGER`);

      // Create index for facebook_id to ensure uniqueness at application level
      try {
        await db.runAsync(`CREATE UNIQUE INDEX idx_users_facebook_id ON users(facebook_id) WHERE facebook_id IS NOT NULL`);
      } catch (err) {
        console.log("Note: Could not create unique index on facebook_id:", err.message);
      }

      console.log("Users table migration completed successfully");
    }

    return true;
  } catch (error) {
    console.error("Error during users table migration:", error);
    // Don't throw, let table creation proceed
    return false;
  }
}

// Run migration check before creating table
await checkAndMigrateUsersTable();

// Initialize users table
await db.runAsync(`
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

// User management functions
export const UserDB = {
  async create(username, password, email = null) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return await db.runAsync("INSERT INTO users (username, password, email) VALUES (?, ?, ?)", [username, hashedPassword, email]);
  },

  async findByUsername(username) {
    return await db.getAsync("SELECT * FROM users WHERE username = ?", [username]);
  },

  async findById(id) {
    return await db.getAsync("SELECT * FROM users WHERE id = ?", [id]);
  },

  async verifyPassword(username, password) {
    const user = await this.findByUsername(username);
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return null;

    // Update last login
    await db.runAsync("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", [user.id]);

    return user;
  },

  async getAll() {
    return await db.allAsync("SELECT id, username, email, created_at, last_login FROM users ORDER BY created_at DESC");
  },

  async updatePassword(userId, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    return await db.runAsync("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, userId]);
  },

  async delete(userId) {
    return await db.runAsync("DELETE FROM users WHERE id = ?", [userId]);
  },

  async findByFacebookId(facebookId) {
    return await db.getAsync("SELECT * FROM users WHERE facebook_id = ?", [facebookId]);
  },

  async updateFacebookToken(userId, accessToken, expiresIn) {
    const expiresAt = Date.now() + expiresIn * 1000;
    return await db.runAsync("UPDATE users SET facebook_access_token = ?, facebook_token_expires_at = ?, last_login = CURRENT_TIMESTAMP WHERE id = ?", [accessToken, expiresAt, userId]);
  },

  async createOrUpdateFacebookUser(facebookId, accessToken, expiresIn, profile) {
    const expiresAt = Date.now() + expiresIn * 1000;
    const existingUser = await this.findByFacebookId(facebookId);

    if (existingUser) {
      // Update existing user
      await db.runAsync("UPDATE users SET facebook_access_token = ?, facebook_token_expires_at = ?, last_login = CURRENT_TIMESTAMP WHERE facebook_id = ?", [accessToken, expiresAt, facebookId]);
      return await this.findByFacebookId(facebookId);
    } else {
      // Create new user
      const username = profile.displayName || profile.email || `facebook_${facebookId}`;
      const email = profile.email || null;

      const result = await db.runAsync("INSERT INTO users (username, password, email, facebook_id, facebook_access_token, facebook_token_expires_at) VALUES (?, ?, ?, ?, ?, ?)", [
        username,
        "oauth_user",
        email,
        facebookId,
        accessToken,
        expiresAt,
      ]);

      return await this.findById(result.lastID);
    }
  },
};

export default db;
