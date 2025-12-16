
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS cached_pages (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      last_fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, user_id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS cached_pixels (
      id TEXT NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 0,
      account_id TEXT NOT NULL,
      name TEXT,
      data TEXT NOT NULL,
      last_fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, account_id, user_id)
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS rule_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      execution_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      entities_affected INTEGER DEFAULT 0,
      actions_taken INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      result_data TEXT,
      error_message TEXT,
      FOREIGN KEY (rule_id) REFERENCES automated_rules(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS rule_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      action_taken TEXT NOT NULL,
      result TEXT NOT NULL,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES automated_rules(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for better performance
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_creatives_file_hash ON creatives(file_hash)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_creatives_batch_id ON creatives(batch_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_creative_accounts ON creative_accounts(creative_id, ad_account_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_rules_user_account ON automated_rules(user_id, ad_account_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_rules_status ON automated_rules(status)`);
}

/**
 * Create a test database with sample data
 * @returns {Promise<Database>} Database instance with sample data
 */
export async function createTestDatabaseWithSampleData() {
  const db = await createTestDatabase();
  
  // Insert sample creative
  await db.run(`
    INSERT INTO creatives (file_hash, file_name, original_name, file_path, file_type, file_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `, ['sample_hash_1', 'test_image.jpg', 'test_image.jpg', '/path/to/test_image.jpg', 'image/jpeg', 1024]);
  
  // Insert sample creative batch
  await db.run(`
    INSERT INTO creative_batches (name, description)
    VALUES (?, ?)
  `, ['Test Batch', 'A test batch for unit testing']);
  
  // Insert sample user
  await db.run(`
    INSERT INTO users (username, password, email)
    VALUES (?, ?, ?)
  `, ['testuser', 'hashed_password', 'test@example.com']);
  
  return db;
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

/**
 * Reset database to clean state
 * @param {Database} db - Database instance to reset
 */
export async function resetTestDatabase(db) {
  if (!db) return;
  
  // Delete all data but keep schema
  await db.exec(`
    DELETE FROM creatives;
    DELETE FROM creative_batches;
    DELETE FROM creative_accounts;
    DELETE FROM users;
    DELETE FROM cached_ad_accounts;
