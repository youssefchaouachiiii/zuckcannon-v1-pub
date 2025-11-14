import sqlite3 from "sqlite3";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { getDbPath } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the database file is created with proper permissions
const dbPath = getDbPath("facebook-cache.db");

// Create the database with verbose mode for debugging
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error("Error opening database:", err);
  } else {
    // console.log("Connected to Facebook cache database");
  }
});

// Promisify database methods
db.runAsync = promisify(db.run.bind(db));
db.getAsync = promisify(db.get.bind(db));
db.allAsync = promisify(db.all.bind(db));

// Initialize database schema
async function initializeDatabase() {
  try {
    // Set pragmas for proper operation
    await db.runAsync("PRAGMA foreign_keys = OFF");
    await db.runAsync("PRAGMA journal_mode = WAL"); // Better concurrency
    await db.runAsync("PRAGMA synchronous = NORMAL"); // Better performance

    // Check if migration is needed
    const needsMigration = await checkIfMigrationNeeded();
    if (needsMigration) {
      console.log("Migrating database to add user_id support...");
      await migrateToUserIdSchema();
    }

    // Create ad_accounts cache table
    await db.runAsync(`
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

    // Create pages cache table
    await db.runAsync(`
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

    // Create campaigns cache table
    await db.runAsync(`
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

    // Create pixels cache table (composite primary key for pixel+account+user)
    await db.runAsync(`
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

    // Create cache metadata table for tracking overall cache state
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS cache_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_campaigns_account ON cached_campaigns(account_id)");
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_campaigns_user ON cached_campaigns(user_id)");
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_pixels_account ON cached_pixels(account_id)");
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_pixels_user ON cached_pixels(user_id)");
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_accounts_user ON cached_ad_accounts(user_id)");
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_pages_user ON cached_pages(user_id)");
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_last_fetched_accounts ON cached_ad_accounts(last_fetched)");
    await db.runAsync("CREATE INDEX IF NOT EXISTS idx_last_fetched_campaigns ON cached_campaigns(last_fetched)");

    // Check if we need to migrate from old schema with foreign keys
    const hasForeignKeys = await checkForForeignKeys();
    if (hasForeignKeys) {
      console.log("Migrating database to remove foreign key constraints...");
      await migrateDatabase();
    }

    // console.log("Facebook cache database initialized successfully");
  } catch (error) {
    console.error("Error initializing Facebook cache database:", error);
    throw error;
  }
}

// Check if migration to user_id schema is needed
async function checkIfMigrationNeeded() {
  try {
    // Check if cached_ad_accounts table exists
    const tableInfo = await db.getAsync(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='cached_ad_accounts'
    `);

    if (!tableInfo) {
      return false; // Table doesn't exist yet, no migration needed
    }

    // Check if user_id column exists
    const columnInfo = await db.allAsync(`PRAGMA table_info(cached_ad_accounts)`);
    const hasUserId = columnInfo.some((col) => col.name === "user_id");

    return !hasUserId; // Needs migration if user_id doesn't exist
  } catch (error) {
    console.error("Error checking migration status:", error);
    return false;
  }
}

// Migrate existing tables to include user_id
async function migrateToUserIdSchema() {
  try {
    console.log("Starting migration to add user_id support...");

    // Save existing data
    let accounts = [],
      pages = [],
      campaigns = [],
      pixels = [];

    try {
      accounts = await db.allAsync("SELECT * FROM cached_ad_accounts");
      pages = await db.allAsync("SELECT * FROM cached_pages");
      campaigns = await db.allAsync("SELECT * FROM cached_campaigns");
      pixels = await db.allAsync("SELECT * FROM cached_pixels");
    } catch (err) {
      console.log("No existing data to migrate or error reading:", err.message);
    }

    // Drop old tables
    await db.runAsync("DROP TABLE IF EXISTS cached_pixels");
    await db.runAsync("DROP TABLE IF EXISTS cached_campaigns");
    await db.runAsync("DROP TABLE IF EXISTS cached_pages");
    await db.runAsync("DROP TABLE IF EXISTS cached_ad_accounts");

    console.log("Old tables dropped, creating new schema...");

    // Tables will be created by initializeDatabase
    // We just cleared them, so they'll be recreated with new schema

    console.log("Migration completed. Old data discarded as we cannot associate it with users.");
  } catch (error) {
    console.error("Error during migration:", error);
    throw error;
  }
}

// Check if tables have foreign key constraints
async function checkForForeignKeys() {
  try {
    const result = await db.getAsync(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='cached_campaigns' 
      AND sql LIKE '%FOREIGN KEY%'
    `);
    return !!result;
  } catch (error) {
    return false;
  }
}

// Migrate database to remove foreign key constraints
async function migrateDatabase() {
  try {
    // Save existing data
    const accounts = await db.allAsync("SELECT * FROM cached_ad_accounts");
    const pages = await db.allAsync("SELECT * FROM cached_pages");
    const campaigns = await db.allAsync("SELECT * FROM cached_campaigns");
    const pixels = await db.allAsync("SELECT * FROM cached_pixels");

    // Drop old tables
    await db.runAsync("DROP TABLE IF EXISTS cached_pixels");
    await db.runAsync("DROP TABLE IF EXISTS cached_campaigns");
    await db.runAsync("DROP TABLE IF EXISTS cached_pages");
    await db.runAsync("DROP TABLE IF EXISTS cached_ad_accounts");

    // Recreate tables without foreign keys
    await initializeDatabase();

    // Restore data if any
    if (accounts.length > 0) {
      const stmt = db.prepare("INSERT INTO cached_ad_accounts VALUES (?, ?, ?, ?, ?, ?)");
      accounts.forEach((row) => stmt.run(Object.values(row)));
      stmt.finalize();
    }

    if (pages.length > 0) {
      const stmt = db.prepare("INSERT INTO cached_pages VALUES (?, ?, ?, ?, ?)");
      pages.forEach((row) => stmt.run(Object.values(row)));
      stmt.finalize();
    }

    if (campaigns.length > 0) {
      const stmt = db.prepare("INSERT INTO cached_campaigns VALUES (?, ?, ?, ?, ?, ?)");
      campaigns.forEach((row) => stmt.run(Object.values(row)));
      stmt.finalize();
    }

    if (pixels.length > 0) {
      const stmt = db.prepare("INSERT INTO cached_pixels VALUES (?, ?, ?, ?, ?, ?)");
      pixels.forEach((row) => stmt.run(Object.values(row)));
      stmt.finalize();
    }

    console.log("Database migration completed successfully");
  } catch (error) {
    console.error("Error during database migration:", error);
    throw error;
  }
}

// Cache operations
export const FacebookCacheDB = {
  // Ad Accounts
  async saveAdAccounts(accounts) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO cached_ad_accounts (id, account_id, name, data, last_fetched, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    try {
      for (const account of accounts) {
        await new Promise((resolve, reject) => {
          stmt.run([account.id, account.account_id, account.name, JSON.stringify(account)], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (error) {
      throw error;
    } finally {
      stmt.finalize();
    }
  },

  async getAdAccounts(userId = null) {
    const query = userId ? "SELECT * FROM cached_ad_accounts WHERE user_id = ? ORDER BY name" : "SELECT * FROM cached_ad_accounts ORDER BY name";

    const rows = userId ? await db.allAsync(query, [userId]) : await db.allAsync(query);

    return rows.map((row) => ({
      ...JSON.parse(row.data),
      last_fetched: row.last_fetched,
    }));
  },

  // Pages
  async savePages(pages) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO cached_pages (id, name, data, last_fetched, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    try {
      for (const page of pages) {
        await new Promise((resolve, reject) => {
          stmt.run([page.id, page.name, JSON.stringify(page)], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (error) {
      throw error;
    } finally {
      stmt.finalize();
    }
  },

  async getPages(userId = null) {
    const query = userId ? "SELECT * FROM cached_pages WHERE user_id = ? ORDER BY name" : "SELECT * FROM cached_pages ORDER BY name";

    const rows = userId ? await db.allAsync(query, [userId]) : await db.allAsync(query);

    return rows.map((row) => ({
      ...JSON.parse(row.data),
      last_fetched: row.last_fetched,
    }));
  },

  // Campaigns
  async saveCampaigns(campaigns) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO cached_campaigns (id, account_id, name, data, last_fetched, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    try {
      for (const campaign of campaigns) {
        await new Promise((resolve, reject) => {
          stmt.run([campaign.id, campaign.account_id, campaign.name, JSON.stringify(campaign)], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (error) {
      throw error;
    } finally {
      stmt.finalize();
    }
  },

  async getCampaigns(userId = null) {
    const query = userId ? "SELECT * FROM cached_campaigns WHERE user_id = ? ORDER BY updated_at DESC" : "SELECT * FROM cached_campaigns ORDER BY updated_at DESC";

    const rows = userId ? await db.allAsync(query, [userId]) : await db.allAsync(query);

    return rows.map((row) => ({
      ...JSON.parse(row.data),
      last_fetched: row.last_fetched,
    }));
  },

  // Pixels
  async savePixels(pixels) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO cached_pixels (id, account_id, name, data, last_fetched, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    try {
      // Handle both individual pixels and account objects with adspixels
      for (const pixelData of pixels) {
        if (pixelData.adspixels) {
          // This is an account object with pixels
          const accountId = pixelData.account_id;
          for (const pixel of pixelData.adspixels.data) {
            await new Promise((resolve, reject) => {
              stmt.run([pixel.id, accountId, pixel.name, JSON.stringify({ ...pixel, account_id: accountId })], (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        } else if (pixelData.id) {
          // This is an individual pixel
          await new Promise((resolve, reject) => {
            stmt.run([pixelData.id, pixelData.account_id, pixelData.name, JSON.stringify(pixelData)], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      }
    } catch (error) {
      throw error;
    } finally {
      stmt.finalize();
    }
  },

  async getPixels(userId = null) {
    const query = userId ? "SELECT * FROM cached_pixels WHERE user_id = ? ORDER BY name" : "SELECT * FROM cached_pixels ORDER BY name";

    const rows = userId ? await db.allAsync(query, [userId]) : await db.allAsync(query);

    return rows.map((row) => ({
      ...JSON.parse(row.data),
      last_fetched: row.last_fetched,
    }));
  },

  // Get all cached data
  async getAllCachedData(userId = null) {
    const [adAccounts, pages, campaigns, pixels] = await Promise.all([this.getAdAccounts(userId), this.getPages(userId), this.getCampaigns(userId), this.getPixels(userId)]);

    // Group pixels by account to match the original API response format
    const pixelsByAccount = {};
    pixels.forEach((pixel) => {
      const accountId = pixel.account_id;
      if (!pixelsByAccount[accountId]) {
        pixelsByAccount[accountId] = {
          account_id: accountId,
          adspixels: { data: [] },
        };
      }
      pixelsByAccount[accountId].adspixels.data.push(pixel);
    });

    return {
      adAccounts,
      pages,
      campaigns,
      pixels: Object.values(pixelsByAccount),
    };
  },

  // Check if cache exists and is recent
  async isCacheValid(maxAgeMinutes = 60, userId = null) {
    const query = userId
      ? `SELECT COUNT(*) as count, 
               MIN(last_fetched) as oldest_fetch,
               (julianday('now') - julianday(MIN(last_fetched))) * 24 * 60 as age_minutes
         FROM cached_ad_accounts
         WHERE user_id = ?`
      : `SELECT COUNT(*) as count, 
               MIN(last_fetched) as oldest_fetch,
               (julianday('now') - julianday(MIN(last_fetched))) * 24 * 60 as age_minutes
         FROM cached_ad_accounts`;

    const result = userId ? await db.getAsync(query, [userId]) : await db.getAsync(query);

    return result.count > 0 && result.age_minutes < maxAgeMinutes;
  },

  // Clear all cache for a user or all
  async clearCache(userId = null) {
    if (userId) {
      await db.runAsync("DELETE FROM cached_ad_accounts WHERE user_id = ?", [userId]);
      await db.runAsync("DELETE FROM cached_pages WHERE user_id = ?", [userId]);
      await db.runAsync("DELETE FROM cached_campaigns WHERE user_id = ?", [userId]);
      await db.runAsync("DELETE FROM cached_pixels WHERE user_id = ?", [userId]);
    } else {
      await db.runAsync("DELETE FROM cached_ad_accounts");
      await db.runAsync("DELETE FROM cached_pages");
      await db.runAsync("DELETE FROM cached_campaigns");
      await db.runAsync("DELETE FROM cached_pixels");
      await db.runAsync("DELETE FROM cache_metadata");
    }
  },

  // Save all data in a single transaction (replacing old data)
  async saveAllData(adAccounts, pages, campaigns, pixels, userId) {
    try {
      // Use async/await pattern for better control
      await db.runAsync("BEGIN TRANSACTION");

      // Clear existing data for this user only to prevent stale records
      // console.log(`Clearing existing cache data for user ${userId}...`);
      await db.runAsync("DELETE FROM cached_pixels WHERE user_id = ?", [userId]);
      await db.runAsync("DELETE FROM cached_campaigns WHERE user_id = ?", [userId]);
      await db.runAsync("DELETE FROM cached_pages WHERE user_id = ?", [userId]);
      await db.runAsync("DELETE FROM cached_ad_accounts WHERE user_id = ?", [userId]);

      // Save ad accounts
      if (adAccounts && adAccounts.length > 0) {
        const adAccountStmt = db.prepare(`
          INSERT INTO cached_ad_accounts (id, user_id, account_id, name, data, last_fetched, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);

        for (const account of adAccounts) {
          await new Promise((resolve, reject) => {
            adAccountStmt.run([account.id, userId, account.account_id, account.name, JSON.stringify(account)], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
        adAccountStmt.finalize();
      }

      // Save pages
      if (pages && pages.length > 0) {
        const pageStmt = db.prepare(`
          INSERT INTO cached_pages (id, user_id, name, data, last_fetched, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);

        for (const page of pages) {
          await new Promise((resolve, reject) => {
            pageStmt.run([page.id, userId, page.name, JSON.stringify(page)], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
        pageStmt.finalize();
      }

      // Save campaigns
      if (campaigns && campaigns.length > 0) {
        const campaignStmt = db.prepare(`
          INSERT INTO cached_campaigns (id, user_id, account_id, name, data, last_fetched, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);

        for (const campaign of campaigns) {
          await new Promise((resolve, reject) => {
            campaignStmt.run([campaign.id, userId, campaign.account_id, campaign.name, JSON.stringify(campaign)], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
        campaignStmt.finalize();
      }

      // Save pixels (handling duplicates - pixels can be shared across accounts)
      if (pixels && pixels.length > 0) {
        const pixelStmt = db.prepare(`
          INSERT OR REPLACE INTO cached_pixels (id, user_id, account_id, name, data, last_fetched, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);

        // Track processed pixels to avoid duplicates
        const processedPixels = new Set();

        for (const pixelData of pixels) {
          if (pixelData.adspixels && pixelData.adspixels.data) {
            const accountId = pixelData.account_id;
            for (const pixel of pixelData.adspixels.data) {
              const pixelKey = `${pixel.id}_${accountId}_${userId}`;
              if (!processedPixels.has(pixelKey)) {
                processedPixels.add(pixelKey);
                await new Promise((resolve, reject) => {
                  pixelStmt.run([pixel.id, userId, accountId, pixel.name, JSON.stringify({ ...pixel, account_id: accountId })], (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                });
              }
            }
          } else if (pixelData.id && pixelData.account_id) {
            const pixelKey = `${pixelData.id}_${pixelData.account_id}_${userId}`;
            if (!processedPixels.has(pixelKey)) {
              processedPixels.add(pixelKey);
              await new Promise((resolve, reject) => {
                pixelStmt.run([pixelData.id, userId, pixelData.account_id, pixelData.name, JSON.stringify(pixelData)], (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            }
          }
        }
        pixelStmt.finalize();
      }

      await db.runAsync("COMMIT");
      console.log(`Cache data saved successfully for user ${userId}`);
    } catch (error) {
      console.error("Error saving cache data:", error);
      await db.runAsync("ROLLBACK");
      throw error;
    }
  },

  // Update metadata
  async updateMetadata(key, value) {
    await db.runAsync("INSERT OR REPLACE INTO cache_metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", [key, value]);
  },

  async getMetadata(key) {
    const result = await db.getAsync("SELECT value FROM cache_metadata WHERE key = ?", key);
    return result ? result.value : null;
  },

  // Add an ad set to a campaign in the cache
  async addAdSetToCampaign(campaignId, newAdSet) {
    try {
      // Get the current campaign data
      const result = await db.getAsync("SELECT data FROM cached_campaigns WHERE id = ?", campaignId);

      if (!result) {
        console.log(`Campaign ${campaignId} not found in cache`);
        return false;
      }

      const campaign = JSON.parse(result.data);

      // Initialize adsets if it doesn't exist
      if (!campaign.adsets) {
        campaign.adsets = { data: [] };
      }

      // Add the new ad set
      campaign.adsets.data.push(newAdSet);

      // Update the campaign in the database
      await db.runAsync("UPDATE cached_campaigns SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [JSON.stringify(campaign), campaignId]);

      console.log(`Added ad set ${newAdSet.id} to campaign ${campaignId} in cache`);
      return true;
    } catch (error) {
      console.error("Error adding ad set to campaign cache:", error);
      return false;
    }
  },
};

// Initialize database on module load
initializeDatabase();

export default db;
