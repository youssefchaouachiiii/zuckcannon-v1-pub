# Rules Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a rules engine that watches Facebook ad campaigns and auto-pauses/scales them based on configurable conditions, with campaign scheduling and Telegram alerts — managed via new pages in zuckcannon, executed by n8n.

**Architecture:** Zuckcannon stores rules/schedules/tokens and exposes REST API. n8n reads from zuckcannon every 2 minutes, calls Facebook Marketing API, takes action, logs back to zuckcannon. System Users plan must be completed first.

**Tech Stack:** Node.js ESM, Express, SQLite3, Jest + Supertest (backend); vanilla JS (frontend); n8n self-hosted via Docker

**Prerequisite:** `2026-04-13-system-users-plan.md` completed and merged.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/db/rules-engine-db.js` | Create | All SQLite operations for rules engine (9 tables) |
| `backend/utils/rules-engine-resolver.js` | Create | Resolve vertical/tag assignments → flat FB entity list |
| `backend/routes/rules-engine-n8n.js` | Create | Routes called by n8n (active-rules, log, exemptions, health) |
| `backend/routes/rules-engine-ui.js` | Create | UI CRUD routes (rules, schedules, verticals, coverage, logs) |
| `server.js` | Modify | Import + mount both routers |
| `n8n-workflows/rules-engine-loop.json` | Create | n8n Workflow 1 export |
| `n8n-workflows/schedule-check.json` | Create | n8n Workflow 2 export |
| `n8n-workflows/daily-digest.json` | Create | n8n Workflow 3 export |
| `n8n-workflows/self-monitoring.json` | Create | n8n Workflow 4 export |
| `public/rules-engine.js` | Create | Frontend JS for all rules engine pages |
| `public/index.html` | Modify | Add 6 new nav items + page sections |
| `tests/rules-engine-db.test.js` | Create | DB layer unit tests |
| `tests/rules-engine-resolver.test.js` | Create | Resolver unit tests |
| `tests/rules-engine-n8n-routes.test.js` | Create | n8n-facing route tests |

---

## Task 1: Database Schema (9 new tables)

**Files:**
- Create: `backend/db/rules-engine-db.js`
- Create: `tests/rules-engine-db.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/rules-engine-db.test.js
import { RulesEngineDB } from '../backend/db/rules-engine-db.js';

describe('RulesEngineDB - rules', () => {
  let ruleId;

  afterEach(async () => {
    if (ruleId) await RulesEngineDB.deleteRule(ruleId);
  });

  test('createRule saves and returns a rule', async () => {
    const rule = await RulesEngineDB.createRule({
      name: 'Spend Cap Test',
      scope: 'campaign',
      conditions_json: JSON.stringify([{ metric: 'spend_today', operator: 'gt', value: 300, lookback: 'today' }]),
      action: 'pause',
      action_params_json: null,
      cooldown_hours: 4,
      is_active: 1,
      is_dry_run: 0,
    });
    ruleId = rule.id;
    expect(rule.name).toBe('Spend Cap Test');
    expect(rule.scope).toBe('campaign');
  });

  test('getRuleById returns null for missing rule', async () => {
    const rule = await RulesEngineDB.getRuleById(99999);
    expect(rule).toBeNull();
  });

  test('listActiveRules returns only active rules', async () => {
    const rule = await RulesEngineDB.createRule({
      name: 'Active Rule', scope: 'campaign',
      conditions_json: '[]', action: 'pause',
      action_params_json: null, cooldown_hours: 1,
      is_active: 1, is_dry_run: 0,
    });
    ruleId = rule.id;
    const active = await RulesEngineDB.listActiveRules();
    expect(active.some(r => r.id === rule.id)).toBe(true);
  });
});

