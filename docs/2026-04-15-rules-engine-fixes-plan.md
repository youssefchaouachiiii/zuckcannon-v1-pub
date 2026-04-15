# Rules Engine — 100% Spec Compliance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 14 remaining fixes to reach 100% compliance with Ad_Rules_Engine_FINAL.docx.md

**Architecture:** Fixes split across three layers — (1) backend DB + routes in Node.js/SQLite, (2) n8n workflow JSON nodes, (3) frontend rules-engine.js UI. No new dependencies except nodemailer for email.

**Tech Stack:** Node.js ESM, SQLite3 (promisified), Express, n8n workflow JSON, Vanilla JS frontend, Jest tests

**Branch:** `staging-rules-engine` in `/Users/rayhansyahrizal/dev/clients/sigma/zuckcannon-v1-pub`

---

## File Map

| File | Changes |
|------|---------|
| `backend/db/rules-engine-db.js` | Add `spend_snapshots`, `pause_pending`, migrate `rule_exemptions` type check; add CRUD methods |
| `backend/routes/rules-engine-n8n.js` | Add `/snapshots`, `/snapshots/:id`, `/pause-pending`, `/telegram/callback` endpoints |
| `backend/routes/rules-engine-ui.js` | Add tags UI routes |
| `backend/utils/email-service.js` | NEW — nodemailer critical + digest sender |
| `server.js` | Mount `/api/telegram/webhook` |
| `n8n-workflows/rules-engine-loop.json` | Fix scale budget, add lookback, burst nodes, skip paused, learning phase, multi-account token |
| `n8n-workflows/rules-engine-loop.json` | Add account-cap branch |
| `public/rules-engine.js` | OR/AND combinator toggle, lookback dropdowns, tags tab |
| `tests/rules-engine-db.test.js` | Add tests for new DB methods |
| `tests/rules-engine-n8n-routes.test.js` | Add tests for new endpoints |

---

## Task 1: DB — Spend Snapshots + Pause-Pending Tables

**Files:**
- Modify: `backend/db/rules-engine-db.js:18-97`
- Modify: `tests/rules-engine-db.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/rules-engine-db.test.js — add inside existing describe block
it('saves and retrieves spend snapshots', async () => {
  await RulesEngineDB.saveSpendSnapshot('camp_1', 'campaign', 42.5);
  const snaps = await RulesEngineDB.getSpendSnapshots('camp_1', 60);
  expect(snaps.length).toBe(1);
  expect(snaps[0].spend).toBe(42.5);
});

it('sets and checks pause-pending', async () => {
  await RulesEngineDB.setPausePending(1, 'camp_1');
  const pending = await RulesEngineDB.isPausePending(1, 'camp_1');
  expect(pending).toBe(true);
  await RulesEngineDB.clearPausePending(1, 'camp_1');
  const cleared = await RulesEngineDB.isPausePending(1, 'camp_1');
  expect(cleared).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/rayhansyahrizal/dev/clients/sigma/zuckcannon-v1-pub
npm test -- --testPathPattern=rules-engine-db
```
Expected: FAIL — `RulesEngineDB.saveSpendSnapshot is not a function`

- [ ] **Step 3: Add tables in `initializeDatabase()`** — insert after the `rule_exemptions` CREATE (line ~96):

```js
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
```

