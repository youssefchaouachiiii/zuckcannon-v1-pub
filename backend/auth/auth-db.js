import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { getDbPath } from '../utils/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new sqlite3.Database(getDbPath('users.db'));

// Promisify database methods
db.runAsync = function(sql, params) {
  return new Promise((resolve, reject) => {
    this.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

db.getAsync = function(sql, params) {
  return new Promise((resolve, reject) => {
    this.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

db.allAsync = function(sql, params) {
  return new Promise((resolve, reject) => {
    this.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize users table
await db.runAsync(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  )
`);

// Add facebookId column if it doesn't exist (migration)
const tableInfo = await db.allAsync('PRAGMA table_info(users)');
const hasFacebookId = tableInfo.some(col => col.name === 'facebookId');

if (!hasFacebookId) {
  // Add column without UNIQUE constraint (can't add UNIQUE to existing table with data)
  await db.runAsync('ALTER TABLE users ADD COLUMN facebookId TEXT');
  console.log('Added facebookId column to users table');
}

// Create index for facebookId if it doesn't exist
await db.runAsync(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_facebookId 
  ON users(facebookId) 
  WHERE facebookId IS NOT NULL
`).catch(err => {
  // Ignore error if index already exists
  if (!err.message.includes('already exists')) {
    console.error('Error creating facebookId index:', err);
  }
});

// User management functions
export const UserDB = {
  async create(username, password, email = null) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return await db.runAsync(
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      [username, hashedPassword, email]
    );
  },

  async findByUsername(username) {
    return await db.getAsync(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
  },

  async findById(id) {
    return await db.getAsync(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
  },

  async verifyPassword(username, password) {
    const user = await this.findByUsername(username);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return null;
    
    // Update last login
    await db.runAsync(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );
    
    return user;
  },

  async getAll() {
    return await db.allAsync(
      'SELECT id, username, email, created_at, last_login FROM users ORDER BY created_at DESC'
    );
  },

  async updatePassword(userId, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    return await db.runAsync(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );
  },

  async delete(userId) {
    return await db.runAsync(
      'DELETE FROM users WHERE id = ?',
      [userId]
    );
  },

  async findByFacebookId(facebookId) {
    return await db.getAsync(
      'SELECT * FROM users WHERE facebookId = ?',
      [facebookId]
    );
  },

  async updateFacebookId(userId, facebookId) {
    return await db.runAsync(
      'UPDATE users SET facebookId = ? WHERE id = ?',
      [facebookId, userId]
    );
  },

  async createFacebookUser(username, facebookId, email = null) {
    const result = await db.runAsync(
      'INSERT INTO users (username, facebookId, email, password) VALUES (?, ?, ?, ?)',
      [username, facebookId, email, ''] // Empty password for OAuth users
    );
    
    return await this.findById(result.lastID);
  }
};

export default db;