describe('RulesEngineDB - exemptions', () => {
  test('isExempt returns true during snooze period', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    await RulesEngineDB.setExemption(1, 'entity_123', 'snooze', future);
    const exempt = await RulesEngineDB.isExempt(1, 'entity_123');
    expect(exempt).toBe(true);
    await RulesEngineDB.clearExemption(1, 'entity_123');
  });

  test('isExempt returns false after exemption expires', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await RulesEngineDB.setExemption(1, 'entity_456', 'cooldown', past);
    const exempt = await RulesEngineDB.isExempt(1, 'entity_456');
    expect(exempt).toBe(false);
    await RulesEngineDB.clearExemption(1, 'entity_456');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/rules-engine-db.test.js
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create `backend/db/rules-engine-db.js`**

```js
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

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
}

await initializeDatabase();

export const RulesEngineDB = {
  // --- Rules ---
  async createRule(data) {
    const { lastID } = await db.runAsync(
      `INSERT INTO rules (name, scope, conditions_json, action, action_params_json, cooldown_hours, is_active, is_dry_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.scope, data.conditions_json, data.action, data.action_params_json,
       data.cooldown_hours, data.is_active, data.is_dry_run]
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
       cooldown_hours=?, is_active=?, is_dry_run=? WHERE id=?`,
      [data.name, data.scope, data.conditions_json, data.action, data.action_params_json,
       data.cooldown_hours, data.is_active, data.is_dry_run, id]
    );
    return this.getRuleById(id);
  },
  async deleteRule(id) {
    return db.runAsync('DELETE FROM rules WHERE id = ?', [id]);
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
    // labels: [{label_type, label_value}]
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
    // campaignList: [{id, name}] from FB API
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
  async listVerticals() {
    return db.allAsync('SELECT * FROM verticals ORDER BY name ASC');
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
  async getLogs({ date, rule_id, limit = 200 }) {
    let sql = 'SELECT * FROM rule_logs WHERE 1=1';
    const params = [];
    if (date) { sql += ' AND DATE(created_at) = ?'; params.push(date); }
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
      'SELECT id FROM rule_exemptions WHERE rule_id=? AND entity_id=? AND expires_at > CURRENT_TIMESTAMP',
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
};

export default RulesEngineDB;
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/rules-engine-db.test.js
```

Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/db/rules-engine-db.js tests/rules-engine-db.test.js
git commit -m "feat: add rules engine database schema and CRUD layer"
```

---

## Task 2: Assignment Resolver

**Files:**
- Create: `backend/utils/rules-engine-resolver.js`
- Create: `tests/rules-engine-resolver.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/rules-engine-resolver.test.js
import { resolveRuleEntities } from '../backend/utils/rules-engine-resolver.js';

jest.mock('../backend/db/rules-engine-db.js', () => ({
  RulesEngineDB: {
    getAssignmentsForRule: jest.fn(),
    getCampaignsByLabel: jest.fn(),
  },
}));

import { RulesEngineDB } from '../backend/db/rules-engine-db.js';

describe('resolveRuleEntities', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns direct campaign assignments unchanged', async () => {
    RulesEngineDB.getAssignmentsForRule.mockResolvedValue([
      { entity_type: 'campaign', entity_id: 'camp_123' },
      { entity_type: 'campaign', entity_id: 'camp_456' },
    ]);

    const result = await resolveRuleEntities(1);
    expect(result).toEqual(['camp_123', 'camp_456']);
  });

  test('expands vertical assignments to campaign IDs', async () => {
    RulesEngineDB.getAssignmentsForRule.mockResolvedValue([
      { entity_type: 'vertical', entity_id: 'solar' },
    ]);
    RulesEngineDB.getCampaignsByLabel.mockResolvedValue([
      { campaign_id: 'camp_101' },
      { campaign_id: 'camp_102' },
    ]);

    const result = await resolveRuleEntities(1);
    expect(result).toEqual(['camp_101', 'camp_102']);
    expect(RulesEngineDB.getCampaignsByLabel).toHaveBeenCalledWith('vertical', 'solar');
  });

  test('deduplicates when same campaign appears in multiple assignments', async () => {
    RulesEngineDB.getAssignmentsForRule.mockResolvedValue([
      { entity_type: 'campaign', entity_id: 'camp_123' },
      { entity_type: 'vertical', entity_id: 'solar' },
    ]);
    RulesEngineDB.getCampaignsByLabel.mockResolvedValue([
      { campaign_id: 'camp_123' }, // duplicate
      { campaign_id: 'camp_456' },
    ]);

    const result = await resolveRuleEntities(1);
    expect(result).toEqual(['camp_123', 'camp_456']);
    expect(result.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/rules-engine-resolver.test.js
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create `backend/utils/rules-engine-resolver.js`**

```js
// backend/utils/rules-engine-resolver.js
import { RulesEngineDB } from '../db/rules-engine-db.js';

/**
 * Resolves a rule's assignments into a deduplicated flat list of FB entity IDs.
 * Direct campaign/adset/ad assignments are returned as-is.
 * Vertical and tag assignments are expanded via campaign_labels lookup.
 *
 * @param {number} ruleId
 * @returns {Promise<string[]>} - array of FB entity IDs
 */
export async function resolveRuleEntities(ruleId) {
  const assignments = await RulesEngineDB.getAssignmentsForRule(ruleId);
  const entityIds = new Set();

  for (const a of assignments) {
    if (a.entity_type === 'campaign' || a.entity_type === 'adset' || a.entity_type === 'ad') {
      entityIds.add(a.entity_id);
    } else if (a.entity_type === 'vertical') {
      const rows = await RulesEngineDB.getCampaignsByLabel('vertical', a.entity_id);
      rows.forEach(r => entityIds.add(r.campaign_id));
    } else if (a.entity_type === 'tag') {
      const rows = await RulesEngineDB.getCampaignsByLabel('tag', a.entity_id);
      rows.forEach(r => entityIds.add(r.campaign_id));
    }
    // 'account' type handled at the route level (returns all campaigns for account)
  }

  return [...entityIds];
}
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/rules-engine-resolver.test.js
```

Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/utils/rules-engine-resolver.js tests/rules-engine-resolver.test.js
git commit -m "feat: add rules engine resolver (vertical/tag → flat entity list)"
```

---

## Task 3: n8n-Facing Routes

These routes are called by n8n every 2 minutes.

**Files:**
- Create: `backend/routes/rules-engine-n8n.js`
- Create: `tests/rules-engine-n8n-routes.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/rules-engine-n8n-routes.test.js
import request from 'supertest';
import express from 'express';
import { rulesEngineN8nRouter } from '../backend/routes/rules-engine-n8n.js';

jest.mock('../backend/db/rules-engine-db.js', () => ({
  RulesEngineDB: {
    listActiveRules: jest.fn(),
    getAssignmentsForRule: jest.fn(),
    addLog: jest.fn(),
    setExemption: jest.fn(),
    isExempt: jest.fn(),
    listActiveSchedules: jest.fn(),
    getCampaignsForSchedule: jest.fn(),
    listSystemUserTokens: jest.fn(),
  },
}));

jest.mock('../utils/rules-engine-resolver.js', () => ({
  resolveRuleEntities: jest.fn(),
}));

jest.mock('../utils/facebook-auth-db.js', () => ({
  FacebookAuthDB: { listSystemUserTokens: jest.fn() },
}));

import { RulesEngineDB } from '../backend/db/rules-engine-db.js';
import { resolveRuleEntities } from '../backend/utils/rules-engine-resolver.js';
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

const app = express();
app.use(express.json());
app.use('/api/rules-engine', rulesEngineN8nRouter);

describe('GET /api/rules-engine/health', () => {
  test('returns 200 ok', async () => {
    const res = await request(app).get('/api/rules-engine/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('GET /api/rules-engine/active-rules', () => {
  test('returns rules with resolved entities and token', async () => {
    RulesEngineDB.listActiveRules.mockResolvedValue([
      { id: 1, name: 'Spend Cap', scope: 'campaign', conditions_json: '[]',
        action: 'pause', action_params_json: null, cooldown_hours: 4, is_dry_run: 0 }
    ]);
    resolveRuleEntities.mockResolvedValue(['camp_123', 'camp_456']);
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([
      { business_manager_id: 'bm_1', access_token: 'SYS_TOKEN' }
    ]);

    const res = await request(app).get('/api/rules-engine/active-rules');
    expect(res.status).toBe(200);
    expect(res.body[0].entities).toEqual(['camp_123', 'camp_456']);
    expect(res.body[0].token).toBe('SYS_TOKEN');
  });
});

describe('POST /api/rules-engine/log', () => {
  test('saves a log entry', async () => {
    RulesEngineDB.addLog.mockResolvedValue({});

    const res = await request(app)
      .post('/api/rules-engine/log')
      .send({
        rule_id: 1, entity_type: 'campaign', entity_id: 'camp_123',
        entity_name: 'Test Campaign', action_taken: 'paused',
        trigger_data_json: '{"spend":312}', is_dry_run: 0,
      });

    expect(res.status).toBe(200);
    expect(RulesEngineDB.addLog).toHaveBeenCalled();
  });
});

describe('POST /api/rules-engine/exemptions', () => {
  test('sets a cooldown exemption', async () => {
    RulesEngineDB.setExemption.mockResolvedValue({});

    const res = await request(app)
      .post('/api/rules-engine/exemptions')
      .send({ rule_id: 1, entity_id: 'camp_123', type: 'cooldown', cooldown_hours: 4 });

    expect(res.status).toBe(200);
    expect(RulesEngineDB.setExemption).toHaveBeenCalledWith(
      1, 'camp_123', 'cooldown', expect.any(String)
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/rules-engine-n8n-routes.test.js
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create `backend/routes/rules-engine-n8n.js`**

```js
// backend/routes/rules-engine-n8n.js
import express from 'express';
import { RulesEngineDB } from '../db/rules-engine-db.js';
import { resolveRuleEntities } from '../utils/rules-engine-resolver.js';
import { FacebookAuthDB } from '../utils/facebook-auth-db.js';

export const rulesEngineN8nRouter = express.Router();

// Simple health check for self-monitoring workflow
rulesEngineN8nRouter.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Main endpoint called by n8n Workflow 1 every 2 minutes
rulesEngineN8nRouter.get('/active-rules', async (req, res) => {
  try {
    const rules = await RulesEngineDB.listActiveRules();
    const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();

    // Use first available system user token (covers all accounts in same BM)
    const token = systemUserTokens[0]?.access_token || null;

    const resolved = await Promise.all(
      rules.map(async (rule) => ({
        ...rule,
        conditions: JSON.parse(rule.conditions_json),
        action_params: rule.action_params_json ? JSON.parse(rule.action_params_json) : null,
        entities: await resolveRuleEntities(rule.id),
        token,
      }))
    );

    res.json(resolved);
  } catch (err) {
    console.error('active-rules error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Called by n8n Workflow 2 every 1 minute
rulesEngineN8nRouter.get('/active-schedules', async (req, res) => {
  try {
    const schedules = await RulesEngineDB.listActiveSchedules();
    const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();
    const token = systemUserTokens[0]?.access_token || null;

    const resolved = await Promise.all(
      schedules.map(async (s) => {
        const campaignRows = await RulesEngineDB.getCampaignsForSchedule(s.id);
        return {
          ...s,
          days: JSON.parse(s.days_json),
          campaign_ids: campaignRows.map(r => r.campaign_id),
          token,
        };
      })
    );

    res.json(resolved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Called by n8n after a rule fires — save to activity log
rulesEngineN8nRouter.post('/log', async (req, res) => {
  try {
    await RulesEngineDB.addLog(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Called by n8n after a rule fires — set cooldown or snooze
rulesEngineN8nRouter.post('/exemptions', async (req, res) => {
  const { rule_id, entity_id, type, cooldown_hours } = req.body;
  const hours = cooldown_hours || 4;
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

  try {
    await RulesEngineDB.setExemption(rule_id, entity_id, type, expiresAt);
    res.json({ ok: true, expires_at: expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Called by Workflow 3 — list tokens with expiry info
rulesEngineN8nRouter.get('/tokens', async (req, res) => {
  try {
    const tokens = await FacebookAuthDB.listSystemUserTokens();
    res.json(tokens.map(({ access_token, ...rest }) => rest)); // redact tokens
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Run tests**

```bash
npm test tests/rules-engine-n8n-routes.test.js
```

Expected: PASS — 4 tests passing

- [ ] **Step 5: Mount routers in `server.js`**

Add to imports:
```js
import { rulesEngineN8nRouter } from './backend/routes/rules-engine-n8n.js';
import { rulesEngineUiRouter } from './backend/routes/rules-engine-ui.js';
```

Add route registrations (n8n routes don't need auth — n8n is on localhost):
```js
// n8n routes — only accessible from localhost
app.use('/api/rules-engine', (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}, rulesEngineN8nRouter);

// UI routes — require auth
app.use('/api/rules-engine/ui', ensureAuthenticatedAPI, rulesEngineUiRouter);
```

Note: `rulesEngineUiRouter` is created in Task 4. Create an empty placeholder for now:
```js
// backend/routes/rules-engine-ui.js (placeholder for Task 4)
import express from 'express';
export const rulesEngineUiRouter = express.Router();
```

- [ ] **Step 6: Test health endpoint**

```bash
npm run dev
curl http://localhost:6969/api/rules-engine/health
```

Expected: `{"ok":true,"ts":"2026-..."}`

- [ ] **Step 7: Commit**

```bash
git add backend/routes/rules-engine-n8n.js backend/routes/rules-engine-ui.js tests/rules-engine-n8n-routes.test.js server.js
git commit -m "feat: add n8n-facing rules engine routes (active-rules, log, exemptions, health)"
```

---

## Task 4: UI CRUD Routes

**Files:**
- Modify: `backend/routes/rules-engine-ui.js`

- [ ] **Step 1: Replace placeholder with full router**

```js
// backend/routes/rules-engine-ui.js
import express from 'express';
import { RulesEngineDB } from '../db/rules-engine-db.js';
import { FacebookCacheDB } from '../utils/facebook-cache-db.js';

export const rulesEngineUiRouter = express.Router();

// --- Rules CRUD ---
rulesEngineUiRouter.get('/rules', async (req, res) => {
  try { res.json(await RulesEngineDB.listAllRules()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.post('/rules', async (req, res) => {
  try {
    const rule = await RulesEngineDB.createRule({
      name: req.body.name,
      scope: req.body.scope,
      conditions_json: JSON.stringify(req.body.conditions),
      action: req.body.action,
      action_params_json: req.body.action_params ? JSON.stringify(req.body.action_params) : null,
      cooldown_hours: req.body.cooldown_hours ?? 4,
      is_active: req.body.is_active ?? 1,
      is_dry_run: req.body.is_dry_run ?? 0,
    });
    res.status(201).json(rule);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.put('/rules/:id', async (req, res) => {
  try {
    const rule = await RulesEngineDB.updateRule(parseInt(req.params.id), {
      name: req.body.name,
      scope: req.body.scope,
      conditions_json: JSON.stringify(req.body.conditions),
      action: req.body.action,
      action_params_json: req.body.action_params ? JSON.stringify(req.body.action_params) : null,
      cooldown_hours: req.body.cooldown_hours ?? 4,
      is_active: req.body.is_active ?? 1,
      is_dry_run: req.body.is_dry_run ?? 0,
    });
    res.json(rule);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.delete('/rules/:id', async (req, res) => {
  try {
    await RulesEngineDB.deleteRule(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rule assignment
rulesEngineUiRouter.post('/rules/:id/assign', async (req, res) => {
  // body: { assignments: [{entity_type, entity_id}] }
  try {
    for (const a of req.body.assignments) {
      await RulesEngineDB.addAssignment(parseInt(req.params.id), a.entity_type, a.entity_id);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.delete('/rules/:id/assign', async (req, res) => {
  const { entity_type, entity_id } = req.body;
  try {
    await RulesEngineDB.removeAssignment(parseInt(req.params.id), entity_type, entity_id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Schedules CRUD ---
rulesEngineUiRouter.get('/schedules', async (req, res) => {
  try { res.json(await RulesEngineDB.listAllSchedules()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.post('/schedules', async (req, res) => {
  try {
    const s = await RulesEngineDB.createSchedule({
      name: req.body.name,
      days_json: JSON.stringify(req.body.days),
      start_time: req.body.start_time,
      end_time: req.body.end_time,
      timezone: req.body.timezone || 'America/New_York',
      is_active: req.body.is_active ?? 1,
    });
    res.status(201).json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.put('/schedules/:id', async (req, res) => {
  try {
    const s = await RulesEngineDB.updateSchedule(parseInt(req.params.id), {
      name: req.body.name,
      days_json: JSON.stringify(req.body.days),
      start_time: req.body.start_time,
      end_time: req.body.end_time,
      timezone: req.body.timezone || 'America/New_York',
      is_active: req.body.is_active ?? 1,
    });
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.delete('/schedules/:id', async (req, res) => {
  try {
    await RulesEngineDB.deleteSchedule(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.post('/schedules/:id/assign', async (req, res) => {
  // body: { campaign_ids: ['camp_123', ...] }
  try {
    for (const cid of req.body.campaign_ids) {
      await RulesEngineDB.addScheduleAssignment(parseInt(req.params.id), cid);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Verticals CRUD ---
rulesEngineUiRouter.get('/verticals', async (req, res) => {
  try { res.json(await RulesEngineDB.listVerticals()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.post('/verticals', async (req, res) => {
  try {
    const v = await RulesEngineDB.createVertical(req.body.name, req.body.default_schedule_id || null);
    res.status(201).json(v);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.delete('/verticals/:id', async (req, res) => {
  try {
    await RulesEngineDB.deleteVertical(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk assign campaigns to vertical by name pattern
rulesEngineUiRouter.post('/campaigns/labels/bulk', async (req, res) => {
  // body: { pattern: 'Solar', label_type: 'vertical', label_value: 'solar' }
  try {
    // Pull all campaigns from FB cache
    const cachedCampaigns = await FacebookCacheDB.getAllCampaigns(req.user?.id);
    const count = await RulesEngineDB.bulkSetLabelByPattern(
      req.body.pattern,
      req.body.label_type,
      req.body.label_value,
      cachedCampaigns
    );
    res.json({ matched: count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Logs ---
rulesEngineUiRouter.get('/logs', async (req, res) => {
  try {
    const logs = await RulesEngineDB.getLogs({
      date: req.query.date,
      rule_id: req.query.rule_id ? parseInt(req.query.rule_id) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit) : 200,
    });
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Coverage (campaigns without rules or schedules) ---
rulesEngineUiRouter.get('/coverage', async (req, res) => {
  try {
    const cachedCampaigns = await FacebookCacheDB.getAllCampaigns(req.user?.id);
    const assignments = await RulesEngineDB.listAllAssignedCampaignIds();
    const scheduledCampaigns = await RulesEngineDB.listAllScheduledCampaignIds();

    const orphans = cachedCampaigns.filter(c => {
      const hasRule = assignments.has(c.id);
      const hasSchedule = scheduledCampaigns.has(c.id);
      return !hasRule || !hasSchedule;
    }).map(c => ({
      ...c,
      missing_rule: !assignments.has(c.id),
      missing_schedule: !scheduledCampaigns.has(c.id),
    }));

    res.json(orphans);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

Add two helper methods to `RulesEngineDB` in `rules-engine-db.js`:

```js
async listAllAssignedCampaignIds() {
  // Returns Set of campaign IDs that have direct rule assignments
  const rows = await db.allAsync(
    `SELECT DISTINCT entity_id FROM rule_assignments WHERE entity_type = 'campaign'`
  );
  return new Set(rows.map(r => r.entity_id));
},

async listAllScheduledCampaignIds() {
  const rows = await db.allAsync('SELECT DISTINCT campaign_id FROM schedule_assignments');
  return new Set(rows.map(r => r.campaign_id));
},
```

Also check that `FacebookCacheDB` has a `getAllCampaigns` method. Look in `backend/utils/facebook-cache-db.js`:

```bash
grep -n "getAllCampaigns\|getCampaigns\|campaigns" backend/utils/facebook-cache-db.js | head -20
```

If the method name is different, use the correct one in the route above.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: All existing tests pass + no new failures

- [ ] **Step 3: Commit**

```bash
git add backend/routes/rules-engine-ui.js backend/db/rules-engine-db.js
git commit -m "feat: add rules engine UI CRUD routes (rules, schedules, verticals, logs, coverage)"
```

---

## Task 5: n8n Setup + Workflow 1 (Rules Engine Loop)

**Files:**
- Create: `n8n-workflows/rules-engine-loop.json`
- n8n running at `http://localhost:5678`

- [ ] **Step 1: Confirm n8n is running**

```bash
docker ps | grep n8n
```

Expected: n8n container running. If not: `docker compose up -d n8n`

- [ ] **Step 2: Open n8n UI and create Workflow 1**

Open `http://localhost:5678` → New Workflow → Name: "Rules Engine Loop"

Add nodes in this order:

**Node 1: Cron** (trigger)
- Trigger: Every 2 minutes
- Mode: `Every X Minutes` → 2

**Node 2: HTTP Request** (fetch active rules)
- Method: GET
- URL: `http://localhost:6969/api/rules-engine/active-rules`
- Response format: JSON

**Node 3: Split In Batches** (process one rule at a time)
- Batch size: 1

**Node 4: HTTP Request** (fetch FB insights for rule's entities)
- Method: GET
- URL: `https://graph.facebook.com/v21.0/`
- Build dynamically using **Code node** before this:

Add **Code node** (Node 4a) between Split and the FB API call:

```js
// Code node: Build FB batch request for entities in this rule
const rule = $input.item.json;
const token = rule.token;
const entities = rule.entities || [];

if (entities.length === 0) {
  return [{ json: { rule, insights: [] } }];
}

// Build batch: one request per entity for today's insights
const batch = entities.map(entityId => ({
  method: 'GET',
  relative_url: `${entityId}/insights?fields=spend,actions,action_values,purchase_roas,cost_per_action_type&date_preset=today&access_token=${token}`,
}));

return [{ json: { rule, token, batch } }];
```

**Node 5: HTTP Request** (FB batch API)
- Method: POST
- URL: `https://graph.facebook.com/v21.0/`
- Body: `batch={{ JSON.stringify($json.batch) }}&access_token={{ $json.token }}`
- Content-Type: `application/x-www-form-urlencoded`

**Node 6: Code** (evaluate conditions + check exemptions)

```js
// Evaluate all conditions for each entity
const { rule, token } = $('Code node - Build batch').item.json;
const batchResponse = $input.item.json; // array of FB API responses

const triggered = [];

for (const response of batchResponse) {
  if (response.code !== 200) continue;
  const insights = JSON.parse(response.body)?.data?.[0];
  if (!insights) continue;

  const entityId = insights.campaign_id || insights.adset_id || insights.ad_id;
  const metrics = {
    spend_today: parseFloat(insights.spend || 0),
    conversions: insights.actions?.find(a => a.action_type === 'purchase')?.value || 0,
    cpa: parseFloat(insights.cost_per_action_type?.find(a => a.action_type === 'purchase')?.value || 0),
    roas: parseFloat(insights.purchase_roas?.[0]?.value || 0),
  };

  const conditions = rule.conditions;
  const allMet = conditions.every(c => {
    const val = metrics[c.metric];
    if (val === undefined) return false;
    switch (c.operator) {
      case 'gt': return val > c.value;
      case 'lt': return val < c.value;
      case 'gte': return val >= c.value;
      case 'lte': return val <= c.value;
      case 'eq': return val === c.value;
      default: return false;
    }
  });

  if (allMet) {
    triggered.push({ rule, entityId, metrics, token });
  }
}

return triggered.map(t => ({ json: t }));
```

**Node 7: HTTP Request** (check exemption before acting)
- Method: GET
- URL: `http://localhost:6969/api/rules-engine/exemptions/check`
- Query params: `rule_id={{ $json.rule.id }}&entity_id={{ $json.entityId }}`

Add this route to `rules-engine-n8n.js`:

```js
rulesEngineN8nRouter.get('/exemptions/check', async (req, res) => {
  const { rule_id, entity_id } = req.query;
  const exempt = await RulesEngineDB.isExempt(parseInt(rule_id), entity_id);
  res.json({ exempt });
});
```

**Node 8: IF** (skip if exempt)
- Condition: `{{ $json.exempt }}` equals `false`

**Node 9: HTTP Request** (call FB API to pause/scale)

```js
// Code node before Node 9: Build FB action request
const { rule, entityId, metrics, token } = $input.item.json;

let url, method, body;

if (rule.action === 'pause') {
  url = `https://graph.facebook.com/v21.0/${entityId}`;
  method = 'POST';
  body = { status: 'PAUSED', access_token: token };
} else if (rule.action === 'scale_budget') {
  const scalePct = rule.action_params?.scale_pct || 20;
  const cap = rule.action_params?.cap || 500;
  // Note: need current budget first - simplified here
  url = `https://graph.facebook.com/v21.0/${entityId}`;
  method = 'POST';
  body = { daily_budget: Math.min(metrics.current_budget * (1 + scalePct/100), cap) * 100, access_token: token };
}

return [{ json: { rule, entityId, metrics, url, method, body, token } }];
```

**Node 10: HTTP Request** (send Telegram alert)
- Method: POST
- URL: `https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage`
- Body:
```json
{
  "chat_id": "{{ $env.TELEGRAM_CHAT_ID }}",
  "text": "🛑 {{ $json.rule.name }}\n{{ $json.entityId }}  PAUSED\nSpend: ${{ $json.metrics.spend_today }}\n{{ new Date().toLocaleTimeString('en-US', {timeZone: 'America/New_York'}) }} ET",
  "parse_mode": "HTML"
}
```

**Node 11: HTTP Request** (log to zuckcannon)
- POST `http://localhost:6969/api/rules-engine/log`
- Body: `{ rule_id, entity_type, entity_id, entity_name, action_taken, trigger_data_json, is_dry_run }`

**Node 12: HTTP Request** (set cooldown)
- POST `http://localhost:6969/api/rules-engine/exemptions`
- Body: `{ rule_id, entity_id, type: 'cooldown', cooldown_hours }`

**Error Workflow:** Add Error Trigger node → Telegram alert "⚠️ Rules loop failed: {{ $json.message }}"

- [ ] **Step 3: Add Telegram credentials in n8n**

n8n Settings → Credentials → Add → HTTP Header Auth
- Name: Telegram
- Header: Authorization (not needed — use query param in URL)

Set environment variables in n8n (Settings → Variables):
- `TELEGRAM_BOT_TOKEN` — get from @BotFather
- `TELEGRAM_CHAT_ID` — your Telegram chat ID

- [ ] **Step 4: Export workflow JSON**

In n8n: ⋮ menu → Download → Save as `n8n-workflows/rules-engine-loop.json`

- [ ] **Step 5: Test with dry run first**

Set a test rule with `is_dry_run: 1` assigned to a known campaign. Run workflow manually in n8n. Verify:
- Log entry appears in `GET /api/rules-engine/logs`
- action_taken = 'would_have_paused'
- No actual FB API pause call made (add IF node: skip FB action if `is_dry_run = 1`)

- [ ] **Step 6: Commit**

```bash
git add n8n-workflows/rules-engine-loop.json
git commit -m "feat: add n8n workflow 1 - rules engine loop (2 min)"
```

---

## Task 6: n8n Workflow 2 (Schedule Check)

**Files:**
- Create: `n8n-workflows/schedule-check.json`

- [ ] **Step 1: Create Workflow 2 in n8n**

Name: "Schedule Check"

**Node 1: Cron** — Every 1 minute

**Node 2: HTTP Request** — GET `http://localhost:6969/api/rules-engine/active-schedules`

**Node 3: Split In Batches** — batch size 1

**Node 4: Code** (evaluate schedule window)

```js
const schedule = $input.item.json;
const now = new Date(new Date().toLocaleString('en-US', { timeZone: schedule.timezone }));
const currentDay = now.getDay() || 7; // 1=Mon, 7=Sun
const currentTime = now.getHours() * 100 + now.getMinutes(); // e.g., 820 = 08:20

const [startH, startM] = schedule.start_time.split(':').map(Number);
const [endH, endM] = schedule.end_time.split(':').map(Number);
const startVal = startH * 100 + startM;
const endVal = endH * 100 + endM;

const inWindow = schedule.days.includes(currentDay)
  && currentTime >= startVal
  && currentTime < endVal;

return [{ json: { ...schedule, inWindow } }];
```

**Node 5: Split** (loop over campaign_ids for this schedule)

**Node 6: HTTP Request** (check campaign current status from FB)
- GET `https://graph.facebook.com/v21.0/{{ $json.campaignId }}?fields=status&access_token={{ $json.token }}`

**Node 7: Code** (decide action needed)

```js
const { inWindow, token } = $('Code - evaluate window').item.json;
const campaignId = $input.item.json.campaignId;
const currentStatus = $input.item.json.status; // 'ACTIVE' or 'PAUSED'

const shouldBeActive = inWindow;
const needsChange = (shouldBeActive && currentStatus === 'PAUSED')
  || (!shouldBeActive && currentStatus === 'ACTIVE');

return [{ json: { campaignId, shouldBeActive, needsChange, token } }];
```

**Node 8: IF** — condition: `needsChange = true`

**Node 9: HTTP Request** (check rule exemption — rule override)
- GET `http://localhost:6969/api/rules-engine/exemptions/check?rule_id=0&entity_id={{ $json.campaignId }}`
- rule_id=0 means "any rule-based pause" — add special handling in the endpoint

Add this to `rules-engine-n8n.js` — update the `/exemptions/check` route:

```js
rulesEngineN8nRouter.get('/exemptions/check', async (req, res) => {
  const { rule_id, entity_id } = req.query;
  let exempt;
  if (rule_id === '0') {
    // Check if any rule has exempted this entity (used by schedule check)
    const row = await db.getAsync(
      'SELECT id FROM rule_exemptions WHERE entity_id=? AND expires_at > CURRENT_TIMESTAMP',
      [entity_id]
    );
    exempt = !!row;
  } else {
    exempt = await RulesEngineDB.isExempt(parseInt(rule_id), entity_id);
  }
  res.json({ exempt });
});
```

**Node 10: IF** — skip if `exempt = true` (rule overrides schedule)

**Node 11: HTTP Request** (enable or pause campaign)
```js
// Code node: build request
const { campaignId, shouldBeActive, token } = $input.item.json;
return [{ json: {
  url: `https://graph.facebook.com/v21.0/${campaignId}`,
  body: { status: shouldBeActive ? 'ACTIVE' : 'PAUSED', access_token: token }
}}];
```

**Node 12: HTTP Request** (log to zuckcannon)
- POST `http://localhost:6969/api/rules-engine/log`

- [ ] **Step 2: Export + save**

Save as `n8n-workflows/schedule-check.json`

- [ ] **Step 3: Commit**

```bash
git add n8n-workflows/schedule-check.json
git commit -m "feat: add n8n workflow 2 - schedule check (1 min)"
```

---

## Task 7: n8n Workflow 3 (Daily Digest + Token Health)

**Files:**
- Create: `n8n-workflows/daily-digest.json`

- [ ] **Step 1: Create Workflow 3 in n8n**

Name: "Daily Digest + Token Health"

**Node 1: Cron** — Daily at 23:55 (schedule: `55 23 * * *`)

**Node 2: HTTP Request** — GET `http://localhost:6969/api/rules-engine/logs?date={{ new Date().toISOString().split('T')[0] }}`

**Node 3: Code** (aggregate stats)

```js
const logs = $input.all().map(i => i.json);
const totalSpend = 0; // Note: spend is in trigger_data_json, parse if needed
const rulesFired = logs.filter(l => l.action_taken !== 'would_have_paused').length;
const paused = logs.filter(l => l.action_taken === 'paused').length;
const scaled = logs.filter(l => l.action_taken === 'scaled').length;
const dryRun = logs.filter(l => l.is_dry_run === 1).length;

const date = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' });

return [{ json: { date, rulesFired, paused, scaled, dryRun } }];
```

**Node 4: HTTP Request** (Telegram digest)
- POST `https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage`
- Body:
```
📊 Daily Digest — {{ $json.date }}
Rules Fired: {{ $json.rulesFired }}  |  Paused: {{ $json.paused }}  |  Scaled: {{ $json.scaled }}
Dry Run: {{ $json.dryRun }}  |  System: OK
```

**Node 5: HTTP Request** — GET `http://localhost:6969/api/rules-engine/tokens`

**Node 6: Code** (check expiry)

```js
const tokens = $input.all().map(i => i.json);
const warnings = tokens.filter(t => {
  if (!t.expires_at) return false;
  const daysLeft = (new Date(t.expires_at) - new Date()) / 86400000;
  return daysLeft <= 7;
});
return warnings.map(t => ({ json: t }));
```

**Node 7: IF** — condition: items exist (warnings.length > 0)

**Node 8: HTTP Request** (Telegram token warning)
- `⚠️ Token expiring in {{ Math.ceil((new Date($json.expires_at) - new Date()) / 86400000) }} days: {{ $json.business_name }}`

- [ ] **Step 2: Export + save**

Save as `n8n-workflows/daily-digest.json`

- [ ] **Step 3: Commit**

```bash
git add n8n-workflows/daily-digest.json
git commit -m "feat: add n8n workflow 3 - daily digest and token health"
```

---

## Task 8: n8n Workflow 4 (Self-monitoring)

**Files:**
- Create: `n8n-workflows/self-monitoring.json`

- [ ] **Step 1: Create Workflow 4 in n8n**

Name: "Self-monitoring"

**Node 1: Cron** — Every 5 minutes (`*/5 * * * *`)

**Node 2: HTTP Request** (ping zuckcannon)
- GET `http://localhost:6969/api/rules-engine/health`
- Timeout: 10000ms
- On Error: Continue (handle in next node)

**Node 3: IF** — condition: `{{ $json.ok }}` equals `true`

**False branch → Node 4: HTTP Request** (Telegram alert)
- `🔴 Zuckcannon unreachable — rules engine paused\n{{ new Date().toISOString() }}`

- [ ] **Step 2: Export + save and commit**

```bash
# Save n8n-workflows/self-monitoring.json from n8n UI
git add n8n-workflows/self-monitoring.json
git commit -m "feat: add n8n workflow 4 - self-monitoring (5 min)"
```

---

## Task 9: Frontend — Rules Engine Pages

**Files:**
- Create: `public/rules-engine.js`
- Modify: `public/index.html`

- [ ] **Step 1: Add nav items to `public/index.html`**

In the sidebar navigation, add after the FB Accounts item:

```html
<a href="#rules" class="nav-item" data-page="rules">Rules</a>
<a href="#schedules" class="nav-item" data-page="schedules">Schedules</a>
<a href="#verticals" class="nav-item" data-page="verticals">Verticals</a>
<a href="#coverage" class="nav-item" data-page="coverage">Coverage</a>
<a href="#activity-log" class="nav-item" data-page="activity-log">Activity Log</a>
```

- [ ] **Step 2: Add page sections to `public/index.html`**

Add all 5 page sections. Each follows this pattern — full HTML for all sections:

```html
<!-- RULES PAGE -->
<section id="page-rules" class="page" style="display:none;">
  <div class="page-header">
    <h2>Rules</h2>
    <button id="new-rule-btn" class="btn-primary">+ New Rule</button>
  </div>
  <div id="rule-editor" class="card" style="display:none;">
    <h3 id="rule-editor-title">New Rule</h3>
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="rule-name" placeholder="e.g. Spend Cap Kill" />
    </div>
    <div class="form-group">
      <label>Scope</label>
      <select id="rule-scope">
        <option value="campaign">Campaign</option>
        <option value="adset">Ad Set</option>
        <option value="ad">Ad</option>
        <option value="account">Account</option>
      </select>
    </div>
    <div class="form-group">
      <label>Conditions</label>
      <div id="conditions-builder"></div>
      <button onclick="addCondition()" class="btn-secondary btn-sm">+ Add Condition</button>
    </div>
    <div class="form-group">
      <label>Action</label>
      <select id="rule-action">
        <option value="pause">Pause</option>
        <option value="scale_budget">Scale Budget</option>
        <option value="enable">Enable</option>
      </select>
    </div>
    <div class="form-group" id="scale-params" style="display:none;">
      <label>Scale % (e.g. 20) / Cap $</label>
      <input type="number" id="scale-pct" value="20" min="1" max="100" />
      <input type="number" id="scale-cap" value="500" min="0" />
    </div>
    <div class="form-group">
      <label>Cooldown (hours after firing)</label>
      <input type="number" id="rule-cooldown" value="4" min="0" />
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="rule-dry-run" /> Dry Run (evaluate but don't act)</label>
    </div>
    <div class="form-actions">
      <button onclick="saveRule()" class="btn-primary">Save Rule</button>
      <button onclick="closeRuleEditor()" class="btn-secondary">Cancel</button>
    </div>
  </div>

  <div class="card">
    <h3>Templates</h3>
    <div id="rule-templates" class="template-grid"></div>
  </div>

  <div class="card">
    <table id="rules-table">
      <thead>
        <tr><th>Name</th><th>Scope</th><th>Action</th><th>Status</th><th>Entities</th><th></th></tr>
      </thead>
      <tbody id="rules-body"><tr><td colspan="6">Loading...</td></tr></tbody>
    </table>
  </div>
</section>

<!-- SCHEDULES PAGE -->
<section id="page-schedules" class="page" style="display:none;">
  <div class="page-header">
    <h2>Schedules</h2>
    <button id="new-schedule-btn" class="btn-primary">+ New Schedule</button>
  </div>
  <div id="schedule-editor" class="card" style="display:none;">
    <h3>New Schedule</h3>
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="schedule-name" placeholder="e.g. Business Hours" />
    </div>
    <div class="form-group">
      <label>Days</label>
      <div class="day-picker">
        <label><input type="checkbox" value="1" /> Mon</label>
        <label><input type="checkbox" value="2" /> Tue</label>
        <label><input type="checkbox" value="3" /> Wed</label>
        <label><input type="checkbox" value="4" /> Thu</label>
        <label><input type="checkbox" value="5" /> Fri</label>
        <label><input type="checkbox" value="6" /> Sat</label>
        <label><input type="checkbox" value="7" /> Sun</label>
      </div>
    </div>
    <div class="form-group">
      <label>Hours (Eastern Time)</label>
      <input type="time" id="schedule-start" value="08:00" />
      <span>to</span>
      <input type="time" id="schedule-end" value="20:00" />
    </div>
    <div class="form-actions">
      <button onclick="saveSchedule()" class="btn-primary">Save</button>
      <button onclick="closeScheduleEditor()" class="btn-secondary">Cancel</button>
    </div>
  </div>
  <div class="card">
    <table id="schedules-table">
      <thead>
        <tr><th>Name</th><th>Days</th><th>Hours (ET)</th><th>Campaigns</th><th></th></tr>
      </thead>
      <tbody id="schedules-body"><tr><td colspan="5">Loading...</td></tr></tbody>
    </table>
  </div>
</section>

<!-- VERTICALS PAGE -->
<section id="page-verticals" class="page" style="display:none;">
  <div class="page-header">
    <h2>Verticals</h2>
    <button onclick="showAddVertical()" class="btn-primary">+ New Vertical</button>
  </div>
  <div id="vertical-editor" class="card" style="display:none;">
    <h3>New Vertical</h3>
    <input type="text" id="vertical-name" placeholder="e.g. Solar" />
    <button onclick="saveVertical()" class="btn-primary">Save</button>
  </div>
  <div class="card">
    <h3>Bulk Assign by Name Pattern</h3>
    <p>Pull all campaigns from FB cache and assign matching ones to a vertical.</p>
    <div class="form-row">
      <input type="text" id="bulk-pattern" placeholder="Name contains... (e.g. Solar)" />
      <select id="bulk-vertical-select"><option value="">Select vertical</option></select>
      <button onclick="bulkAssignByPattern()" class="btn-secondary">Preview & Assign</button>
    </div>
    <div id="bulk-preview"></div>
  </div>
  <div class="card">
    <table id="verticals-table">
      <thead>
        <tr><th>Name</th><th>Campaigns</th><th>Default Schedule</th><th></th></tr>
      </thead>
      <tbody id="verticals-body"><tr><td colspan="4">Loading...</td></tr></tbody>
    </table>
  </div>
</section>

<!-- COVERAGE PAGE -->
<section id="page-coverage" class="page" style="display:none;">
  <h2>Coverage</h2>
  <p>Campaigns not fully covered by rules or schedules.</p>
  <button onclick="loadCoverage()" class="btn-secondary">Refresh</button>
  <div class="card">
    <table id="coverage-table">
      <thead>
        <tr><th>Campaign</th><th>Missing Rule</th><th>Missing Schedule</th><th>Quick Assign</th></tr>
      </thead>
      <tbody id="coverage-body"><tr><td colspan="4">Loading...</td></tr></tbody>
    </table>
  </div>
</section>

<!-- ACTIVITY LOG PAGE -->
<section id="page-activity-log" class="page" style="display:none;">
  <h2>Activity Log</h2>
  <div class="filters">
    <input type="date" id="log-date-filter" />
    <label><input type="checkbox" id="log-dryrun-filter" /> Dry Run only</label>
    <button onclick="loadLogs()" class="btn-secondary">Filter</button>
  </div>
  <div class="card">
    <table id="logs-table">
      <thead>
        <tr><th>Time</th><th>Rule</th><th>Entity</th><th>Action</th><th>Data</th><th>Mode</th></tr>
      </thead>
      <tbody id="logs-body"><tr><td colspan="6">Loading...</td></tr></tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 3: Create `public/rules-engine.js`**

```js
// public/rules-engine.js

// ─── RULE TEMPLATES ────────────────────────────────────────────────
const RULE_TEMPLATES = [
  {
    name: 'Spend Cap Kill',
    conditions: [{ metric: 'spend_today', operator: 'gt', value: 300, lookback: 'today' }],
    action: 'pause', cooldown_hours: 4,
  },
  {
    name: 'Negative ROI Kill',
    conditions: [
      { metric: 'spend_today', operator: 'gt', value: 300, lookback: 'today' },
      { metric: 'roi', operator: 'lt', value: -0.15, lookback: 'today' },
    ],
    action: 'pause', cooldown_hours: 4,
  },
  {
    name: 'Zero Conversions Kill',
    conditions: [
      { metric: 'spend_today', operator: 'gt', value: 80, lookback: 'today' },
      { metric: 'conversions', operator: 'eq', value: 0, lookback: 'today' },
    ],
    action: 'pause', cooldown_hours: 4,
  },
  {
    name: 'CPA Cap',
    conditions: [
      { metric: 'cpa', operator: 'gt', value: 45, lookback: 'last_3d' },
      { metric: 'spend_today', operator: 'gt', value: 100, lookback: 'today' },
    ],
    action: 'pause', cooldown_hours: 8,
  },
  {
    name: 'Scale Winner',
    conditions: [
      { metric: 'cpa', operator: 'lt', value: 25, lookback: 'last_3d' },
      { metric: 'conversions', operator: 'gte', value: 5, lookback: 'last_3d' },
      { metric: 'spend_today', operator: 'gt', value: 200, lookback: 'today' },
    ],
    action: 'scale_budget', cooldown_hours: 48,
    action_params: { scale_pct: 20, cap: 500 },
  },
];

const METRICS = [
  { value: 'spend_today', label: 'Spend Today ($)' },
  { value: 'cpa', label: 'CPA ($)' },
  { value: 'roas', label: 'ROAS' },
  { value: 'roi', label: 'ROI (%)' },
  { value: 'conversions', label: 'Conversions' },
];

const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
];

let editingRuleId = null;

// ─── RULES PAGE ─────────────────────────────────────────────────────
async function loadRules() {
  const tbody = document.getElementById('rules-body');
  const res = await fetch('/api/rules-engine/ui/rules');
  const rules = await res.json();

  if (rules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No rules yet. Create one or use a template.</td></tr>';
    return;
  }

  tbody.innerHTML = rules.map(r => `
    <tr>
      <td>${r.name}</td>
      <td>${r.scope}</td>
      <td>${r.action}</td>
      <td>
        ${r.is_dry_run ? '<span class="badge badge-warning">DRY RUN</span>' : ''}
        ${r.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge">Inactive</span>'}
      </td>
      <td><button class="btn-sm" onclick="showAssignPanel(${r.id}, '${r.name}')">Assign</button></td>
      <td>
        <button class="btn-sm" onclick="editRule(${r.id})">Edit</button>
        <button class="btn-danger btn-sm" onclick="deleteRule(${r.id}, '${r.name}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function renderTemplates() {
  const container = document.getElementById('rule-templates');
  container.innerHTML = RULE_TEMPLATES.map((t, i) => `
    <div class="template-card">
      <strong>${t.name}</strong>
      <p>${t.conditions.length} condition(s) → ${t.action}</p>
      <button class="btn-secondary btn-sm" onclick="applyTemplate(${i})">Use Template</button>
    </div>
  `).join('');
}

function applyTemplate(index) {
  const t = RULE_TEMPLATES[index];
  document.getElementById('rule-name').value = t.name;
  document.getElementById('rule-action').value = t.action;
  document.getElementById('rule-cooldown').value = t.cooldown_hours;

  const builder = document.getElementById('conditions-builder');
  builder.innerHTML = '';
  t.conditions.forEach(c => addConditionRow(c));

  document.getElementById('rule-editor').style.display = 'block';
  document.getElementById('rule-editor-title').textContent = 'New Rule from Template';
  editingRuleId = null;
}

function addCondition() {
  addConditionRow({ metric: 'spend_today', operator: 'gt', value: '', lookback: 'today' });
}

function addConditionRow(c) {
  const builder = document.getElementById('conditions-builder');
  const div = document.createElement('div');
  div.className = 'condition-row';
  div.innerHTML = `
    <select class="cond-metric">
      ${METRICS.map(m => `<option value="${m.value}" ${c.metric === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
    </select>
    <select class="cond-operator">
      ${OPERATORS.map(o => `<option value="${o.value}" ${c.operator === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
    <input type="number" class="cond-value" value="${c.value}" step="any" />
    <button onclick="this.parentElement.remove()" class="btn-danger btn-sm">×</button>
  `;
  builder.appendChild(div);
}

function collectConditions() {
  return [...document.querySelectorAll('.condition-row')].map(row => ({
    metric: row.querySelector('.cond-metric').value,
    operator: row.querySelector('.cond-operator').value,
    value: parseFloat(row.querySelector('.cond-value').value),
    lookback: 'today',
  }));
}

async function saveRule() {
  const body = {
    name: document.getElementById('rule-name').value.trim(),
    scope: document.getElementById('rule-scope').value,
    conditions: collectConditions(),
    action: document.getElementById('rule-action').value,
    action_params: document.getElementById('rule-action').value === 'scale_budget'
      ? { scale_pct: parseInt(document.getElementById('scale-pct').value), cap: parseInt(document.getElementById('scale-cap').value) }
      : null,
    cooldown_hours: parseInt(document.getElementById('rule-cooldown').value),
    is_dry_run: document.getElementById('rule-dry-run').checked ? 1 : 0,
    is_active: 1,
  };

  const url = editingRuleId
    ? `/api/rules-engine/ui/rules/${editingRuleId}`
    : '/api/rules-engine/ui/rules';
  const method = editingRuleId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  if (res.ok) {
    closeRuleEditor();
    await loadRules();
  } else {
    const err = await res.json();
    alert('Failed to save rule: ' + err.error);
  }
}

async function deleteRule(id, name) {
  if (!confirm(`Delete rule "${name}"? This cannot be undone.`)) return;
  await fetch(`/api/rules-engine/ui/rules/${id}`, { method: 'DELETE' });
  await loadRules();
}

async function editRule(id) {
  const res = await fetch(`/api/rules-engine/ui/rules/${id}`);
  if (!res.ok) return;
  const rule = await res.json();
  editingRuleId = id;

  document.getElementById('rule-name').value = rule.name;
  document.getElementById('rule-scope').value = rule.scope;
  document.getElementById('rule-action').value = rule.action;
  document.getElementById('rule-cooldown').value = rule.cooldown_hours;
  document.getElementById('rule-dry-run').checked = !!rule.is_dry_run;

  const builder = document.getElementById('conditions-builder');
  builder.innerHTML = '';
  JSON.parse(rule.conditions_json).forEach(c => addConditionRow(c));

  document.getElementById('rule-editor').style.display = 'block';
  document.getElementById('rule-editor-title').textContent = 'Edit Rule';
}

function closeRuleEditor() {
  document.getElementById('rule-editor').style.display = 'none';
  editingRuleId = null;
}

// ─── SCHEDULES PAGE ─────────────────────────────────────────────────
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function loadSchedules() {
  const tbody = document.getElementById('schedules-body');
  const res = await fetch('/api/rules-engine/ui/schedules');
  const schedules = await res.json();

  if (schedules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No schedules yet.</td></tr>';
    return;
  }

  tbody.innerHTML = schedules.map(s => {
    const days = JSON.parse(s.days_json).map(d => DAY_NAMES[d]).join(', ');
    return `<tr>
      <td>${s.name}</td>
      <td>${days}</td>
      <td>${s.start_time} – ${s.end_time} ET</td>
      <td>—</td>
      <td>
        <button class="btn-danger btn-sm" onclick="deleteSchedule(${s.id}, '${s.name}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

async function saveSchedule() {
  const days = [...document.querySelectorAll('.day-picker input:checked')].map(el => parseInt(el.value));
  const body = {
    name: document.getElementById('schedule-name').value.trim(),
    days,
    start_time: document.getElementById('schedule-start').value,
    end_time: document.getElementById('schedule-end').value,
    timezone: 'America/New_York',
    is_active: 1,
  };
  const res = await fetch('/api/rules-engine/ui/schedules', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (res.ok) { closeScheduleEditor(); await loadSchedules(); }
}

async function deleteSchedule(id, name) {
  if (!confirm(`Delete schedule "${name}"?`)) return;
  await fetch(`/api/rules-engine/ui/schedules/${id}`, { method: 'DELETE' });
  await loadSchedules();
}

function closeScheduleEditor() {
  document.getElementById('schedule-editor').style.display = 'none';
}

// ─── VERTICALS PAGE ─────────────────────────────────────────────────
async function loadVerticals() {
  const tbody = document.getElementById('verticals-body');
  const res = await fetch('/api/rules-engine/ui/verticals');
  const verticals = await res.json();

  // Also populate bulk assign select
  const sel = document.getElementById('bulk-vertical-select');
  sel.innerHTML = '<option value="">Select vertical</option>' +
    verticals.map(v => `<option value="${v.name}">${v.name}</option>`).join('');

  if (verticals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No verticals yet.</td></tr>';
    return;
  }

  tbody.innerHTML = verticals.map(v => `
    <tr>
      <td>${v.name}</td>
      <td>—</td>
      <td>${v.default_schedule_id || 'None'}</td>
      <td><button class="btn-danger btn-sm" onclick="deleteVertical(${v.id}, '${v.name}')">Delete</button></td>
    </tr>
  `).join('');
}

async function saveVertical() {
  const name = document.getElementById('vertical-name').value.trim();
  if (!name) return;
  await fetch('/api/rules-engine/ui/verticals', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  document.getElementById('vertical-editor').style.display = 'none';
  await loadVerticals();
}

async function deleteVertical(id, name) {
  if (!confirm(`Delete vertical "${name}"?`)) return;
  await fetch(`/api/rules-engine/ui/verticals/${id}`, { method: 'DELETE' });
  await loadVerticals();
}

async function bulkAssignByPattern() {
  const pattern = document.getElementById('bulk-pattern').value.trim();
  const vertical = document.getElementById('bulk-vertical-select').value;
  if (!pattern || !vertical) return alert('Enter a pattern and select a vertical.');

  const preview = document.getElementById('bulk-preview');
  preview.textContent = 'Previewing...';

  const res = await fetch('/api/rules-engine/ui/campaigns/labels/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern, label_type: 'vertical', label_value: vertical }),
  });
  const data = await res.json();
  preview.textContent = `✅ Assigned ${data.matched} campaigns matching "${pattern}" to "${vertical}"`;
}

function showAddVertical() {
  document.getElementById('vertical-editor').style.display = 'block';
}

// ─── COVERAGE PAGE ───────────────────────────────────────────────────
async function loadCoverage() {
  const tbody = document.getElementById('coverage-body');
  tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
  const res = await fetch('/api/rules-engine/ui/coverage');
  const orphans = await res.json();

  if (orphans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">✅ All campaigns are covered.</td></tr>';
    return;
  }

  tbody.innerHTML = orphans.map(c => `
    <tr>
      <td>${c.name || c.id}</td>
      <td>${c.missing_rule ? '⚠️ No rule' : '✅'}</td>
      <td>${c.missing_schedule ? '⚠️ No schedule' : '✅'}</td>
      <td><button class="btn-sm" onclick="quickAssign('${c.id}')">Assign to Vertical</button></td>
    </tr>
  `).join('');
}

function quickAssign(campaignId) {
  // Simple prompt for now — could be enhanced with a modal
  const vertical = prompt('Enter vertical name to assign this campaign to:');
  if (!vertical) return;
  fetch('/api/rules-engine/ui/campaigns/labels/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern: campaignId, label_type: 'vertical', label_value: vertical }),
  }).then(() => loadCoverage());
}

// ─── ACTIVITY LOG PAGE ───────────────────────────────────────────────
async function loadLogs() {
  const tbody = document.getElementById('logs-body');
  tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';

  const date = document.getElementById('log-date-filter').value;
  const dryRunOnly = document.getElementById('log-dryrun-filter').checked;

  let url = '/api/rules-engine/ui/logs?limit=200';
  if (date) url += `&date=${date}`;

  const res = await fetch(url);
  let logs = await res.json();
  if (dryRunOnly) logs = logs.filter(l => l.is_dry_run === 1);

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No log entries found.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const time = new Date(l.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' });
    const triggerData = l.trigger_data_json
      ? Object.entries(JSON.parse(l.trigger_data_json)).map(([k,v]) => `${k}: ${v}`).join(' | ')
      : '—';
    return `<tr>
      <td>${time} ET</td>
      <td>${l.rule_id || '—'}</td>
      <td>${l.entity_name || l.entity_id}</td>
      <td>${l.action_taken}</td>
      <td><small>${triggerData}</small></td>
      <td>${l.is_dry_run ? '<span class="badge badge-warning">DRY RUN</span>' : '<span class="badge badge-success">LIVE</span>'}</td>
    </tr>`;
  }).join('');
}

// ─── PAGE INIT ───────────────────────────────────────────────────────
function initRulesPage() {
  renderTemplates();
  loadRules();
  document.getElementById('new-rule-btn').addEventListener('click', () => {
    editingRuleId = null;
    document.getElementById('rule-editor').style.display = 'block';
    document.getElementById('rule-editor-title').textContent = 'New Rule';
    document.getElementById('conditions-builder').innerHTML = '';
    document.getElementById('rule-name').value = '';
  });
  document.getElementById('rule-action').addEventListener('change', e => {
    document.getElementById('scale-params').style.display =
      e.target.value === 'scale_budget' ? 'block' : 'none';
  });
}

function initSchedulesPage() {
  loadSchedules();
  document.getElementById('new-schedule-btn').addEventListener('click', () => {
    document.getElementById('schedule-editor').style.display = 'block';
  });
}

function initVerticalsPage() { loadVerticals(); }
function initCoveragePage() { loadCoverage(); }
function initActivityLogPage() {
  document.getElementById('log-date-filter').value =
    new Date().toISOString().split('T')[0];
  loadLogs();
}

// Expose to global scope for nav switching
window.initRulesPage = initRulesPage;
window.initSchedulesPage = initSchedulesPage;
window.initVerticalsPage = initVerticalsPage;
window.initCoveragePage = initCoveragePage;
window.initActivityLogPage = initActivityLogPage;
window.addCondition = addCondition;
window.applyTemplate = applyTemplate;
window.saveRule = saveRule;
window.closeRuleEditor = closeRuleEditor;
window.editRule = editRule;
window.deleteRule = deleteRule;
window.saveSchedule = saveSchedule;
window.deleteSchedule = deleteSchedule;
window.closeScheduleEditor = closeScheduleEditor;
window.saveVertical = saveVertical;
window.deleteVertical = deleteVertical;
window.showAddVertical = showAddVertical;
window.bulkAssignByPattern = bulkAssignByPattern;
window.loadCoverage = loadCoverage;
window.quickAssign = quickAssign;
window.loadLogs = loadLogs;
```

- [ ] **Step 4: Load the script in `index.html`**

Add near the bottom of `<body>`:

```html
<script src="/rules-engine.js"></script>
```

- [ ] **Step 5: Wire page navigation in `public/script.js`**

In the page-switch handler, add cases:

```js
case 'rules':
  initRulesPage();
  break;
case 'schedules':
  initSchedulesPage();
  break;
case 'verticals':
  initVerticalsPage();
  break;
case 'coverage':
  initCoveragePage();
  break;
case 'activity-log':
  initActivityLogPage();
  break;
```

- [ ] **Step 6: Commit**

```bash
git add public/rules-engine.js public/index.html public/script.js
git commit -m "feat: add rules engine frontend pages (rules, schedules, verticals, coverage, log)"
```

---

## Task 10: Setup Checklist

- [ ] **Step 1: Add checklist to sidebar in `index.html`**

```html
<div id="setup-checklist" class="sidebar-card" style="display:none;">
  <strong>🚀 Setup Checklist</strong>
  <ul>
    <li id="check-token" class="check-item">⬜ Add FB Account token</li>
    <li id="check-vertical" class="check-item">⬜ Create a vertical</li>
    <li id="check-rule" class="check-item">⬜ Create a rule</li>
    <li id="check-schedule" class="check-item">⬜ Create a schedule</li>
  </ul>
</div>
```

- [ ] **Step 2: Add checklist logic to `public/rules-engine.js`**

Add to the file:

```js
async function updateSetupChecklist() {
  const [tokens, verticals, rules, schedules] = await Promise.all([
    fetch('/api/fb-accounts/tokens').then(r => r.json()),
    fetch('/api/rules-engine/ui/verticals').then(r => r.json()),
    fetch('/api/rules-engine/ui/rules').then(r => r.json()),
    fetch('/api/rules-engine/ui/schedules').then(r => r.json()),
  ]);

  const checks = {
    'check-token': tokens.length > 0,
    'check-vertical': verticals.length > 0,
    'check-rule': rules.length > 0,
    'check-schedule': schedules.length > 0,
  };

  let allDone = true;
  for (const [id, done] of Object.entries(checks)) {
    const el = document.getElementById(id);
    if (el) el.textContent = (done ? '✅' : '⬜') + el.textContent.slice(1);
    if (!done) allDone = false;
  }

  const checklist = document.getElementById('setup-checklist');
  if (checklist) checklist.style.display = allDone ? 'none' : 'block';
}

window.updateSetupChecklist = updateSetupChecklist;
```

Call `updateSetupChecklist()` on app init (add to existing `init()` function in `script.js`).

- [ ] **Step 3: Commit**

```bash
git add public/rules-engine.js public/index.html public/script.js
git commit -m "feat: add setup checklist to sidebar"
```

---

## Verification Checklist

Before calling this plan done:

- [ ] `npm test` — all tests pass
- [ ] `GET /api/rules-engine/health` returns `{"ok":true}`
- [ ] `GET /api/rules-engine/active-rules` returns rules with resolved entities
- [ ] Create a rule via UI → appears in table → n8n receives it in next cycle
- [ ] Create a schedule → assign to campaign → n8n enables/pauses at correct time (ET)
- [ ] Create vertical → bulk assign campaigns by name pattern → count shown
- [ ] Coverage page shows unassigned campaigns
- [ ] Activity Log shows entries after n8n fires a rule
- [ ] n8n Workflow 1 runs successfully in dry-run mode — Telegram message received
- [ ] n8n Workflow 4 (self-monitoring) alerts on health endpoint failure
- [ ] All 4 n8n workflows enabled and running on schedule
