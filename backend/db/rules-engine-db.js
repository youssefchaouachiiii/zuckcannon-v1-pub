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
  await db.runAsync(`ALTER TABLE verticals ADD COLUMN keyword TEXT`).catch(() => {});
  // tracks_lpv: 1 = vertical uses an FB-pixeled landing page so lp_views is
  // meaningful; 0 = redirect-link offer where lp_views is structurally
  // under-counted (e.g. EDU). Rules using lp_views / lp_conv_rate skip
  // entities whose vertical has tracks_lpv = 0.
  await db.runAsync(`ALTER TABLE verticals ADD COLUMN tracks_lpv INTEGER DEFAULT 1`).catch(() => {});
  await db.runAsync(`ALTER TABLE rt_offers ADD COLUMN last_alerted_at DATETIME`).catch(() => {});

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
  await db.runAsync(`ALTER TABLE rules ADD COLUMN alert_level TEXT DEFAULT 'warning'`).catch(() => {});

  try {
    await db.runAsync(`INSERT INTO rules (name,scope,conditions_json,action,is_active) VALUES ('_migtest','campaign','[]','notify',0)`);
    await db.runAsync(`DELETE FROM rules WHERE name='_migtest'`);
  } catch (err) {
    if (err.message && err.message.includes('CHECK constraint')) {
      await db.runAsync(`PRAGMA foreign_keys = OFF`);
      await db.runAsync(`
        CREATE TABLE rules_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          scope TEXT NOT NULL CHECK(scope IN ('campaign','adset','ad','account')),
          conditions_json TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('pause','enable','scale_budget','notify','decrease_budget')),
          action_params_json TEXT,
          cooldown_hours INTEGER DEFAULT 4,
          is_active INTEGER DEFAULT 1,
          is_dry_run INTEGER DEFAULT 0,
          combinator TEXT DEFAULT 'AND',
          alert_level TEXT DEFAULT 'warning',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
      await db.runAsync(`INSERT INTO rules_v2 SELECT * FROM rules`);
      await db.runAsync(`DROP TABLE rules`);
      await db.runAsync(`ALTER TABLE rules_v2 RENAME TO rules`);
      await db.runAsync(`PRAGMA foreign_keys = ON`);
    } else {
      throw err;
    }
  }

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
    spend_delta REAL NOT NULL DEFAULT 0,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.runAsync(`ALTER TABLE spend_snapshots ADD COLUMN spend_delta REAL NOT NULL DEFAULT 0`).catch(() => {});

  await db.runAsync(`CREATE TABLE IF NOT EXISTS redtrack_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_name TEXT NOT NULL UNIQUE,
    roi REAL DEFAULT 0,
    revenue REAL DEFAULT 0,
    profit REAL DEFAULT 0,
    conversions REAL DEFAULT 0,
    offer_name TEXT,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS rt_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id TEXT NOT NULL UNIQUE,
    offer_name TEXT NOT NULL,
    vertical_id INTEGER REFERENCES verticals(id) ON DELETE SET NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS redtrack_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_name TEXT NOT NULL,
    date TEXT NOT NULL,
    revenue REAL DEFAULT 0,
    profit REAL DEFAULT 0,
    conversions REAL DEFAULT 0,
    cost REAL DEFAULT 0,
    roi REAL DEFAULT 0,
    UNIQUE(campaign_name, date)
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS fb_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    date TEXT NOT NULL,
    spend REAL DEFAULT 0,
    conversions REAL DEFAULT 0,
    revenue REAL DEFAULT 0,
    UNIQUE(entity_id, date)
  )`);

  await db.runAsync(`ALTER TABLE fb_daily ADD COLUMN ctr REAL DEFAULT 0`).catch(() => {});
  await db.runAsync(`ALTER TABLE fb_daily ADD COLUMN cpc REAL DEFAULT 0`).catch(() => {});
  await db.runAsync(`ALTER TABLE fb_daily ADD COLUMN frequency REAL DEFAULT 0`).catch(() => {});
  await db.runAsync(`ALTER TABLE fb_daily ADD COLUMN link_clicks REAL DEFAULT 0`).catch(() => {});
  await db.runAsync(`ALTER TABLE fb_daily ADD COLUMN lp_views REAL DEFAULT 0`).catch(() => {});
  await db.runAsync(`ALTER TABLE fb_daily ADD COLUMN initiate_checkout REAL DEFAULT 0`).catch(() => {});
  await db.runAsync(`ALTER TABLE fb_daily ADD COLUMN outbound_clicks REAL DEFAULT 0`).catch(() => {});

  await db.runAsync(`CREATE TABLE IF NOT EXISTS budget_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    rule_id INTEGER,
    old_budget_cents INTEGER NOT NULL,
    new_budget_cents INTEGER NOT NULL,
    action TEXT NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.runAsync(`CREATE TABLE IF NOT EXISTS pause_pending (
    rule_id INTEGER NOT NULL,
    entity_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_id, entity_id)
  )`);

  // Cycle locks — manual mutex for workflows whose n8n version doesn't expose
  // concurrency control. Workflow acquires at start, releases at end. Stale
  // locks (older than max_age_minutes) are auto-overridden so a crashed run
  // doesn't permanently block future cycles.
  await db.runAsync(`CREATE TABLE IF NOT EXISTS cycle_locks (
    name TEXT PRIMARY KEY,
    lock_id TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // scale_pending — analog of pause_pending for scale_budget / decrease_budget
  // rules. Set when a scale rule fires (live or dry) so subsequent cycles
  // skip the entity even if the rule_exemptions check has a race condition.
  // Cleared by the engine after the rule's cooldown elapses naturally, or
  // explicitly via DELETE /api/rules-engine/scale-pending.
  await db.runAsync(`CREATE TABLE IF NOT EXISTS scale_pending (
    rule_id INTEGER NOT NULL,
    entity_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_id, entity_id)
  )`);

  // Seed default schedules (per doc Section 4) on first run
  const schedCount = await db.getAsync('SELECT COUNT(*) as cnt FROM schedules');
  if (schedCount.cnt === 0) {
    const defaults = [
      { name: 'Business Hours', days: [1,2,3,4,5], start: '08:00', end: '20:00' },
      { name: 'Extended', days: [1,2,3,4,5], start: '06:00', end: '23:00' },
      { name: 'Weekdays + Sat', days: [1,2,3,4,5,6], start: '08:00', end: '21:00' },
      { name: 'Always On', days: [1,2,3,4,5,6,7], start: '00:00', end: '23:59' },
    ];
    const schedIds = {};
    for (const s of defaults) {
      const { lastID } = await db.runAsync(
        'INSERT INTO schedules (name, days_json, start_time, end_time, timezone, is_active) VALUES (?, ?, ?, ?, ?, 1)',
        [s.name, JSON.stringify(s.days), s.start, s.end, 'America/New_York']
      );
      schedIds[s.name] = lastID;
    }
    // Seed default verticals mapped to schedules (per doc Section 4)
    const verticals = [
      { name: 'Cash Offer', sched: 'Business Hours' },
      { name: 'Home Warranty', sched: 'Business Hours' },
      { name: 'EDU', sched: 'Extended' },
      { name: 'Solar', sched: 'Weekdays + Sat' },
      { name: 'Rewards', sched: 'Always On' },
    ];
    for (const v of verticals) {
      await db.runAsync(
        'INSERT OR IGNORE INTO verticals (name, default_schedule_id) VALUES (?, ?)',
        [v.name, schedIds[v.sched] || null]
      );
    }
  }
}

await initializeDatabase();

export const RulesEngineDB = {
  // --- Rules ---
  async createRule(data) {
    const { lastID } = await db.runAsync(
      `INSERT INTO rules (name, scope, conditions_json, action, action_params_json, cooldown_hours, is_active, is_dry_run, combinator, alert_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.scope, data.conditions_json, data.action, data.action_params_json,
       data.cooldown_hours, data.is_active, data.is_dry_run, data.combinator || 'AND', data.alert_level || 'warning']
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
       cooldown_hours=?, is_active=?, is_dry_run=?, combinator=?, alert_level=? WHERE id=?`,
      [data.name, data.scope, data.conditions_json, data.action, data.action_params_json,
       data.cooldown_hours, data.is_active, data.is_dry_run, data.combinator || 'AND', data.alert_level || 'warning', id]
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
  async removeTagGlobally(tag) {
    await db.runAsync(
      `DELETE FROM rule_assignments WHERE entity_type='tag' AND entity_id=?`,
      [tag]
    );
    return db.runAsync(
      `DELETE FROM campaign_labels WHERE label_type='tag' AND label_value=?`,
      [tag]
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
  async addCampaignLabel(campaignId, labelType, labelValue) {
    return db.runAsync(
      'INSERT OR IGNORE INTO campaign_labels (campaign_id, label_type, label_value) VALUES (?, ?, ?)',
      [campaignId, labelType, labelValue]
    );
  },
  async removeCampaignLabel(campaignId, labelType, labelValue) {
    return db.runAsync(
      'DELETE FROM campaign_labels WHERE campaign_id=? AND label_type=? AND label_value=?',
      [campaignId, labelType, labelValue]
    );
  },
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
  async autoAssignVerticalLabels(campaigns) {
    const verticals = await db.allAsync(
      `SELECT name, keyword FROM verticals WHERE keyword IS NOT NULL AND keyword != ''`
    );
    for (const campaign of campaigns) {
      for (const v of verticals) {
        if (campaign.name.toLowerCase().includes(v.keyword.toLowerCase())) {
          await db.runAsync(
            `INSERT OR IGNORE INTO campaign_labels (campaign_id, label_type, label_value) VALUES (?, 'vertical', ?)`,
            [campaign.id, v.name]
          );
        }
      }
    }
  },
  async getCampaignsByVertical(verticalName) {
    return db.allAsync(
      `SELECT campaign_id FROM campaign_labels WHERE label_type='vertical' AND label_value=?`,
      [verticalName]
    );
  },
  async listAllVerticalLabels() {
    return db.allAsync(
      `SELECT campaign_id, label_value FROM campaign_labels WHERE label_type='vertical'`
    );
  },
  async listVerticalsWithLpvOff() {
    return db.allAsync(
      `SELECT name FROM verticals WHERE tracks_lpv = 0`
    );
  },
  async setVerticalTracksLpv(verticalId, tracksLpv) {
    await db.runAsync(
      `UPDATE verticals SET tracks_lpv = ? WHERE id = ?`,
      [tracksLpv ? 1 : 0, verticalId]
    );
    return db.getAsync('SELECT * FROM verticals WHERE id = ?', [verticalId]);
  },
  async clearCampaignsByVertical(verticalName) {
    return db.runAsync(
      `DELETE FROM campaign_labels WHERE label_type='vertical' AND label_value=?`,
      [verticalName]
    );
  },
  async updateVertical(id, data) {
    await db.runAsync(
      'UPDATE verticals SET default_schedule_id = ? WHERE id = ?',
      [data.default_schedule_id ?? null, id]
    );
    return db.getAsync('SELECT * FROM verticals WHERE id = ?', [id]);
  },
  async deleteVertical(id) {
    const vertical = await db.getAsync('SELECT name FROM verticals WHERE id = ?', [id]);
    if (vertical) {
      await db.runAsync(
        `DELETE FROM campaign_labels WHERE label_type='vertical' AND label_value=?`,
        [vertical.name]
      );
      await db.runAsync(
        `DELETE FROM rule_assignments WHERE entity_type='vertical' AND entity_id=?`,
        [vertical.name]
      );
    }
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
  async getLogs({ date_from, date_to, rule_id, action_taken, limit = 500 } = {}) {
    let sql = 'SELECT * FROM rule_logs WHERE 1=1';
    const params = [];
    if (date_from) { sql += ' AND created_at >= ?'; params.push(date_from.replace('T', ' ').replace('Z', '')); }
    if (date_to) {
      // Append end-of-day time if only a date was provided, so same-day timestamps are included
      const dt = date_to.includes('T') ? date_to.replace('T', ' ').replace('Z', '') : date_to + ' 23:59:59';
      sql += ' AND created_at <= ?'; params.push(dt);
    }
    if (rule_id) { sql += ' AND rule_id = ?'; params.push(rule_id); }
    if (action_taken) { sql += ' AND action_taken = ?'; params.push(action_taken); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return db.allAsync(sql, params);
  },

  async getLastCycleAt() {
    const row = await db.getAsync(
      `SELECT created_at FROM rule_logs WHERE action_taken='cycle_ran' ORDER BY created_at DESC LIMIT 1`
    );
    return row?.created_at || null;
  },
  async getRecentErrorCount(hours = 24) {
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    const row = await db.getAsync(
      `SELECT COUNT(*) as cnt FROM rule_logs WHERE action_taken LIKE '%_failed' AND created_at >= ?`,
      [since]
    );
    return row?.cnt || 0;
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
      `SELECT DISTINCT entity_id as campaign_id FROM rule_assignments WHERE entity_type = 'campaign'
       UNION
       SELECT DISTINCT cl.campaign_id FROM campaign_labels cl
       JOIN rule_assignments ra ON ra.entity_type = 'vertical' AND ra.entity_id = cl.label_value
       WHERE cl.label_type = 'vertical'
       UNION
       SELECT DISTINCT cl.campaign_id FROM campaign_labels cl
       JOIN rule_assignments ra ON ra.entity_type = 'tag' AND ra.entity_id = cl.label_value
       WHERE cl.label_type = 'tag'`
    );
    return new Set(rows.map(r => r.campaign_id));
  },

  async listAllScheduledCampaignIds() {
    const rows = await db.allAsync(
      `SELECT DISTINCT campaign_id FROM schedule_assignments
       UNION
       SELECT DISTINCT cl.campaign_id FROM campaign_labels cl
       JOIN verticals v ON cl.label_value = v.name AND cl.label_type = 'vertical'
       WHERE v.default_schedule_id IS NOT NULL`
    );
    return new Set(rows.map(r => r.campaign_id));
  },

  // --- Spend Snapshots ---
  async saveSpendSnapshot(entityId, entityType, spend) {
    const prev = await db.getAsync(
      `SELECT spend FROM spend_snapshots WHERE entity_id=? ORDER BY recorded_at DESC LIMIT 1`,
      [entityId]
    );
    const delta = prev ? Math.max(0, spend - prev.spend) : 0;
    return db.runAsync(
      `INSERT INTO spend_snapshots (entity_id, entity_type, spend, spend_delta) VALUES (?, ?, ?, ?)`,
      [entityId, entityType, spend, delta]
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

  // --- RedTrack Snapshots ---
  async upsertRedtrackSnapshot(campaignName, data) {
    return db.runAsync(
      `INSERT INTO redtrack_snapshots (campaign_name, roi, revenue, profit, conversions, offer_name, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(campaign_name) DO UPDATE SET
         roi=excluded.roi, revenue=excluded.revenue, profit=excluded.profit,
         conversions=excluded.conversions, offer_name=excluded.offer_name,
         recorded_at=CURRENT_TIMESTAMP`,
      [campaignName, data.roi ?? 0, data.revenue ?? 0, data.profit ?? 0,
       data.conversions ?? 0, data.offer_name ?? null]
    );
  },
  async getAllRedtrackSnapshots() {
    return db.allAsync(`SELECT * FROM redtrack_snapshots`);
  },
  async pruneRedtrackSnapshots() {
    return db.runAsync(`DELETE FROM redtrack_snapshots WHERE recorded_at < datetime('now', '-2 hours')`);
  },

  // --- Daily Snapshots ---
  async upsertRtDaily(campaignName, date, { revenue, profit, conversions, cost }) {
    const roi = cost > 0 ? profit / cost : 0;
    return db.runAsync(
      `INSERT INTO redtrack_daily (campaign_name, date, revenue, profit, conversions, cost, roi)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_name, date) DO UPDATE SET
         revenue=excluded.revenue, profit=excluded.profit,
         conversions=excluded.conversions, cost=excluded.cost, roi=excluded.roi`,
      [campaignName, date, revenue, profit, conversions, cost, roi]
    );
  },

  async getRtDailyWindow(campaignName, days) {
    return db.getAsync(
      `SELECT
        SUM(revenue) as revenue, SUM(profit) as profit,
        SUM(conversions) as conversions, SUM(cost) as cost,
        CASE WHEN SUM(cost) > 0 THEN SUM(profit) / SUM(cost) ELSE 0 END as roi
       FROM redtrack_daily
       WHERE LOWER(campaign_name)=LOWER(?) AND date >= date('now', ? || ' days')`,
      [campaignName, `-${days}`]
    );
  },

  async upsertFbDaily(entityId, entityType, date, { spend, conversions, revenue, ctr, cpc, frequency, link_clicks, lp_views, initiate_checkout, outbound_clicks }) {
    return db.runAsync(
      `INSERT INTO fb_daily (entity_id, entity_type, date, spend, conversions, revenue, ctr, cpc, frequency, link_clicks, lp_views, initiate_checkout, outbound_clicks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id, date) DO UPDATE SET
         spend=excluded.spend, conversions=excluded.conversions, revenue=excluded.revenue,
         ctr=excluded.ctr, cpc=excluded.cpc, frequency=excluded.frequency,
         link_clicks=excluded.link_clicks, lp_views=excluded.lp_views,
         initiate_checkout=excluded.initiate_checkout, outbound_clicks=excluded.outbound_clicks`,
      [entityId, entityType, date, spend||0, conversions||0, revenue||0,
       ctr||0, cpc||0, frequency||0, link_clicks||0, lp_views||0, initiate_checkout||0, outbound_clicks||0]
    );
  },

  async saveBudgetHistory(entityId, entityType, ruleId, oldCents, newCents, action) {
    return db.runAsync(
      `INSERT INTO budget_history (entity_id, entity_type, rule_id, old_budget_cents, new_budget_cents, action)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entityId, entityType, ruleId || null, oldCents, newCents, action]
    );
  },
  async getYesterdayDecreasedBudgets() {
    return db.allAsync(
      `SELECT entity_id, entity_type, MIN(old_budget_cents) as old_budget_cents
       FROM budget_history
       WHERE action = 'decrease_budget'
         AND date(recorded_at) = date('now', '-1 day')
       GROUP BY entity_id, entity_type`
    );
  },

  async getFbDailyWindow(entityId, days) {
    return db.getAsync(
      `SELECT
        SUM(spend) as spend, SUM(conversions) as conversions, SUM(revenue) as revenue,
        CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END as cpa,
        CASE WHEN SUM(spend) > 0 THEN (SUM(revenue) - SUM(spend)) / SUM(spend) ELSE 0 END as roi
       FROM fb_daily
       WHERE entity_id=? AND date >= date('now', ? || ' days')`,
      [entityId, `-${days}`]
    );
  },

  async getOfferPerformance(days = 7) {
    return db.allAsync(
      `SELECT
         campaign_name,
         SUM(cost)         as cost,
         SUM(revenue)      as revenue,
         SUM(profit)       as profit,
         SUM(conversions)  as conversions,
         CASE WHEN SUM(cost) > 0
              THEN SUM(profit) / SUM(cost) ELSE 0 END as roi,
         CASE WHEN SUM(conversions) > 0
              THEN SUM(cost) / SUM(conversions) ELSE 0 END as cpa
       FROM redtrack_daily
       WHERE date >= date('now', ? || ' days')
         AND cost > 0
       GROUP BY campaign_name
       HAVING SUM(cost) >= 5
       ORDER BY profit DESC`,
      [`-${days}`]
    );
  },

  async pruneDaily(keepDays = 30) {
    await db.runAsync(`DELETE FROM redtrack_daily WHERE date < date('now', ? || ' days')`, [`-${keepDays}`]);
    await db.runAsync(`DELETE FROM fb_daily WHERE date < date('now', ? || ' days')`, [`-${keepDays}`]);
  },

  get _db() { return db; },

  // --- RT Offers ---
  async upsertRtOffer(offerId, offerName, verticalId) {
    return db.runAsync(
      `INSERT INTO rt_offers (offer_id, offer_name, vertical_id)
       VALUES (?, ?, ?)
       ON CONFLICT(offer_id) DO UPDATE SET
         offer_name=excluded.offer_name,
         vertical_id=COALESCE(rt_offers.vertical_id, excluded.vertical_id)`,
      [offerId, offerName, verticalId ?? null]
    );
  },
  async getUnmappedRtOffers() {
    return db.allAsync(
      `SELECT offer_id, offer_name FROM rt_offers
       WHERE vertical_id IS NULL
         AND (last_alerted_at IS NULL OR last_alerted_at < datetime('now', '-24 hours'))`
    );
  },
  async markOffersAlerted(offerIds) {
    if (!offerIds.length) return;
    const placeholders = offerIds.map(() => '?').join(',');
    return db.runAsync(
      `UPDATE rt_offers SET last_alerted_at = CURRENT_TIMESTAMP WHERE offer_id IN (${placeholders})`,
      offerIds
    );
  },

  // --- Cycle Locks (manual concurrency mutex) ---
  async acquireCycleLock(name, maxAgeMinutes = 30) {
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const existing = await db.getAsync(
      `SELECT lock_id, started_at,
        (julianday('now') - julianday(started_at)) * 24 * 60 as age_min
       FROM cycle_locks WHERE name = ?`,
      [name]
    );
    if (existing && existing.age_min < maxAgeMinutes) {
      return { acquired: false, holder_lock_id: existing.lock_id, age_minutes: existing.age_min };
    }
    await db.runAsync(
      `INSERT INTO cycle_locks (name, lock_id, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET lock_id = excluded.lock_id, started_at = CURRENT_TIMESTAMP`,
      [name, lockId]
    );
    return { acquired: true, lock_id: lockId };
  },
  async releaseCycleLock(name, lockId) {
    const result = await db.runAsync(
      `DELETE FROM cycle_locks WHERE name = ? AND lock_id = ?`,
      [name, lockId]
    );
    return { released: result.changes > 0 };
  },

  // --- Scale Pending (analog of pause_pending for scale rules) ---
  async setScalePending(ruleId, entityId, cooldownHours) {
    const expiresAt = new Date(Date.now() + cooldownHours * 3600000).toISOString();
    return db.runAsync(
      `INSERT INTO scale_pending (rule_id, entity_id, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(rule_id, entity_id) DO UPDATE SET expires_at = excluded.expires_at`,
      [ruleId, entityId, expiresAt]
    );
  },
  async isScalePending(ruleId, entityId) {
    const row = await db.getAsync(
      `SELECT 1 FROM scale_pending
       WHERE rule_id = ? AND entity_id = ? AND datetime(expires_at) > datetime(CURRENT_TIMESTAMP)`,
      [ruleId, entityId]
    );
    return !!row;
  },
  async batchIsScalePending(items) {
    if (!items.length) return [];
    const params = [];
    const clauses = items.map(i => {
      params.push(i.rule_id, i.entity_id);
      return '(rule_id=? AND entity_id=?)';
    });
    const rows = await db.allAsync(
      `SELECT rule_id, entity_id FROM scale_pending
       WHERE (${clauses.join(' OR ')})
         AND datetime(expires_at) > datetime(CURRENT_TIMESTAMP)`,
      params
    );
    const set = new Set(rows.map(r => `${r.rule_id}:${r.entity_id}`));
    return items.map(i => ({
      rule_id: i.rule_id,
      entity_id: i.entity_id,
      pending: set.has(`${i.rule_id}:${i.entity_id}`),
    }));
  },
  async pruneExpiredScalePending() {
    return db.runAsync(
      `DELETE FROM scale_pending WHERE datetime(expires_at) <= datetime(CURRENT_TIMESTAMP)`
    );
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
      `SELECT 1 FROM pause_pending WHERE entity_id=?`,
      [entityId]
    );
    return !!row;
  },
  async batchIsExempt(items) {
    if (!items.length) return [];
    const params = [];
    const clauses = items.map(i => {
      params.push(i.rule_id, i.entity_id);
      return '(rule_id=? AND entity_id=?)';
    });
    const rows = await db.allAsync(
      `SELECT rule_id, entity_id FROM rule_exemptions WHERE (${clauses.join(' OR ')}) AND datetime(expires_at) > datetime(CURRENT_TIMESTAMP)`,
      params
    );
    const exemptSet = new Set(rows.map(r => `${r.rule_id}:${r.entity_id}`));
    return items.map(i => ({ rule_id: i.rule_id, entity_id: i.entity_id, exempt: exemptSet.has(`${i.rule_id}:${i.entity_id}`) }));
  },

  async batchIsPausePending(items) {
    if (!items.length) return [];
    const entityIds = items.map(i => i.entity_id);
    const placeholders = entityIds.map(() => '?').join(',');
    const rows = await db.allAsync(
      `SELECT entity_id FROM pause_pending WHERE entity_id IN (${placeholders})`,
      entityIds
    );
    const pendingSet = new Set(rows.map(r => r.entity_id));
    return items.map(i => ({ rule_id: i.rule_id, entity_id: i.entity_id, pending: pendingSet.has(i.entity_id) }));
  },
  async clearPausePending(ruleId, entityId) {
    return db.runAsync(
      `DELETE FROM pause_pending WHERE rule_id=? AND entity_id=?`,
      [ruleId, entityId]
    );
  },

  // S03: stale pause_pending entries (pending > X minutes without resolution)
  async getStalePausePending(minutes = 10) {
    const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
    return db.allAsync(
      `SELECT rule_id, entity_id, created_at FROM pause_pending WHERE created_at <= ?`,
      [cutoff]
    );
  },

  // I06: last successful FB data pull
  async getLastPullSuccessAt() {
    const row = await db.getAsync(
      `SELECT created_at FROM rule_logs WHERE action_taken='pull_success' ORDER BY created_at DESC LIMIT 1`
    );
    return row?.created_at || null;
  },

  // M02: count consecutive pull_failed entries before any pull_success
  async getConsecutivePullFailures() {
    const rows = await db.allAsync(
      `SELECT action_taken FROM rule_logs
       WHERE action_taken IN ('pull_success', 'pull_failed')
       ORDER BY created_at DESC LIMIT 10`
    );
    let count = 0;
    for (const row of rows) {
      if (row.action_taken === 'pull_failed') count++;
      else break;
    }
    return count;
  },
};

export default RulesEngineDB;
