# Rules Engine + System Users — Design Spec

**Project:** Zuckcannon v1 (Bulk Uploader)
**Date:** April 13, 2026
**Scope:** 2-week build
**Architecture:** Hybrid — n8n engine + zuckcannon UI/storage + Facebook System Users

---

## 1. What We're Building

A rules engine that watches Facebook ad campaigns and takes automated action — pause, enable, scale budgets — based on configurable conditions. Runs every 2 minutes via n8n. Managed via new pages in zuckcannon.

Simultaneously, we're migrating zuckcannon's Facebook API auth from personal OAuth tokens to **System Users** — the officially sanctioned approach for server-to-server automation. This reduces ban risk for client ad accounts.

**This is NOT a tracking platform.** No click tracking, no postback receivers, no conversion attribution. Facebook and RedTrack handle that. This reads data, evaluates conditions, takes action.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                   ZUCKCANNON                        │
│                                                     │
│  Existing: bulk upload, creative lib, campaign sync │
│                                                     │
│  New pages:                                         │
│  - FB Accounts (System User tokens)                 │
│  - Rules (CRUD + assign)                            │
│  - Schedules (CRUD + assign)                        │
│  - Verticals (grouping + campaign membership)       │
│  - Coverage (orphan campaigns)                      │
│  - Activity Log                                     │
│                                                     │
│  SQLite: existing tables + 8 new tables             │
│  Express: existing routes + /api/rules-engine/*     │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (localhost)
                       │ GET /api/rules-engine/active-rules
                       │ POST /api/rules-engine/log
┌──────────────────────▼──────────────────────────────┐
│                     N8N (self-hosted, Docker)        │
│                                                     │
│  Workflow 1 (every 2 min): Rules Engine Loop        │
│  Workflow 2 (every 1 min): Schedule Check           │
│  Workflow 3 (daily):       Digest + Token Health    │
│  Workflow 4 (every 5 min): Self-monitoring          │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS — System User token
┌──────────────────────▼──────────────────────────────┐
│              FACEBOOK MARKETING API                 │
└─────────────────────────────────────────────────────┘
```

**Principles:**
- **Zuckcannon = source of truth.** All rules, schedules, tokens stored here. UI here.
- **n8n = executor.** Reads from zuckcannon each cycle → acts → logs back. No persistent state in n8n (except spend snapshots in Workflow Static Data).
- **System User token per Business Manager.** One token covers all ad accounts within that BM. Used by both zuckcannon (creative uploads) and n8n (rules execution).

---

## 3. Facebook System Users

### What vs Current

**Current (zuckcannon):** Personal OAuth token — tied to a real person's Facebook account. If that account is flagged for unusual API activity (bulk ad creation, rapid API calls), the person's account and connected ad accounts are at risk.

**System User:** A non-human service account created inside Facebook Business Manager. Facebook officially supports this for server-to-server automation. No personal account at risk. Token can be non-expiring.

### Setup (one-time per Business Manager)

```
1. Facebook Business Manager → Business Settings → System Users
2. Create System User (Admin level)
3. Assign to all ad accounts → permission: Advertiser
4. Generate Token → scopes: ads_management, ads_read, business_management
5. Copy token

6. Zuckcannon → FB Accounts page → Add Business Manager
7. Paste token → Verify (zuckcannon calls /me to confirm + pulls accessible ad accounts)
8. Save
```

### Migration from OAuth tokens

```
Per FB API call:
  if system_user_token exists for this BM → use it
  else → fallback to OAuth token (temporary, during transition)
```

Existing functionality is not broken during migration.

---

## 4. Data Model (8 new SQLite tables)

```sql
-- 1. System User tokens (per Business Manager)
system_user_tokens
  id, business_manager_id, business_name,
  access_token, expires_at (nullable = never),
  created_at, updated_at

-- 2. Verticals (internal grouping — not a Facebook concept)
verticals
  id, name, default_schedule_id (FK, nullable)

-- 3. Rules
rules
  id, name, scope,            -- 'campaign' | 'adset' | 'ad' | 'account'
  conditions_json,            -- [{metric, operator, value, lookback}]
  action,                     -- 'pause' | 'enable' | 'scale_budget'
  action_params_json,         -- {scale_pct: 20, cap: 500}
  cooldown_hours,
  is_active, is_dry_run,
  created_at

-- 4. Rule assignments (many-to-many)
rule_assignments
  id, rule_id,
  entity_type,  -- 'campaign' | 'adset' | 'ad' | 'vertical' | 'tag' | 'account'
  entity_id,    -- FB ID, vertical_id, or tag string
  created_at

-- 5. Campaign labels (vertical + tag membership)
campaign_labels
  campaign_id, label_type, label_value
  -- ('123abc', 'vertical', 'solar')
  -- ('123abc', 'tag', 'high-spend')

-- 6. Schedules
schedules
  id, name,
  days_json,    -- [1,2,3,4,5] (Mon=1)
  start_time,   -- "08:00"
  end_time,     -- "20:00"
  timezone,     -- "America/New_York"
  is_active

-- 7. Schedule assignments
schedule_assignments
  schedule_id, campaign_id

-- 8. Activity log
rule_logs
  id, rule_id (nullable),
  entity_type, entity_id, entity_name,
  action_taken,       -- 'paused' | 'enabled' | 'scaled' | 'would_have_paused'
  trigger_data_json,  -- {spend: 347, roi: -0.22, cpa: 115}
  is_dry_run,
  created_at

-- 9. Exemptions (snooze = manual, cooldown = auto after rule fires)
rule_exemptions
  id, rule_id, entity_id,
  type,         -- 'snooze' | 'cooldown'
  expires_at,
  created_at
```

### Resolution logic (vertical + tag → campaign IDs)

`GET /api/rules-engine/active-rules` resolves assignments server-side:

```
rule_assignments forEach:
  type 'campaign'  → return entity_id directly
  type 'vertical'  → lookup campaign_labels WHERE label_type='vertical' AND label_value=entity_id
  type 'tag'       → lookup campaign_labels WHERE label_type='tag' AND label_value=entity_id
  type 'account'   → return all campaign_ids in that account

deduplicate → return flat entity list per rule
```

n8n receives a flat list. No vertical/tag logic in n8n.

---

## 5. Available Metrics + Sources

All data from Facebook Marketing API `/insights` endpoint:

| Metric | FB API Field | Notes |
|--------|-------------|-------|
| spend_today | `spend` (date_preset: today) | Near real-time (1–5 min) |
| spend_last_3d | `spend` (date_preset: last_3d) | |
| spend_last_7d | `spend` (date_preset: last_7d) | |
| conversions | `actions[purchase]` | 15–30 min lag |
| cpa | `cost_per_action_type[purchase]` | 15–30 min lag |
| roas | `purchase_roas` | 15–30 min lag |
| roi | `(action_values - spend) / spend` | Requires pixel + conversion tracking |
| burst_spend | — | Calculated from n8n Static Data snapshots |

**ROI caveat:** Only accurate if Facebook Pixel is properly tracking purchase values. If no pixel → ROI rules unavailable for that account. Fall back to ROAS or CPA rules.

---

## 6. Rule Templates (pre-built)

| Template | Conditions | Action |
|----------|-----------|--------|
| Spend Cap Kill | spend_today > $X | Pause |
| Negative ROI Kill | spend_today > $X AND roi < -Y% | Pause |
| Zero Conversions Kill | spend_today > $X AND conversions = 0 | Pause |
| CPA Cap | cpa_last_3d > $X AND spend > $Y | Pause |
| Burst Spend | spend_last_30min > Nx avg | Pause |
| Scale Winner | cpa_last_3d < $X AND conversions > Y AND spend > $Z | Scale budget +20% (cap $500) |
| Account Spend Cap | account_spend_today > $X | Pause all |

User selects template → fills in numbers → assigns → done.

---

## 7. n8n Workflows

### Workflow 1: Rules Engine Loop (every 2 min)

```
Cron (*/2)
  → GET zuckcannon/api/rules-engine/active-rules
      returns: [{rule, conditions, action, entities: [...], token}]
  → FB Batch API: pull spend + conversions for all entities (one request per account)
  → For each rule × entity:
      check rule_exemptions (snooze/cooldown) → skip if active
      check pause-pending state (Static Data) → skip if pending
      evaluate conditions
      if triggered:
        → FB API: pause / scale budget
        → set pause-pending in Static Data
        → POST /api/rules-engine/log
        → POST /api/rules-engine/exemptions (set cooldown)
        → Telegram alert
  → Error node: FB API failure → Telegram "⚠️ Rules loop error"
