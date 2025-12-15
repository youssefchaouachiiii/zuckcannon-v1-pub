import sqlite3 from 'sqlite3'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDbPath } from './paths.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Database configuration with error handling
const dbPath = getDbPath('creative-library.db')
let db = null

// Initialize database with retry logic
function initializeDb() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) {
        console.error('Database connection error:', err)
        reject(err)
      } else {
        // console.log('Connected to creative library database')
        
        // Promisify database methods for easier async/await usage
        db.runAsync = promisify(db.run.bind(db))
        db.getAsync = promisify(db.get.bind(db))
        db.allAsync = promisify(db.all.bind(db))
        
        resolve(db)
      }
    })
  })
}

// Database connection with retry
async function connectWithRetry(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await initializeDb()
      return
    } catch (err) {
      console.error(`Database connection attempt ${i + 1} failed:`, err)
      if (i === retries - 1) throw err
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
    }
  }
}

// Initialize database schema
async function initializeDatabase() {
  try {
    // Enable foreign keys
    await db.runAsync('PRAGMA foreign_keys = ON')

    // Create creative batches table
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS creative_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Check if creatives table exists and if batch_id column exists
    const tableInfo = await db.allAsync("PRAGMA table_info(creatives)")
    const hasBatchIdColumn = tableInfo.some(col => col.name === 'batch_id')
    
    if (tableInfo.length > 0 && !hasBatchIdColumn) {
      // Table exists but doesn't have batch_id column - add it
      console.log('Migrating creatives table to add batch_id column...')
      await db.runAsync('ALTER TABLE creatives ADD COLUMN batch_id INTEGER REFERENCES creative_batches(id) ON DELETE SET NULL')
      console.log('Migration completed successfully')
    } else if (tableInfo.length === 0) {
      // Table doesn't exist - create it with batch_id
      await db.runAsync(`
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
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (batch_id) REFERENCES creative_batches(id) ON DELETE SET NULL
        )
      `)
    }

    // Create creative_accounts table for tracking uploads to different ad accounts
    await db.runAsync(`
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
    `)

    // Create indexes for better performance
    await db.runAsync('CREATE INDEX IF NOT EXISTS idx_file_hash ON creatives(file_hash)')
    await db.runAsync('CREATE INDEX IF NOT EXISTS idx_batch_id ON creatives(batch_id)')
    await db.runAsync('CREATE INDEX IF NOT EXISTS idx_creative_accounts ON creative_accounts(creative_id, ad_account_id)')
    await db.runAsync('CREATE INDEX IF NOT EXISTS idx_ad_account ON creative_accounts(ad_account_id)')

    // console.log('Database initialized successfully')
  } catch (error) {
    console.error('Error initializing database:', error)
    throw error
  }
}

// ============================================
// Database Operation Wrapper
// ============================================

// Async wrapper for db.run() operations
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err)
      else resolve({ id: this.lastID, changes: this.changes })
    })
  })
}

// Main wrapper for all database operations with error handling
async function dbOperation(operation, errorContext) {
  try {
    await ensureDb()
    return await operation()
  } catch (err) {
    console.error(`${errorContext}:`, err)
    throw new Error(`${errorContext}: ${err.message}`)
  }
}

// ============================================
// Creative Database Operations
// ============================================

