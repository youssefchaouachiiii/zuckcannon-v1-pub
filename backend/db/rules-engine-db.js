// backend/db/rules-engine-db.js
import sqlite3 from 'sqlite3';
import { getDbPath } from '../utils/paths.js';

const db = new sqlite3.Database(getDbPath('rules-engine.db'));

db.runAsync = (sql, params = []) =>
  new Promise((res, rej) =>
    db.run(sql, params, function (err) {
      err ? rej(err) : res({ lastID: this.lastID, changes: this.changes });
    })
  );
db.getAsync = (sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (err, row) => (err ? rej(err) : res(row))));
db.allAsync = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows))));

async function initializeDatabase() {
  await db.runAsync('PRAGMA foreign_keys = ON');
  await db.runAsync('PRAGMA journal_mode = WAL');

  await db.runAsync(`CREATE TABLE IF NOT EXISTS verticals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    default_schedule_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('campaign','adset','ad','account')),
    conditions_json TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('pause','enable','scale_budget')),
    action_params_json TEXT,
    cooldown_hours INTEGER DEFAULT 4,
    is_active INTEGER DEFAULT 1,
    is_dry_run INTEGER DEFAULT 0,
    combinator TEXT DEFAULT 'AND',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.runAsync(`ALTER TABLE rules ADD COLUMN combinator TEXT DEFAULT 'AND'`).catch(() => {});

  await db.runAsync(`CREATE TABLE IF NOT EXISTS rule_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('campaign','adset','ad','vertical','tag','account')),
    entity_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rule_id, entity_type, entity_id)
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS campaign_labels (
    campaign_id TEXT NOT NULL,
    label_type TEXT NOT NULL CHECK(label_type IN ('vertical','tag')),
    label_value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (campaign_id, label_type, label_value)
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    days_json TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS schedule_assignments (
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL,
    PRIMARY KEY (schedule_id, campaign_id)
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS rule_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER REFERENCES rules(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_name TEXT,
    action_taken TEXT NOT NULL,
    trigger_data_json TEXT,
    is_dry_run INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS rule_exemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    entity_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('snooze','cooldown')),
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rule_id, entity_id)
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS spend_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    spend REAL NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS pause_pending (
    rule_id INTEGER NOT NULL,
    entity_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_id, entity_id)
  )`);
}

await initializeDatabase();

export const RulesEngineDB = {
  // --- Rules ---
  async createRule(data) {
    const { lastID } = await db.runAsync(
      `INSERT INTO rules (name, scope, conditions_json, action, action_params_json, cooldown_hours, is_active, is_dry_run, combinator)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.scope, data.conditions_json, data.action, data.action_params_json,
       data.cooldown_hours, data.is_active, data.is_dry_run, data.combinator || 'AND']
    );
    return this.getRuleById(lastID);
  },
  async getRuleById(id) {
    return (await db.getAsync('SELECT * FROM rules WHERE id = ?', [id])) || null;
  },
  async listActiveRules() {
    return db.allAsync('SELECT * FROM rules WHERE is_active = 1');
  },
  async listAllRules() {
    return db.allAsync('SELECT * FROM rules ORDER BY created_at DESC');
  },
  async updateRule(id, data) {
    await db.runAsync(
      `UPDATE rules SET name=?, scope=?, conditions_json=?, action=?, action_params_json=?,
       cooldown_hours=?, is_active=?, is_dry_run=?, combinator=? WHERE id=?`,
      [data.name, data.scope, data.conditions_json, data.action, data.action_params_json,
       data.cooldown_hours, data.is_active, data.is_dry_run, data.combinator || 'AND', id]
    );
    return this.getRuleById(id);
  },
  async deleteRule(id) {
    return db.runAsync('DELETE FROM rules WHERE id = ?', [id]);
  },

  // --- Tags ---
  async getAllTags() {
    return db.allAsync(`SELECT campaign_id, label_value as tag FROM campaign_labels WHERE label_type='tag' ORDER BY created_at DESC`);
  },
  async addTag(campaignId, tag) {
    return db.runAsync(
      `INSERT OR IGNORE INTO campaign_labels (campaign_id, label_type, label_value) VALUES (?, 'tag', ?)`,
      [campaignId, tag]
    );
  },
  async removeTag(campaignId, tag) {
    return db.runAsync(
      `DELETE FROM campaign_labels WHERE campaign_id=? AND label_type='tag' AND label_value=?`,
      [campaignId, tag]
    );
  },

  // --- Assignments ---
  async addAssignment(ruleId, entityType, entityId) {
    return db.runAsync(
      `INSERT OR IGNORE INTO rule_assignments (rule_id, entity_type, entity_id) VALUES (?, ?, ?)`,
      [ruleId, entityType, entityId]
    );
  },
  async removeAssignment(ruleId, entityType, entityId) {
    return db.runAsync(
      `DELETE FROM rule_assignments WHERE rule_id=? AND entity_type=? AND entity_id=?`,
      [ruleId, entityType, entityId]
    );
  },
  async getAssignmentsForRule(ruleId) {
    return db.allAsync('SELECT * FROM rule_assignments WHERE rule_id = ?', [ruleId]);
  },

  // --- Campaign labels ---
  async setCampaignLabels(campaignId, labels) {
    await db.runAsync('DELETE FROM campaign_labels WHERE campaign_id = ?', [campaignId]);
    for (const l of labels) {
      await db.runAsync(
        `INSERT OR IGNORE INTO campaign_labels (campaign_id, label_type, label_value) VALUES (?, ?, ?)`,
        [campaignId, l.label_type, l.label_value]
      );
    }
  },
  async getCampaignsByLabel(labelType, labelValue) {
    return db.allAsync(
      'SELECT campaign_id FROM campaign_labels WHERE label_type=? AND label_value=?',
      [labelType, labelValue]
    );
  },
  async bulkSetLabelByPattern(pattern, labelType, labelValue, campaignList) {
    const regex = new RegExp(pattern, 'i');
    const matching = campaignList.filter(c => regex.test(c.name));
    for (const c of matching) {
      await db.runAsync(
        `INSERT OR IGNORE INTO campaign_labels (campaign_id, label_type, label_value) VALUES (?, ?, ?)`,
        [c.id, labelType, labelValue]
      );
    }
    return matching.length;
  },

  // --- Schedules ---
  async createSchedule(data) {
    const { lastID } = await db.runAsync(
      `INSERT INTO schedules (name, days_json, start_time, end_time, timezone, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.name, data.days_json, data.start_time, data.end_time, data.timezone, data.is_active ?? 1]
    );
    return db.getAsync('SELECT * FROM schedules WHERE id = ?', [lastID]);
  },
  async listActiveSchedules() {
    return db.allAsync('SELECT * FROM schedules WHERE is_active = 1');
  },
  async listAllSchedules() {
    return db.allAsync('SELECT * FROM schedules ORDER BY name ASC');
  },
  async updateSchedule(id, data) {
    await db.runAsync(
      `UPDATE schedules SET name=?, days_json=?, start_time=?, end_time=?, timezone=?, is_active=? WHERE id=?`,
      [data.name, data.days_json, data.start_time, data.end_time, data.timezone, data.is_active, id]
    );
    return db.getAsync('SELECT * FROM schedules WHERE id = ?', [id]);
  },
  async deleteSchedule(id) {
    return db.runAsync('DELETE FROM schedules WHERE id = ?', [id]);
  },
  async addScheduleAssignment(scheduleId, campaignId) {
    return db.runAsync(
      'INSERT OR IGNORE INTO schedule_assignments (schedule_id, campaign_id) VALUES (?, ?)',
      [scheduleId, campaignId]
    );
  },
  async removeScheduleAssignment(scheduleId, campaignId) {
    return db.runAsync(
      'DELETE FROM schedule_assignments WHERE schedule_id=? AND campaign_id=?',
      [scheduleId, campaignId]
    );
  },
  async getCampaignsForSchedule(scheduleId) {
    return db.allAsync('SELECT campaign_id FROM schedule_assignments WHERE schedule_id = ?', [scheduleId]);
  },

  // --- Verticals ---
  async createVertical(name, defaultScheduleId = null) {
    const { lastID } = await db.runAsync(
      'INSERT INTO verticals (name, default_schedule_id) VALUES (?, ?)',
      [name, defaultScheduleId]
    );
    return db.getAsync('SELECT * FROM verticals WHERE id = ?', [lastID]);
  },
  async upsertVertical(name) {
    return db.runAsync(
      'INSERT OR IGNORE INTO verticals (name) VALUES (?)',
      [name]
    );
  },
  async getVerticalById(id) {
    return db.getAsync('SELECT * FROM verticals WHERE id = ?', [id]);
  },
  async listVerticals() {
    return db.allAsync('SELECT * FROM verticals ORDER BY name ASC');
  },
  async getCampaignsByVertical(verticalName) {
    return db.allAsync(
      `SELECT campaign_id FROM campaign_labels WHERE label_type='vertical' AND label_value=?`,
      [verticalName]
    );
  },
  async clearCampaignsByVertical(verticalName) {
    return db.runAsync(
      `DELETE FROM campaign_labels WHERE label_type='vertical' AND label_value=?`,
      [verticalName]
    );
  },
  async deleteVertical(id) {
    return db.runAsync('DELETE FROM verticals WHERE id = ?', [id]);
  },

  // --- Logs ---
  async addLog(data) {
    return db.runAsync(
      `INSERT INTO rule_logs (rule_id, entity_type, entity_id, entity_name, action_taken, trigger_data_json, is_dry_run)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.rule_id, data.entity_type, data.entity_id, data.entity_name,
       data.action_taken, data.trigger_data_json, data.is_dry_run ?? 0]
    );
  },
  async getLogs({ date_from, date_to, rule_id, limit = 500 } = {}) {
    let sql = 'SELECT * FROM rule_logs WHERE 1=1';
    const params = [];
    if (date_from) { sql += ' AND DATE(created_at) >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND DATE(created_at) <= ?'; params.push(date_to); }
    if (rule_id) { sql += ' AND rule_id = ?'; params.push(rule_id); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return db.allAsync(sql, params);
  },

  // --- Exemptions ---
  async setExemption(ruleId, entityId, type, expiresAt) {
    return db.runAsync(
      `INSERT INTO rule_exemptions (rule_id, entity_id, type, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(rule_id, entity_id) DO UPDATE SET type=excluded.type, expires_at=excluded.expires_at`,
      [ruleId, entityId, type, expiresAt]
    );
  },
  async isExempt(ruleId, entityId) {
    const row = await db.getAsync(
      'SELECT id FROM rule_exemptions WHERE rule_id=? AND entity_id=? AND datetime(expires_at) > datetime(CURRENT_TIMESTAMP)',
      [ruleId, entityId]
    );
    return !!row;
  },
  async clearExemption(ruleId, entityId) {
    return db.runAsync(
      'DELETE FROM rule_exemptions WHERE rule_id=? AND entity_id=?',
      [ruleId, entityId]
    );
  },

  async listAllAssignedCampaignIds() {
    const rows = await db.allAsync(
      `SELECT DISTINCT entity_id FROM rule_assignments WHERE entity_type = 'campaign'`
    );
    return new Set(rows.map(r => r.entity_id));
  },

  async listAllScheduledCampaignIds() {
    const rows = await db.allAsync('SELECT DISTINCT campaign_id FROM schedule_assignments');
    return new Set(rows.map(r => r.campaign_id));
  },

  // --- Spend Snapshots ---
  async saveSpendSnapshot(entityId, entityType, spend) {
    return db.runAsync(
      `INSERT INTO spend_snapshots (entity_id, entity_type, spend) VALUES (?, ?, ?)`,
      [entityId, entityType, spend]
    );
  },
  async getSpendSnapshots(entityId, minutes = 30) {
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    return db.allAsync(
      `SELECT * FROM spend_snapshots WHERE entity_id=? AND recorded_at >= ? ORDER BY recorded_at ASC`,
      [entityId, since]
    );
  },
  async pruneSpendSnapshots(daysOld = 7) {
    const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
    return db.runAsync(`DELETE FROM spend_snapshots WHERE recorded_at < ?`, [cutoff]);
  },

  // --- Pause Pending ---
  async setPausePending(ruleId, entityId) {
    return db.runAsync(
      `INSERT OR REPLACE INTO pause_pending (rule_id, entity_id) VALUES (?, ?)`,
      [ruleId, entityId]
    );
  },
  async isPausePending(ruleId, entityId) {
    const row = await db.getAsync(
      `SELECT 1 FROM pause_pending WHERE rule_id=? AND entity_id=?`,
      [ruleId, entityId]
    );
    return !!row;
  },
  async clearPausePending(ruleId, entityId) {
    return db.runAsync(
      `DELETE FROM pause_pending WHERE rule_id=? AND entity_id=?`,
      [ruleId, entityId]
    );
  },
};

export default RulesEngineDB;