```

**Pause-pending:** Prevents duplicate alerts when FB API hasn't confirmed pause by next cycle. Stored in n8n Workflow Static Data `{entity_id: {status: 'pause-pending', since: timestamp}}`. Cleared once FB confirms status change.

**Burst detection:** Static Data also stores per-entity spend snapshots (every 2-min cycle). Burst = `current_spend_delta / avg_30min_spend > threshold`. No DB table needed.

### Workflow 2: Schedule Check (every 1 min)

```
Cron (*/1)
  → GET zuckcannon/api/rules-engine/active-schedules
  → Evaluate: current time (Eastern) within window?
  → Compare with current FB campaign status
  → If mismatch:
      check rule_exemptions → if campaign paused by rule → SKIP (rule overrides schedule)
      → FB API: enable or pause
      → POST /api/rules-engine/log
```

### Workflow 3: Daily Digest + Token Health (23:55 Eastern)

```
Cron
  → GET /api/rules-engine/logs?date=today → aggregate stats
  → Telegram + Email: daily digest
  → GET /api/rules-engine/tokens → check expires_at
  → If token expires within 7 days → Telegram + Email warning
```

### Workflow 4: Self-monitoring (every 5 min)

```
Cron (*/5)
  → GET zuckcannon/api/health
  → If fail/timeout → Telegram: "🔴 Zuckcannon unreachable — rules engine paused"