export const CreativeDB = {
  async findByHash(fileHash) {
    return dbOperation(
      () => db.getAsync('SELECT * FROM creatives WHERE file_hash = ?', fileHash),
      'Error finding creative by hash'
    )
  },

  async create(creativeData) {
    const { fileHash, fileName, originalName, filePath, fileType, fileSize, thumbnailPath, batchId } = creativeData
    return dbOperation(
      () => dbRun(
        `INSERT INTO creatives (file_hash, file_name, original_name, file_path, file_type, file_size, thumbnail_path, batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [fileHash, fileName, originalName, filePath, fileType, fileSize, thumbnailPath, batchId || null]
      ),
      'Error creating creative'
    )
  },

  async getAll(limit = 100, offset = 0) {
    return dbOperation(
      () => db.allAsync(
        `SELECT c.*, 
                COUNT(DISTINCT ca.ad_account_id) as account_count,
                GROUP_CONCAT(DISTINCT ca.ad_account_id) as uploaded_accounts
         FROM creatives c
         LEFT JOIN creative_accounts ca ON c.id = ca.creative_id
         GROUP BY c.id
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
      'Error fetching creatives'
    )
  },

  async getById(id) {
    return dbOperation(
      async () => {
        const creative = await db.getAsync('SELECT * FROM creatives WHERE id = ?', id)
        if (!creative) return null
        const accounts = await db.allAsync('SELECT * FROM creative_accounts WHERE creative_id = ?', id)
        return { ...creative, accounts }
      },
      'Error fetching creative by ID'
    )
  },

  async search(query) {
    return dbOperation(
      () => db.allAsync(
        `SELECT c.*, 
                COUNT(DISTINCT ca.ad_account_id) as account_count,
                GROUP_CONCAT(DISTINCT ca.ad_account_id) as uploaded_accounts
         FROM creatives c
         LEFT JOIN creative_accounts ca ON c.id = ca.creative_id
         WHERE c.original_name LIKE ? OR c.file_name LIKE ?
         GROUP BY c.id
         ORDER BY c.created_at DESC`,
        [`%${query}%`, `%${query}%`]
      ),
      'Error searching creatives'
    )
  },

  async delete(id) {
    return dbOperation(
      () => dbRun('DELETE FROM creatives WHERE id = ?', [id]),
      'Error deleting creative'
    )
  },

  async deleteAll() {
    return dbOperation(
      () => dbRun('DELETE FROM creatives'),
      'Error deleting all creatives'
    )
  },

  async updateBatch(creativeId, batchId) {
    return dbOperation(
      () => dbRun(
        'UPDATE creatives SET batch_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [batchId, creativeId]
      ),
      'Error updating creative batch'
    )
  },

  async updateBatchBulk(creativeIds, batchId) {
    const placeholders = creativeIds.map(() => '?').join(',')
    return dbOperation(
      () => dbRun(
        `UPDATE creatives SET batch_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
        [batchId, ...creativeIds]
      ),
      'Error bulk updating creatives batch'
    )
  }
}

// ============================================
// Creative-Account Relationship Operations
// ============================================

export const CreativeAccountDB = {
  async recordUpload(creativeId, adAccountId, facebookIds) {
    const { creativeId: fbCreativeId, videoId, imageHash } = facebookIds
    return dbOperation(
      () => dbRun(
        `INSERT OR REPLACE INTO creative_accounts 
         (creative_id, ad_account_id, facebook_creative_id, facebook_video_id, facebook_image_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [creativeId, adAccountId, fbCreativeId, videoId, imageHash]
      ),
      'Error recording upload'
    )
  },

  async isUploadedToAccount(creativeId, adAccountId) {
    return dbOperation(
      async () => {
        const result = await db.getAsync(
          'SELECT * FROM creative_accounts WHERE creative_id = ? AND ad_account_id = ?',
          [creativeId, adAccountId]
        )
        return !!result
      },
      'Error checking upload status'
    )
  },

  async getFacebookIds(creativeId, adAccountId) {
    return dbOperation(
      () => db.getAsync(
        'SELECT facebook_creative_id, facebook_video_id, facebook_image_hash FROM creative_accounts WHERE creative_id = ? AND ad_account_id = ?',
        [creativeId, adAccountId]
      ),
      'Error fetching Facebook IDs'
    )
  },

  async getUploadedAccounts(creativeId) {
    return dbOperation(
      () => db.allAsync(
        'SELECT * FROM creative_accounts WHERE creative_id = ?',
        creativeId
      ),
      'Error fetching uploaded accounts'
    )
  }
}

// ============================================
// Batch Database Operations
// ============================================

export const BatchDB = {
  async create(name, description = null) {
    return dbOperation(
      () => dbRun(
        'INSERT INTO creative_batches (name, description) VALUES (?, ?)',
        [name, description]
      ),
      'Error creating batch'
    )
  },

  async getAll() {
    return dbOperation(
      () => db.allAsync(`
        SELECT 
          cb.*,
          COUNT(c.id) as creative_count,
          SUM(CASE WHEN c.file_type LIKE 'video/%' THEN 1 ELSE 0 END) as video_count,
          SUM(CASE WHEN c.file_type LIKE 'image/%' THEN 1 ELSE 0 END) as image_count
        FROM creative_batches cb
        LEFT JOIN creatives c ON cb.id = c.batch_id
        GROUP BY cb.id
        ORDER BY cb.created_at DESC
      `),
      'Error fetching batches'
    )
  },

  async getById(id) {
    return dbOperation(
      () => db.getAsync('SELECT * FROM creative_batches WHERE id = ?', id),
      'Error fetching batch by ID'
    )
  },

  async update(id, name, description) {
    return dbOperation(
      () => dbRun(
        'UPDATE creative_batches SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name, description, id]
      ),
      'Error updating batch'
    )
  },

  async delete(id) {
    return dbOperation(
      () => dbRun('DELETE FROM creative_batches WHERE id = ?', [id]),
      'Error deleting batch'
    )
  },

  async getCreatives(batchId) {
    return dbOperation(
      () => db.allAsync(
        `SELECT c.*, 
                COUNT(DISTINCT ca.ad_account_id) as account_count,
                GROUP_CONCAT(DISTINCT ca.ad_account_id) as uploaded_accounts
         FROM creatives c
         LEFT JOIN creative_accounts ca ON c.id = ca.creative_id
         WHERE c.batch_id = ?
         GROUP BY c.id
         ORDER BY c.created_at DESC`,
        batchId
      ),
      'Error fetching batch creatives'
    )
  }
}

// Wrapper to ensure database is connected before operations
async function ensureDb() {
  if (!db) {
    await connectWithRetry()
    await initializeDatabase()
  }
  return db
}

// Initialize database on module load
connectWithRetry()
  .then(() => initializeDatabase())
  .catch(err => {
    console.error('Failed to initialize database:', err)
    process.exit(1)
  })

export default db