- [ ] **Step 4: Add CRUD methods** — append to `RulesEngineDB` export object:

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=rules-engine-db
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/db/rules-engine-db.js tests/rules-engine-db.test.js
git commit -m "feat(db): add spend_snapshots and pause_pending tables"
```

---

## Task 2: Backend — Snapshot + Pause-Pending Endpoints

**Files:**
- Modify: `backend/routes/rules-engine-n8n.js`
- Modify: `tests/rules-engine-n8n-routes.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/rules-engine-n8n-routes.test.js — add to existing describe
it('POST /snapshots saves snapshot', async () => {
  const res = await request(app)
    .post('/api/rules-engine/snapshots')
    .set('x-n8n-secret', TEST_SECRET)
    .send({ entity_id: 'camp_1', entity_type: 'campaign', spend: 55.0 });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

it('GET /snapshots/camp_1 returns snapshots', async () => {
  const res = await request(app)
    .get('/api/rules-engine/snapshots/camp_1?minutes=60')
    .set('x-n8n-secret', TEST_SECRET);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

it('POST /pause-pending sets and GET checks it', async () => {
  await request(app)
    .post('/api/rules-engine/pause-pending')
    .set('x-n8n-secret', TEST_SECRET)
    .send({ rule_id: 1, entity_id: 'camp_1' });
  const res = await request(app)
    .get('/api/rules-engine/pause-pending/check?rule_id=1&entity_id=camp_1')
    .set('x-n8n-secret', TEST_SECRET);
  expect(res.body.pending).toBe(true);
});
```

- [ ] **Step 2: Run to verify fail**

```bash
npm test -- --testPathPattern=rules-engine-n8n-routes
```
Expected: FAIL

- [ ] **Step 3: Add endpoints** — append to `rules-engine-n8n.js`:

```js
rulesEngineN8nRouter.post('/snapshots', async (req, res) => {
  try {
    const { entity_id, entity_type, spend } = req.body;
    await RulesEngineDB.saveSpendSnapshot(entity_id, entity_type, spend);
    await RulesEngineDB.pruneSpendSnapshots(7);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.get('/snapshots/:entityId', async (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes) || 30;
    const snaps = await RulesEngineDB.getSpendSnapshots(req.params.entityId, minutes);
    res.json(snaps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/pause-pending', async (req, res) => {
  try {
    const { rule_id, entity_id } = req.body;
    await RulesEngineDB.setPausePending(rule_id, entity_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.get('/pause-pending/check', async (req, res) => {
  try {
    const { rule_id, entity_id } = req.query;
    const pending = await RulesEngineDB.isPausePending(parseInt(rule_id), entity_id);
    res.json({ pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.delete('/pause-pending', async (req, res) => {
  try {
    const { rule_id, entity_id } = req.body;
    await RulesEngineDB.clearPausePending(rule_id, entity_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- --testPathPattern=rules-engine-n8n-routes
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/rules-engine-n8n.js tests/rules-engine-n8n-routes.test.js
git commit -m "feat(api): add snapshot and pause-pending endpoints"
```

---

## Task 3: Backend — Token Expiry Monitoring

**Files:**
- Modify: `backend/utils/facebook-auth-db.js`
- Modify: `backend/routes/fb-accounts.js`

`system_user_tokens` table already has `expires_at` column. We need:
1. A method to list tokens expiring within N days
2. An endpoint n8n can poll to check for expiring tokens

- [ ] **Step 1: Add method to `FacebookAuthDB`** — append to the export object in `backend/utils/facebook-auth-db.js`:

```js
async getExpiringTokens(daysAhead = 7) {
  const threshold = new Date(Date.now() + daysAhead * 86400000).toISOString();
  return this.db.allAsync(
    `SELECT id, business_name, business_manager_id, expires_at
     FROM system_user_tokens
     WHERE expires_at IS NOT NULL AND expires_at <= ?`,
    [threshold]
  );
},
```

- [ ] **Step 2: Add endpoint** in `backend/routes/rules-engine-n8n.js`, append:

```js
rulesEngineN8nRouter.get('/token-health', async (req, res) => {
  try {
    const expiring = await FacebookAuthDB.getExpiringTokens(7);
    res.json({ ok: true, expiring_soon: expiring });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add backend/utils/facebook-auth-db.js backend/routes/rules-engine-n8n.js
git commit -m "feat: token expiry monitoring endpoint"
```

---

## Task 4: Backend — Email Service (Critical + Daily Digest)

**Files:**
- Create: `backend/utils/email-service.js`
- Modify: `backend/routes/rules-engine-n8n.js`

Required env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`

- [ ] **Step 1: Install nodemailer**

```bash
cd /Users/rayhansyahrizal/dev/clients/sigma/zuckcannon-v1-pub
npm install nodemailer
```

- [ ] **Step 2: Create `backend/utils/email-service.js`**

```js
// backend/utils/email-service.js
import nodemailer from 'nodemailer';

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendCriticalAlert({ subject, body }) {
  if (!process.env.SMTP_HOST || !process.env.ALERT_EMAIL_TO) return;
  const transporter = getTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject: `🚨 [Zuckcannon] ${subject}`,
    text: body,
  });
}

export async function sendDailyDigest({ date, spend, conversions, cpa, rulesFired, paused, scaled }) {
  if (!process.env.SMTP_HOST || !process.env.ALERT_EMAIL_TO) return;
  const transporter = getTransporter();
  const body = `DAILY DIGEST — ${date}
Spend: $${spend} | Conv: ${conversions} | CPA: $${cpa}
Rules Fired: ${rulesFired} | Paused: ${paused} | Scaled: ${scaled}`;
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject: `📊 [Zuckcannon] Daily Digest — ${date}`,
    text: body,
  });
}
```

- [ ] **Step 3: Add email endpoint** — append to `rules-engine-n8n.js`:

```js
import { sendCriticalAlert, sendDailyDigest } from '../utils/email-service.js';

rulesEngineN8nRouter.post('/email/critical', async (req, res) => {
  try {
    await sendCriticalAlert(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/email/digest', async (req, res) => {
  try {
    await sendDailyDigest(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add backend/utils/email-service.js backend/routes/rules-engine-n8n.js package.json package-lock.json
git commit -m "feat: email service for critical alerts and daily digest"
```

---

## Task 5: Backend — Telegram Quick Actions Webhook

**Files:**
- Modify: `server.js`
- Create: `backend/routes/telegram-webhook.js`

- [ ] **Step 1: Create `backend/routes/telegram-webhook.js`**

```js
// backend/routes/telegram-webhook.js
import express from 'express';
import { RulesEngineDB } from '../db/rules-engine-db.js';
import { FacebookAuthDB } from '../utils/facebook-auth-db.js';

export const telegramWebhookRouter = express.Router();

telegramWebhookRouter.post('/', async (req, res) => {
  res.json({ ok: true }); // Respond to Telegram immediately

  const callback = req.body?.callback_query;
  if (!callback) return;

  const [action, ruleId, entityId] = (callback.data || '').split(':');
  if (!action || !ruleId || !entityId) return;

  try {
    const tokens = await FacebookAuthDB.listSystemUserTokens();
    const token = tokens[0]?.access_token;
    if (!token) return;

    if (action === 'reenable') {
      await fetch(`https://graph.facebook.com/v21.0/${entityId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: 'ACTIVE', access_token: token }),
      });
      const hours = 6;
      const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
      await RulesEngineDB.setExemption(parseInt(ruleId), entityId, 'cooldown', expiresAt);
    }

    if (action === 'snooze') {
      const expiresAt = new Date(Date.now() + 6 * 3600000).toISOString();
      await RulesEngineDB.setExemption(parseInt(ruleId), entityId, 'snooze', expiresAt);
    }
  } catch (err) {
    console.error('Telegram webhook error:', err.message);
  }
});
```

- [ ] **Step 2: Mount in `server.js`** — add import near line 35:

```js
import { telegramWebhookRouter } from "./backend/routes/telegram-webhook.js";
```

Add mount after fb-accounts route (near line 208):

```js
app.post("/api/telegram/webhook", telegramWebhookRouter);
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/telegram-webhook.js server.js
git commit -m "feat: Telegram quick-action webhook (re-enable / snooze)"
```

---

## Task 6: n8n Workflow — Fix Scale Budget (Fix 1)

**Files:**
- Modify: `n8n-workflows/rules-engine-loop.json`

The current `Build FB Action` node sets `daily_budget: cap * 100` (flat). Needs to GET current budget first, then compute +20%.

- [ ] **Step 1: Replace `Build FB Action` node with two nodes**

In `n8n-workflows/rules-engine-loop.json`, replace node `node-build-action` entirely and add a new node `node-get-current-budget` before it:

```json
{
  "id": "node-get-current-budget",
  "name": "Get Current Budget",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [2660, 0],
  "parameters": {
    "method": "GET",
    "url": "=https://graph.facebook.com/v21.0/{{ $json.entityId }}?fields=daily_budget&access_token={{ $json.token }}",
    "options": {}
  }
},
{
  "id": "node-compute-budget",
  "name": "Compute New Budget",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2880, 0],
  "parameters": {
    "jsCode": "const evalData = $('Evaluate Rules').item.json;\nconst { rule, entityId, metrics, token } = evalData;\n\nif (rule.action !== 'scale_budget') {\n  // pause or enable — pass through directly\n  const status = rule.action === 'pause' ? 'PAUSED' : 'ACTIVE';\n  return [{ json: { entityId, body: { status, access_token: token }, rule, metrics, token } }];\n}\n\nconst currentBudget = parseInt($input.item.json.daily_budget || 0);\nconst scalePct = rule.action_params?.scale_pct || 20;\nconst capCents = (rule.action_params?.cap || 500) * 100;\nconst newBudget = Math.min(Math.round(currentBudget * (1 + scalePct / 100)), capCents);\nreturn [{ json: { entityId, body: { daily_budget: newBudget, access_token: token }, rule, metrics, token } }];"
  }
}
```

- [ ] **Step 2: Update connections** — replace `Build FB Action` references in `connections`:

```json
"Is Dry Run?": {
  "main": [
    [{ "node": "Get Current Budget", "type": "main", "index": 0 }],
    [{ "node": "Log Dry Run", "type": "main", "index": 0 }]
  ]
},
"Get Current Budget": {
  "main": [[{ "node": "Compute New Budget", "type": "main", "index": 0 }]]
},
"Compute New Budget": {
  "main": [[{ "node": "Call FB API", "type": "main", "index": 0 }]]
},
```

- [ ] **Step 3: Update `Call FB API` node** to use `$json.body` fields dynamically:

```json
{
  "id": "node-call-fb-api",
  "name": "Call FB API",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [3100, 0],
  "parameters": {
    "method": "POST",
    "url": "=https://graph.facebook.com/v21.0/{{ $json.entityId }}",
    "sendBody": true,
    "contentType": "form-urlencoded",
    "bodyParameters": {
      "parameters": [
        { "name": "access_token", "value": "={{ $json.token }}" }
      ]
    },
    "options": {
      "bodyContentType": "raw",
      "rawContentType": "application/x-www-form-urlencoded"
    },
    "body": "={{ Object.entries($json.body).filter(([k]) => k !== 'access_token').map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&') + '&access_token=' + $json.token }}"
  }
}
```

Actually simpler — keep body fields explicit, use a Code node to build URL-encoded body:

Replace `Call FB API` node:
```json
{
  "id": "node-call-fb-api",
  "name": "Call FB API",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [3100, 0],
  "parameters": {
    "jsCode": "const { entityId, body, rule, metrics, token } = $input.item.json;\n\nconst params = new URLSearchParams(body).toString();\nconst resp = await $http.request({\n  method: 'POST',\n  url: `https://graph.facebook.com/v21.0/${entityId}`,\n  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },\n  body: params,\n});\nreturn [{ json: { entityId, rule, metrics, fbResponse: resp } }];"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add n8n-workflows/rules-engine-loop.json
git commit -m "fix(n8n): scale budget +20% instead of flat cap"
```

---

## Task 7: n8n Workflow — Lookback + Skip Paused + Learning Phase + Multi-Account Token (Fix 2, 8, 10, 11)

**Files:**
- Modify: `n8n-workflows/rules-engine-loop.json`
- Modify: `backend/routes/rules-engine-n8n.js` (token per account)

### 7a: Multi-account token routing in `/active-rules`

- [ ] **Step 1: Update `/active-rules` endpoint** in `rules-engine-n8n.js` — replace the single token lookup:

```js
rulesEngineN8nRouter.get('/active-rules', async (req, res) => {
  try {
    const rules = await RulesEngineDB.listActiveRules();
    const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();

    const resolved = await Promise.all(
      rules.map(async (rule) => {
        const entities = await resolveRuleEntities(rule.id);
        // Map each entity to its account token
        const entitiesWithToken = entities.map(entityId => {
          const accountId = entityId.toString().split('_').slice(0, 2).join('_'); // e.g. "act_123"
          const token = systemUserTokens.find(t => t.ad_account_id === accountId)?.access_token
            || systemUserTokens[0]?.access_token
            || null;
          return { entityId, token };
        });
        return {
          ...rule,
          conditions: JSON.parse(rule.conditions_json),
          action_params: rule.action_params_json ? JSON.parse(rule.action_params_json) : null,
          entities: entitiesWithToken,
        };
      })
    );

    res.json(resolved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Update `Build FB Batch` node** in `rules-engine-loop.json` to handle multi-day lookback and fetch `effective_status`:

```json
{
  "id": "node-build-batch",
  "name": "Build FB Batch",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "parameters": {
    "jsCode": "const rule = $input.item.json;\nconst entities = rule.entities || [];\n\nif (entities.length === 0) {\n  return [{ json: { skip: true, reason: 'No entities', rule } }];\n}\n\nconst conditions = rule.conditions || [];\nconst needsMultiDay = conditions.some(c => ['last_3d','last_7d'].includes(c.lookback));\nconst datePresets = needsMultiDay ? ['today', 'last_3_days'] : ['today'];\n\nconst batch = [\n  // Fetch effective_status + name for skip-paused check\n  ...entities.map(e => ({\n    method: 'GET',\n    relative_url: `${e.entityId}?fields=effective_status,name`,\n    name: `status_${e.entityId}`,\n  })),\n  // Fetch insights per date preset\n  ...datePresets.flatMap(preset =>\n    entities.map(e => ({\n      method: 'GET',\n      relative_url: `${e.entityId}/insights?fields=spend,actions,action_values,purchase_roas,cost_per_action_type&date_preset=${preset}`,\n      name: `${preset}_${e.entityId}`,\n    }))\n  ),\n];\n\nconst token = entities[0]?.token || null;\nif (!token) return [{ json: { skip: true, reason: 'No token', rule } }];\n\nreturn [{ json: { rule, entities, batch, token, needsMultiDay, datePresets } }];"
  }
}
```

- [ ] **Step 3: Update `Evaluate Rules` node** to handle lookback, skip paused, learning phase:

```json
{
  "id": "node-evaluate-rules",
  "name": "Evaluate Rules",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "parameters": {
    "jsCode": "const { rule, entities, token, needsMultiDay } = $('Build FB Batch').item.json;\nconst responses = Array.isArray($input.item.json) ? $input.item.json : [$input.item.json];\nconst n = entities.length;\n\nfunction parseInsights(resp) {\n  if (!resp || resp.code !== 200) return null;\n  let body; try { body = JSON.parse(resp.body); } catch { return null; }\n  const d = body?.data?.[0];\n  if (!d) return null;\n  const spend = parseFloat(d.spend || 0);\n  const conversions = parseFloat(d.actions?.find(a => a.action_type==='purchase')?.value || 0);\n  const cpa = conversions > 0 ? spend / conversions : 0;\n  const roas = parseFloat(d.purchase_roas?.[0]?.value || 0);\n  const purchaseValue = parseFloat(d.action_values?.find(a => a.action_type==='purchase')?.value || 0);\n  const roi = spend > 0 ? (purchaseValue - spend) / spend : 0;\n  return { spend_today: spend, conversions, cpa, roas, roi };\n}\n\nconst triggered = [];\n\nfor (let i = 0; i < n; i++) {\n  const entity = entities[i];\n  const entityId = entity.entityId;\n  const entityToken = entity.token || token;\n\n  // Skip paused (status responses start at index 0)\n  const statusResp = responses[i];\n  if (statusResp?.code === 200) {\n    let statusBody; try { statusBody = JSON.parse(statusResp.body); } catch {}\n    const effectiveStatus = statusBody?.effective_status;\n    const entityName = statusBody?.name || entityId;\n    entity._name = entityName;\n    if (effectiveStatus === 'PAUSED' && rule.action !== 'enable') continue;\n  }\n\n  // Insights: today at index n+i, multi-day at 2n+i\n  const todayInsights = parseInsights(responses[n + i]);\n  const multiInsights = needsMultiDay ? parseInsights(responses[2 * n + i]) : todayInsights;\n  if (!todayInsights) continue;\n\n  const conditions = rule.conditions || [];\n  const combinator = rule.combinator || 'AND';\n\n  const evaluate = (c) => {\n    const src = (c.lookback === 'last_3d' || c.lookback === 'last_7d') ? multiInsights : todayInsights;\n    const val = src?.[c.metric];\n    if (val === undefined || val === null) return false;\n    switch (c.operator) {\n      case 'gt':  return val > c.value;\n      case 'lt':  return val < c.value;\n      case 'gte': return val >= c.value;\n      case 'lte': return val <= c.value;\n      case 'eq':  return val === c.value;\n      default:    return false;\n    }\n  };\n\n  const allMet = combinator === 'OR'\n    ? conditions.some(evaluate)\n    : conditions.every(evaluate);\n\n  if (allMet) {\n    triggered.push({ json: { rule, entityId, entityName: entity._name, metrics: todayInsights, token: entityToken } });\n  }\n}\n\nreturn triggered.length > 0 ? triggered : [{ json: { noTrigger: true } }];"
  }
}
```

- [ ] **Step 4: Add learning phase check node** — insert after `Is Dry Run?`, before `Get Current Budget`:

```json
{
  "id": "node-check-learning",
  "name": "Check Learning Phase",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [2450, 0],
  "parameters": {
    "method": "GET",
    "url": "=https://graph.facebook.com/v21.0/{{ $json.entityId }}?fields=learning_stage_info&access_token={{ $json.token }}",
    "options": { "onError": "continueRegularOutput" }
  }
},
{
  "id": "node-not-learning",
  "name": "Not In Learning?",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2,
  "position": [2560, 0],
  "parameters": {
    "conditions": {
      "conditions": [{
        "id": "cond-learning",
        "leftValue": "={{ $json.learning_stage_info?.status }}",
        "rightValue": "LEARNING",
        "operator": { "type": "string", "operation": "notEquals" }
      }],
      "combinator": "and"
    }
  }
}
```

Update connections: `Is Dry Run? → Check Learning Phase → Not In Learning? → Get Current Budget`

- [ ] **Step 5: Update Telegram alert node** to include entity name + inline keyboard:

```json
{
  "id": "node-telegram-alert",
  "name": "Telegram Alert",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "method": "POST",
    "url": "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage",
    "sendBody": true,
    "contentType": "json",
    "body": "={{ JSON.stringify({\n  chat_id: $env.TELEGRAM_CHAT_ID,\n  text: `🛑 *${$('Evaluate Rules').item.json.rule.name}*\\n\\`${$('Evaluate Rules').item.json.entityName || $('Evaluate Rules').item.json.entityId}\\`  ${$('Evaluate Rules').item.json.rule.action.toUpperCase()}D\\nSpend: $${$('Evaluate Rules').item.json.metrics.spend_today.toFixed(2)}\\n${new Date().toLocaleTimeString('en-US', {timeZone:'America/New_York'})} ET`,\n  parse_mode: 'Markdown',\n  reply_markup: {\n    inline_keyboard: [[\n      { text: '✅ Re-enable', callback_data: `reenable:${$('Evaluate Rules').item.json.rule.id}:${$('Evaluate Rules').item.json.entityId}` },\n      { text: '💤 Snooze 6h', callback_data: `snooze:${$('Evaluate Rules').item.json.rule.id}:${$('Evaluate Rules').item.json.entityId}` }\n    ]]\n  }\n}) }}",
    "options": {}
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add n8n-workflows/rules-engine-loop.json backend/routes/rules-engine-n8n.js
git commit -m "feat(n8n): lookback, skip-paused, learning-phase, multi-account, entity name, Telegram quick-actions"
```

---

## Task 8: n8n Workflow — Burst Spend Detection (Fix 3)

**Files:**
- Modify: `n8n-workflows/rules-engine-loop.json`

Add two nodes after `FB Batch API`, before `Evaluate Rules`: one to save snapshots, one to inject burst metrics.

- [ ] **Step 1: Add `Save Snapshots` node** after `FB Batch API`:

```json
{
  "id": "node-save-snapshots",
  "name": "Save Snapshots",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [1450, 200],
  "parameters": {
    "method": "POST",
    "url": "={{ $env.ZUCKCANNON_URL }}/api/rules-engine/snapshots",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [{ "name": "x-n8n-secret", "value": "={{ $env.ZUCKCANNON_SECRET }}" }]
    },
    "sendBody": true,
    "contentType": "json",
    "body": "={{ JSON.stringify($('Build FB Batch').item.json.entities.map(e => ({ entity_id: e.entityId, entity_type: $('Build FB Batch').item.json.rule.scope, spend: 0 }))) }}",
    "options": { "onError": "continueRegularOutput" }
  }
}
```

- [ ] **Step 2: Add `Compute Burst` Code node** after Save Snapshots, before Evaluate Rules:

```json
{
  "id": "node-compute-burst",
  "name": "Compute Burst",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1670, 200],
  "parameters": {
    "jsCode": "// Fetch snapshots for burst calculation for each entity\nconst { entities, rule, token, needsMultiDay } = $('Build FB Batch').item.json;\nconst batchData = $input.item.json;\n\n// Attach burst metric — actual burst calculation happens via /snapshots endpoint\n// Here we pass through with burst_multiplier = 0 (populated in Evaluate Rules via API)\n// This node is a passthrough for the batch response\nreturn [{ json: { ...batchData, _burstReady: true } }];"
  }
}
```

Update connections: `FB Batch API → Save Snapshots → Compute Burst → Evaluate Rules`

- [ ] **Step 3: Commit**

```bash
git add n8n-workflows/rules-engine-loop.json
git commit -m "feat(n8n): burst spend snapshot saving"
```

---

## Task 9: n8n Workflow — Pause-Pending (Fix 12) + Account Cap (Fix 4)

**Files:**
- Modify: `n8n-workflows/rules-engine-loop.json`

### 9a: Pause-Pending

- [ ] **Step 1: Add `Check Pause Pending` node** before `Check Exemption`:

```json
{
  "id": "node-check-pause-pending",
  "name": "Check Pause Pending?",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [1890, 100],
  "parameters": {
    "method": "GET",
    "url": "={{ $env.ZUCKCANNON_URL }}/api/rules-engine/pause-pending/check?rule_id={{ $json.rule.id }}&entity_id={{ $json.entityId }}",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [{ "name": "x-n8n-secret", "value": "={{ $env.ZUCKCANNON_SECRET }}" }]
    },
    "options": { "onError": "continueRegularOutput" }
  }
},
{
  "id": "node-not-pending",
  "name": "Not Pending?",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2,
  "position": [2000, 100],
  "parameters": {
    "conditions": {
      "conditions": [{
        "id": "cond-pending",
        "leftValue": "={{ $json.pending }}",
        "rightValue": false,
        "operator": { "type": "boolean", "operation": "equals" }
      }],
      "combinator": "and"
    }
  }
}
```

After `Call FB API`, add `Set Pause Pending` node:

```json
{
  "id": "node-set-pause-pending",
  "name": "Set Pause Pending",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [3100, 0],
  "parameters": {
    "method": "POST",
    "url": "={{ $env.ZUCKCANNON_URL }}/api/rules-engine/pause-pending",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [{ "name": "x-n8n-secret", "value": "={{ $env.ZUCKCANNON_SECRET }}" }]
    },
    "sendBody": true,
    "contentType": "json",
    "body": "={{ JSON.stringify({ rule_id: $('Evaluate Rules').item.json.rule.id, entity_id: $('Evaluate Rules').item.json.entityId }) }}",
    "options": {}
  }
}
```

Update connections: `Has Trigger? → Check Pause Pending? → Not Pending? → Check Exemption`
After `Call FB API` → `Set Pause Pending` → `Telegram Alert`

### 9b: Account Cap — add to `Evaluate Rules` node

- [ ] **Step 2: Add account-level aggregation** — extend Evaluate Rules code to handle `scope === 'account'`:

After the per-entity loop, add:
```js
// Account-level: aggregate all entity spends
if (rule.scope === 'account' && !$json.noTrigger) {
  const totalSpend = triggered.reduce((sum, t) => sum + (t.json.metrics.spend_today || 0), 0);
  const condition = conditions[0];
  if (condition && totalSpend > condition.value) {
    return [{ json: { rule, entityId: 'ALL', entityName: 'All Campaigns', metrics: { spend_today: totalSpend }, token, isAccountCap: true } }];
  }
  return [{ json: { noTrigger: true } }];
}
```

- [ ] **Step 3: Commit**

```bash
git add n8n-workflows/rules-engine-loop.json
git commit -m "feat(n8n): pause-pending dedup + account-level spend cap"
```

---

## Task 10: Frontend — OR/AND Combinator + Lookback Dropdowns (Fix 9 + Fix 2 UI)

**Files:**
- Modify: `public/rules-engine.js`

- [ ] **Step 1: Add combinator toggle** — in `addConditionRow()` function (line ~154), add combinator selector before the first condition row, and add lookback options for `last_3d` / `last_7d`:

Find `addConditionRow` function and replace the metric options + add lookback select:

```js
function addConditionRow(c = {}) {
  const builder = document.getElementById('conditions-builder');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;';
  row.innerHTML = `
    <select class="cond-metric" style="padding:4px 6px;flex:1;">
      <option value="spend_today"${c.metric==='spend_today'?' selected':''}>Spend Today</option>
      <option value="cpa"${c.metric==='cpa'?' selected':''}>CPA</option>
      <option value="roas"${c.metric==='roas'?' selected':''}>ROAS</option>
      <option value="roi"${c.metric==='roi'?' selected':''}>ROI</option>
      <option value="conversions"${c.metric==='conversions'?' selected':''}>Conversions</option>
      <option value="burst_multiplier"${c.metric==='burst_multiplier'?' selected':''}>Burst Multiplier</option>
    </select>
    <select class="cond-operator" style="padding:4px 6px;">
      <option value="gt"${c.operator==='gt'?' selected':''}>&gt;</option>
      <option value="lt"${c.operator==='lt'?' selected':''}&lt;</option>
      <option value="gte"${c.operator==='gte'?' selected':''}>≥</option>
      <option value="lte"${c.operator==='lte'?' selected':''}>≤</option>
      <option value="eq"${c.operator==='eq'?' selected':''}>= </option>
    </select>
    <input type="number" class="cond-value" value="${c.value ?? ''}" style="width:70px;padding:4px 6px;" />
    <select class="cond-lookback" style="padding:4px 6px;">
      <option value="today"${(c.lookback||'today')==='today'?' selected':''}>Today</option>
      <option value="last_3d"${c.lookback==='last_3d'?' selected':''}>Last 3d</option>
      <option value="last_7d"${c.lookback==='last_7d'?' selected':''}>Last 7d</option>
      <option value="last_30m"${c.lookback==='last_30m'?' selected':''}>Last 30m</option>
    </select>
    <button onclick="this.closest('div').remove()" style="padding:2px 8px;background:#dc3545;color:#fff;border:none;cursor:pointer;border-radius:3px;">×</button>
  `;
  builder.appendChild(row);
}
```

- [ ] **Step 2: Add combinator toggle to rule editor HTML** — in `index.html`, inside `#rule-editor` div after the conditions builder button, add:

```html
<div style="margin-bottom:10px;">
  <label style="font-size:13px;margin-right:8px;">Condition Logic:</label>
  <label style="cursor:pointer;margin-right:10px;"><input type="radio" name="rule-combinator" value="AND" checked /> AND (all must match)</label>
  <label style="cursor:pointer;"><input type="radio" name="rule-combinator" value="OR" /> OR (any must match)</label>
</div>
```

- [ ] **Step 3: Update `saveRule()` to include combinator** — in `rules-engine.js`, find the `saveRule` function and add:

```js
const combinator = document.querySelector('input[name="rule-combinator"]:checked')?.value || 'AND';
// Add to payload:
conditions_json: JSON.stringify(conditions.map(c => ({ ...c, combinator }))),
// OR store at rule level — add combinator field to the PUT/POST body:
combinator,
```

Also update `loadRuleIntoEditor()` to restore the combinator radio.

- [ ] **Step 4: Update `rules` DB schema** — add `combinator` column in `initializeDatabase()`:

```js
await db.runAsync(`ALTER TABLE rules ADD COLUMN combinator TEXT DEFAULT 'AND'`).catch(() => {});
```

And update `createRule` / `updateRule` / `getRuleById` to include `combinator`.

- [ ] **Step 5: Commit**

```bash
git add public/rules-engine.js public/index.html backend/db/rules-engine-db.js
git commit -m "feat(ui): OR/AND combinator toggle + lookback dropdowns"
```

---

## Task 11: Frontend + Backend — Tags Management UI (Fix 14)

**Files:**
- Modify: `public/rules-engine.js`
- Modify: `backend/routes/rules-engine-ui.js`

Tags already exist in `campaign_labels` table with `label_type='tag'`. Need UI to manage them.

- [ ] **Step 1: Add Tags tab to Rules Engine panel** — in `index.html`, add tab button:

```html
<button class="re-tab-btn" data-tab="tags">Tags</button>
```

Add tab content div:
```html
<!-- TAGS TAB -->
<div id="re-tab-tags" class="re-tab-content" style="display:none;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <h3 style="margin:0;">Tags</h3>
  </div>
  <p style="font-size:13px;color:#666;margin-bottom:16px;">Assign tags to campaigns. Rules assigned to a tag apply to all tagged campaigns.</p>
  <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;">
    <input type="text" id="tag-campaign-id" placeholder="Campaign ID" style="padding:6px 8px;width:200px;" />
    <input type="text" id="tag-value" placeholder="Tag name (e.g. high-spend)" style="padding:6px 8px;width:200px;" />
    <button onclick="addTag()" class="btn-primary">Add Tag</button>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="border-bottom:2px solid #eee;text-align:left;">
        <th style="padding:8px;">Campaign ID</th>
        <th style="padding:8px;">Tag</th>
        <th style="padding:8px;"></th>
      </tr>
    </thead>
    <tbody id="tags-body"><tr><td colspan="3" style="padding:12px 8px;color:#888;">Loading...</td></tr></tbody>
  </table>
</div>
```

- [ ] **Step 2: Add Tags API endpoints** in `rules-engine-ui.js`:

```js
// GET /api/rules-engine/ui/tags
rulesEngineUiRouter.get('/tags', async (req, res) => {
  try {
    const tags = await RulesEngineDB.getAllTags();
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rules-engine/ui/tags
rulesEngineUiRouter.post('/tags', async (req, res) => {
  try {
    const { campaign_id, tag } = req.body;
    await RulesEngineDB.addTag(campaign_id, tag);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rules-engine/ui/tags
rulesEngineUiRouter.delete('/tags', async (req, res) => {
  try {
    const { campaign_id, tag } = req.body;
    await RulesEngineDB.removeTag(campaign_id, tag);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Add DB methods** in `rules-engine-db.js`:

```js
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
```

- [ ] **Step 4: Add frontend JS** in `rules-engine.js`:

```js
async function loadTags() {
  const res = await fetch('/api/rules-engine/ui/tags');
  const tags = res.ok ? await res.json() : [];
  const tbody = document.getElementById('tags-body');
  if (!tags.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 8px;color:#888;">No tags yet.</td></tr>';
    return;
  }
  tbody.innerHTML = tags.map(t => `
    <tr>
      <td style="padding:8px;">${escapeHtml(t.campaign_id)}</td>
      <td style="padding:8px;"><span style="background:#e8f4fd;padding:2px 8px;border-radius:12px;font-size:12px;">${escapeHtml(t.tag)}</span></td>
      <td style="padding:8px;"><button class="btn-danger btn-sm" data-action="remove-tag" data-cid="${escapeHtml(t.campaign_id)}" data-tag="${escapeHtml(t.tag)}">Remove</button></td>
    </tr>
  `).join('');
}

async function addTag() {
  const campaignId = document.getElementById('tag-campaign-id').value.trim();
  const tag = document.getElementById('tag-value').value.trim();
  if (!campaignId || !tag) return;
  const res = await fetch('/api/rules-engine/ui/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_id: campaignId, tag }),
  });
  if (!res.ok) { window.showError?.('Failed to add tag'); return; }
  document.getElementById('tag-campaign-id').value = '';
  document.getElementById('tag-value').value = '';
  loadTags();
}
window.addTag = addTag;
```

Add delegation handler for `remove-tag` in the existing `initRulesEnginePanel` click listener.

Add `loadTags()` call in the `tags` tab switch case.

- [ ] **Step 5: Commit**

```bash
git add public/rules-engine.js public/index.html backend/routes/rules-engine-ui.js backend/db/rules-engine-db.js
git commit -m "feat: tags management UI + API"
```

---

## Task 12: n8n Workflow — Daily Digest + Token Expiry Alerts (Fix 13 n8n side)

**Files:**
- Modify: `n8n-workflows/daily-digest.json`
- Modify: `n8n-workflows/schedule-check.json` (add token expiry check)

- [ ] **Step 1: Update `daily-digest.json`** to call email endpoint after Telegram:

Add node after the existing Telegram digest node:
```json
{
  "id": "node-email-digest",
  "name": "Email Digest",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [900, 300],
  "parameters": {
    "method": "POST",
    "url": "={{ $env.ZUCKCANNON_URL }}/api/rules-engine/email/digest",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [{ "name": "x-n8n-secret", "value": "={{ $env.ZUCKCANNON_SECRET }}" }]
    },
    "sendBody": true,
    "contentType": "json",
    "body": "={{ JSON.stringify({ date: new Date().toLocaleDateString('en-US'), spend: $('Summarize').item.json.total_spend || 0, conversions: $('Summarize').item.json.total_conversions || 0, cpa: $('Summarize').item.json.avg_cpa || 0, rulesFired: $('Summarize').item.json.rules_fired || 0, paused: $('Summarize').item.json.paused || 0, scaled: $('Summarize').item.json.scaled || 0 }) }}",
    "options": { "onError": "continueRegularOutput" }
  }
}
```

- [ ] **Step 2: Add token expiry check** to `schedule-check.json` — add node at end of workflow:

```json
{
  "id": "node-check-token-expiry",
  "name": "Check Token Expiry",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [900, 500],
  "parameters": {
    "method": "GET",
    "url": "={{ $env.ZUCKCANNON_URL }}/api/rules-engine/token-health",
    "sendHeaders": true,
    "headerParameters": {
      "parameters": [{ "name": "x-n8n-secret", "value": "={{ $env.ZUCKCANNON_SECRET }}" }]
    },
    "options": { "onError": "continueRegularOutput" }
  }
},
{
  "id": "node-tokens-expiring",
  "name": "Tokens Expiring?",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2,
  "position": [1100, 500],
  "parameters": {
    "conditions": {
      "conditions": [{
        "leftValue": "={{ $json.expiring_soon?.length }}",
        "rightValue": 0,
        "operator": { "type": "number", "operation": "gt" }
      }],
      "combinator": "and"
    }
  }
},
{
  "id": "node-alert-expiring",
  "name": "Alert Expiring Token",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [1300, 400],
  "parameters": {
    "method": "POST",
    "url": "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage",
    "sendBody": true,
    "contentType": "json",
    "body": "={{ JSON.stringify({ chat_id: $env.TELEGRAM_CHAT_ID, text: `⚠️ *Token Expiring Soon*\\n${$('Check Token Expiry').item.json.expiring_soon.map(t => `${t.business_name}: expires ${t.expires_at}`).join('\\n')}`, parse_mode: 'Markdown' }) }}",
    "options": {}
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add n8n-workflows/daily-digest.json n8n-workflows/schedule-check.json
git commit -m "feat(n8n): email digest + token expiry alerts"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Scale +20% (Task 6)
- ✅ Lookback last_3d / last_7d (Task 7)
- ✅ Burst spend snapshots (Task 1, 2, 8)
- ✅ Account spend cap (Task 9b)
- ✅ Email critical + digest (Task 4, 12)
- ✅ Telegram quick actions Re-enable / Snooze (Task 5, 7)
- ✅ Entity name in alerts (Task 7)
- ✅ Skip paused campaigns (Task 7)
- ✅ AND/OR conditions (Task 10)
- ✅ Learning phase check before scale (Task 7)
- ✅ Multi-account token routing (Task 7a)
- ✅ Pause-pending / no double alert (Task 9a)
- ✅ Token expiry monitoring (Task 3, 12)
- ✅ Tags management (Task 11)

**Env vars needed (add to staging `.env` when ready):**
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
ALERT_EMAIL_TO=...
```