```

n8n runs in Docker with `restart: always` — survives server reboots automatically.

---

## 8. New Zuckcannon Routes

```
-- Called by n8n:
GET  /api/rules-engine/active-rules       resolve + return flat entity lists + tokens
GET  /api/rules-engine/active-schedules   return schedules + campaign_ids + tokens
POST /api/rules-engine/log                save rule_logs entry
POST /api/rules-engine/exemptions         set cooldown after rule fires
GET  /api/rules-engine/tokens             list tokens + expiry (for digest)
GET  /api/health                          simple 200 ping

-- Called by frontend:
CRUD /api/rules-engine/rules
CRUD /api/rules-engine/schedules
CRUD /api/rules-engine/verticals
GET  /api/rules-engine/logs               filterable activity log
GET  /api/rules-engine/coverage           campaigns without rule or schedule
POST /api/rules-engine/rules/:id/assign   bulk assign to entities
POST /api/rules-engine/campaigns/labels   assign vertical/tag to campaigns (bulk)
CRUD /api/rules-engine/tokens             System User token management
```

---

## 9. New UI Pages

### FB Accounts
- List Business Managers + token status (✅ System User / ⚠️ OAuth fallback / 🔴 Expired)
- Add: paste token → verify → shows accessible ad accounts
- Token expiry badge + renewal reminder

### Rules
- Table: name, scope, status (active/dry-run), assigned entity count
- Create/edit: name, scope, condition builder (metric + operator + value + lookback), action, cooldown
- Templates panel: 7 pre-built, fill numbers, assign
- Assign panel: multi-select campaigns / pick vertical / pick tag

### Schedules
- Table: name, days, time range, timezone, assigned campaign count
- Create/edit form
- Assign to campaigns: multi-select

### Verticals
- Table: name, default schedule, campaign count
- Manage campaigns: bulk import by naming pattern (pull all campaigns → filter by name → assign)
- Manual add/remove

### Coverage
- Campaigns without active rules → quick-assign to vertical
- Campaigns without schedule → quick-assign

### Activity Log
- Table: timestamp, rule, entity, action, trigger data
- Filter: by rule / account / date / dry-run only
- DRY RUN badge vs LIVE badge
- Accessible to all zuckcannon users in the account

---

## 10. UX Flows

### First-time Setup
Setup checklist (persists in sidebar until complete):
1. ✅ Add Business Manager System User token
2. ⬜ Create verticals
3. ⬜ Bulk-assign campaigns to verticals (by naming pattern)
4. ⬜ Create first rule (use a template)
5. ⬜ Create schedule

### New Campaign Added
```
Campaign created in FB Ads Manager
  → Zuckcannon syncs campaigns
  → Coverage page: campaign appears as orphan 🔴
  → User assigns to vertical (2 clicks)
  → Campaign inherits all vertical's rules + default schedule
