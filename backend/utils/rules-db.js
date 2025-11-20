import Database from "better-sqlite3";
import { getPaths } from "./paths.js";

const paths = getPaths();
const dbPath = `${paths.db}/automated-rules.db`;

// Initialize database with better-sqlite3
const db = new Database(dbPath);

// Enable foreign keys
db.pragma("foreign_keys = ON");

// Initialize database schema
function initializeDatabase() {
  // Automated rules table
  db.exec(`
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

  // Rule execution history table
  db.exec(`
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

  // Rule action history table (detailed history per entity)
  db.exec(`
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

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rules_user_account
    ON automated_rules(user_id, ad_account_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rules_status
    ON automated_rules(status);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_executions_rule
    ON rule_executions(rule_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_rule
    ON rule_history(rule_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_entity
    ON rule_history(entity_id);
  `);
}

// Initialize database on module load
initializeDatabase();

// Rules CRUD operations
export const RulesDB = {
  /**
   * Create a new automated rule
   */
  createRule: (ruleData) => {
    const stmt = db.prepare(`
      INSERT INTO automated_rules (
        user_id, ad_account_id, meta_rule_id, name, entity_type, entity_ids,
        rule_type, evaluation_spec, execution_spec, schedule_spec, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      ruleData.user_id,
      ruleData.ad_account_id,
      ruleData.meta_rule_id || null,
      ruleData.name,
      ruleData.entity_type,
      ruleData.entity_ids ? JSON.stringify(ruleData.entity_ids) : null,
      ruleData.rule_type,
      JSON.stringify(ruleData.evaluation_spec),
      JSON.stringify(ruleData.execution_spec),
      ruleData.schedule_spec ? JSON.stringify(ruleData.schedule_spec) : null,
      ruleData.status || "ACTIVE"
    );

    return {
      id: info.lastInsertRowid,
      ...ruleData,
    };
  },

  /**
   * Get all rules for a user and account
   */
  getRules: (userId, adAccountId = null) => {
    let stmt;
    let params;

    if (adAccountId) {
      stmt = db.prepare(`
        SELECT * FROM automated_rules
        WHERE user_id = ? AND ad_account_id = ?
        ORDER BY created_at DESC
      `);
      params = [userId, adAccountId];
    } else {
      stmt = db.prepare(`
        SELECT * FROM automated_rules
        WHERE user_id = ?
        ORDER BY created_at DESC
      `);
      params = [userId];
    }

    const rules = stmt.all(...params);

    // Parse JSON fields
    return rules.map((rule) => ({
      ...rule,
      entity_ids: rule.entity_ids ? JSON.parse(rule.entity_ids) : null,
      evaluation_spec: JSON.parse(rule.evaluation_spec),
      execution_spec: JSON.parse(rule.execution_spec),
      schedule_spec: rule.schedule_spec ? JSON.parse(rule.schedule_spec) : null,
    }));
  },

  /**
   * Get a single rule by ID
   */
  getRuleById: (ruleId, userId) => {
    const stmt = db.prepare(`
      SELECT * FROM automated_rules
      WHERE id = ? AND user_id = ?
    `);

    const rule = stmt.get(ruleId, userId);

    if (!rule) return null;

    return {
      ...rule,
      entity_ids: rule.entity_ids ? JSON.parse(rule.entity_ids) : null,
      evaluation_spec: JSON.parse(rule.evaluation_spec),
      execution_spec: JSON.parse(rule.execution_spec),
      schedule_spec: rule.schedule_spec ? JSON.parse(rule.schedule_spec) : null,
    };
  },

  /**
   * Update an existing rule
   */
  updateRule: (ruleId, userId, updateData) => {
    const fields = [];
    const values = [];

    // Build dynamic update query
    if (updateData.name !== undefined) {
      fields.push("name = ?");
      values.push(updateData.name);
    }
    if (updateData.entity_type !== undefined) {
      fields.push("entity_type = ?");
      values.push(updateData.entity_type);
    }
    if (updateData.entity_ids !== undefined) {
      fields.push("entity_ids = ?");
      values.push(JSON.stringify(updateData.entity_ids));
    }
    if (updateData.rule_type !== undefined) {
      fields.push("rule_type = ?");
      values.push(updateData.rule_type);
    }
    if (updateData.evaluation_spec !== undefined) {
      fields.push("evaluation_spec = ?");
      values.push(JSON.stringify(updateData.evaluation_spec));
    }
    if (updateData.execution_spec !== undefined) {
      fields.push("execution_spec = ?");
      values.push(JSON.stringify(updateData.execution_spec));
    }
    if (updateData.schedule_spec !== undefined) {
      fields.push("schedule_spec = ?");
      values.push(updateData.schedule_spec ? JSON.stringify(updateData.schedule_spec) : null);
    }
    if (updateData.status !== undefined) {
      fields.push("status = ?");
      values.push(updateData.status);
    }
    if (updateData.meta_rule_id !== undefined) {
      fields.push("meta_rule_id = ?");
      values.push(updateData.meta_rule_id);
    }

    // Always update updated_at
    fields.push("updated_at = CURRENT_TIMESTAMP");

    if (fields.length === 1) {
      // Only updated_at field, nothing to update
      return RulesDB.getRuleById(ruleId, userId);
    }

    values.push(ruleId, userId);

    const stmt = db.prepare(`
      UPDATE automated_rules
      SET ${fields.join(", ")}
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(...values);

    return RulesDB.getRuleById(ruleId, userId);
  },

  /**
   * Delete a rule
   */
  deleteRule: (ruleId, userId) => {
    const stmt = db.prepare(`
      DELETE FROM automated_rules
      WHERE id = ? AND user_id = ?
    `);

    const info = stmt.run(ruleId, userId);

    return info.changes > 0;
  },

  /**
   * Record a rule execution
   */
  recordExecution: (executionData) => {
    const stmt = db.prepare(`
      INSERT INTO rule_executions (
        rule_id, execution_time, entities_affected, actions_taken,
        status, result_data, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      executionData.rule_id,
      executionData.execution_time || new Date().toISOString(),
      executionData.entities_affected || 0,
      executionData.actions_taken || 0,
      executionData.status,
      executionData.result_data ? JSON.stringify(executionData.result_data) : null,
      executionData.error_message || null
    );

    return {
      id: info.lastInsertRowid,
      ...executionData,
    };
  },

  /**
   * Get execution history for a rule
   */
  getExecutionHistory: (ruleId, userId, limit = 50) => {
    const stmt = db.prepare(`
      SELECT e.*
      FROM rule_executions e
      JOIN automated_rules r ON e.rule_id = r.id
      WHERE e.rule_id = ? AND r.user_id = ?
      ORDER BY e.execution_time DESC
      LIMIT ?
    `);

    const executions = stmt.all(ruleId, userId, limit);

    return executions.map((exec) => ({
      ...exec,
      result_data: exec.result_data ? JSON.parse(exec.result_data) : null,
    }));
  },

  /**
   * Record detailed action history per entity
   */
  recordActionHistory: (historyData) => {
    const stmt = db.prepare(`
      INSERT INTO rule_history (
        rule_id, entity_id, entity_type, action_taken, result
      ) VALUES (?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      historyData.rule_id,
      historyData.entity_id,
      historyData.entity_type,
      historyData.action_taken,
      historyData.result
    );

    return {
      id: info.lastInsertRowid,
      ...historyData,
    };
  },

  /**
   * Get action history for a rule
   */
  getActionHistory: (ruleId, userId, limit = 100) => {
    const stmt = db.prepare(`
      SELECT h.*
      FROM rule_history h
      JOIN automated_rules r ON h.rule_id = r.id
      WHERE h.rule_id = ? AND r.user_id = ?
      ORDER BY h.executed_at DESC
      LIMIT ?
    `);

    return stmt.all(ruleId, userId, limit);
  },

  /**
   * Get all active rules that need to be executed (for scheduler)
   */
  getActiveRules: () => {
    const stmt = db.prepare(`
      SELECT * FROM automated_rules
      WHERE status = 'ACTIVE'
      ORDER BY created_at DESC
    `);

    const rules = stmt.all();

    return rules.map((rule) => ({
      ...rule,
      entity_ids: rule.entity_ids ? JSON.parse(rule.entity_ids) : null,
      evaluation_spec: JSON.parse(rule.evaluation_spec),
      execution_spec: JSON.parse(rule.execution_spec),
      schedule_spec: rule.schedule_spec ? JSON.parse(rule.schedule_spec) : null,
    }));
  },

  /**
   * Batch record action history
   */
  batchRecordActionHistory: (historyRecords) => {
    const stmt = db.prepare(`
      INSERT INTO rule_history (
        rule_id, entity_id, entity_type, action_taken, result
      ) VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((records) => {
      for (const record of records) {
        stmt.run(record.rule_id, record.entity_id, record.entity_type, record.action_taken, record.result);
      }
    });

    transaction(historyRecords);
  },
};

export default RulesDB;