```

### Rule Fires
```
n8n detects threshold breach
  → FB API: pause campaign
  → Telegram:
      🛑 Spend Cap
      Cash_Offer_CBO_April_V2  PAUSED
      Spend: $312  |  Cap: $300
      2:15 PM ET
      [Re-enable] [Snooze 6h]
  → User taps action → n8n calls zuckcannon API
```

Telegram is the primary UI for live events. Zuckcannon UI is for management and review.

### Daily Routine
```
Activity Log → check yesterday's fires
Coverage → assign any new orphan campaigns
FB Accounts → confirm all tokens green
```

---

## 11. Alerts

| Level | Telegram | Email | Examples |
|-------|----------|-------|---------|
| Critical | Always | Always | Burst spend, account cap, system down |
| Warning | Always | Optional | CPA spike, token expiring |
| Info | Always | No | Budget scaled, schedule on/off |
| Digest | Once/day | Always | End-of-day summary |

Telegram quick actions: [Re-enable] [Snooze 6h] — both call `/api/rules-engine/exemptions` via n8n webhook.

---

## 12. Things to Get Right

- **No double alerts:** pause-pending state in n8n Static Data prevents duplicate Telegram messages
- **Batch FB API calls:** pull all entities per account in one request — not one call per entity
- **Rule overrides schedule:** if a campaign was paused by a rule, schedule check skips it
- **Dry run mode:** per rule — evaluates but does not act. Logs as "would_have_paused"
- **Learning phase check:** before scaling budget, check if ad set is in FB learning phase (via API) — skip if yes
- **Eastern Time:** schedules stored as local time strings, n8n uses `America/New_York` for all comparisons, stored internally as UTC
- **Don't evaluate paused entities:** skip in rule loop if already paused by schedule
- **Activity log is shared:** all zuckcannon users in the same account can see what rules fired — transparency for team

---

## 13. Out of Scope

- RedTrack integration (cross-reference only if added later)
- Rebuilding zuckcannon's existing creative upload flow
- Multi-tenant support
- Role-based permissions for rules (all users can manage rules)
- A/B rule testing

---

## 14. Done When

| # | Criteria |
|---|---------|
| 1 | Spend rules react within 5 min. CPA/ROI within 30 min. |
| 2 | One rule covers unlimited campaigns via vertical assignment |
| 3 | Schedules turn campaigns on/off on time. Rules override schedules. |
| 4 | Telegram alerts arrive fast. No duplicates. |
| 5 | New campaign in vertical auto-covered. |
| 6 | System alerts if engine breaks. |
| 7 | All FB API calls use System User token. |
| 8 | Built in 2 weeks. |
