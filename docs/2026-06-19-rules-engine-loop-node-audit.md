# Rules Engine Loop — Node-by-Node Audit (84 nodes)

**Workflow:** `Rules Engine Loop` (n8n id `8ZlqLnlpsYyOOM8P`). As of 2026-06-19: **`active:true`, `scheduleTrigger` every 10 min, all rules dry-run.** (See Implementation Status below.)
**Method:** single read-only DB export of the workflow JSON from the VPS → fanned 12 agents (8 detail chunks + 3 adversarial audit lenses + synthesis) over the local file. Top findings re-verified by hand against the raw export (see VERIFIED tags). Date: 2026-06-19.

> Note on naming: `Is Dry Run?` is condition `rule.is_dry_run === 0` with **TRUE → live path**, FALSE → dry-run path. So the node really means "is this a LIVE rule?". Strict number type → any non-`0` (incl. `'0'`, null, missing) routes to the **dry-run** branch (fail-safe).

---

## ⏱️ Implementation Status — updated 2026-06-19 (READ THIS FIRST)

Engine is now **`active:true`, 10-min schedule, all 19 rules dry-run.** Scheduled cycles confirmed healthy (heartbeat `cycle_ran` in `rule_logs` every ~10 min, no errors; the n8n exec list looks empty of scheduled runs only because workflow setting `saveDataSuccessExecution:"none"` — successful prod runs aren't saved, keeps the 22GB `execution_data` from bloating).

**✅ DONE & verified (DB + local tests):**
- **H2** — `Restore After Scale` carries `oldBudgetCents`/`newBudgetCents` from `$('Budget Changed?')`; `Save Budget History` URL → `={{ $env.ZUCKCANNON_URL }}/api/rules-engine/budget-history` + `x-n8n-secret` header (folds in **M5**).
- **H4** — cycle-lock leak: `onError:"continueRegularOutput"` on the 6 release-chain nodes (Build Entity Map, Classify Pull Result, Log Pull Result, Restore After Pull Log, Log Cycle, Extract Entity Names) + `Extract Entity Names` null-safe.
- **H3** — account-scope `Evaluate Rules` now respects operator/metric/combinator (mirrors entity `evaluate`; fail-closed on non-aggregatable metrics like roi/cpa) — was hardcoded `totalSpend > conditions[0].value`. *Latent:* the only account rule ("Account Spend Cap", id 18) is inactive.
- **Reactivation** — schedule 5→10 min + `activateWorkflow`.

**Related fix — Daily Sync (`Hi8mF6zR27JEFJzL`, renamed "Daily Sync — RT + FB daily ingest (1AM ET)"):**
- ✅ single-token bug fixed (per-entity `&access_token=` in each FB sub-request) · ✅ splitInBatches loop-back wired (`POST FB Daily → Split Chunks`, was processing only 1/5 chunks) → `fb_daily` coverage **2→5** campaigns. Residual gap = high-spend campaigns NOT in `campaign_labels` → **config/labeling task, not code** (see memory `rules-engine-blind-fb-daily`).

**🚫 FALSE ALARM (audit was wrong):** **M1** ("Is Dry Run? fails open to live") — actually fail-**safe**.

**⏸️ DEFERRED (user decision):** **H1** (campaign-scope skips learning gate) → build as per-rule **configurable learning-guard** with ad-set-level learning resolution, NOT a hardcoded pick. Not urgent (gate is inert/fail-open at campaign level; all dry-run).

**✅ DONE — correctness pack M3/M4/M8 (committed + DEPLOYED to live wf `8ZlqLnlpsYyOOM8P` 2026-06-19, all-dry-run):**
- **M3** `Compute Scale Budget` — explicit null/0/negative-budget no-op + non-numeric `scale_pct` (NaN) guard → never POSTs a NaN/garbage budget. (Behaviorally identical to old code on real budgets; deeper "scale re-fires every cycle with no log/cooldown" still DEFERRED — needs a graph/log edge.)
- **M4** `Compute Decrease Budget` (**Option A**) — only acts on an explicit, finite, positive `decrease_pct` (missing/non-numeric/NaN/≤0 → no-op; no more silent 50% default); `Math.min(currentCents, …)` clamp so a decrease can **never raise** the budget; null/non-numeric budget → no-op (no budget creation).
- **M8** `Expand Batch Results` + `Expand Exemption Results` — fail **CLOSED**: a missing key (partial/empty batch response) → suppress (`pending`/`exempt`=true), strict-boolean output preserved.
- Verified: 3 independent passes (5-agent reasoning review → deterministic empirical diff-test, 53k+ cases → own harness parsing the shipped code), 0 violations; `validateOnly`+post-apply grep confirm exact landing. The 2 live `n8n_validate_workflow` errors (`Email Alert` Gmail op, `Restore After Pull Log` fan-out) are **pre-existing on untouched nodes** (confirmed against the pre-edit export), not caused by this change.
- ✅ **Save Budget History "flag #1" = FALSE ALARM (verified 2026-06-19 against the live export).** The LIVE `Restore After Scale` DOES carry `oldBudgetCents/newBudgetCents` from `$('Budget Changed?')`, and LIVE `Save Budget History` reads them + uses the fixed URL `={{ $env.ZUCKCANNON_URL }}/api/rules-engine/budget-history`. H2/M5 are genuinely applied on live. The scare came from the **stale local repo export** (`n8n-workflows/rules-engine-loop.json` still had the pre-H2 `Restore After Scale` + `localhost:3000/api/n8n/...` URL); the round-1 downstream tracer read that stale file. **No code must-fix on the budget path.** Real residue: the local repo JSON is stale vs live for the H2/M5 (and likely H3/H4) nodes → re-sync repo from live to prevent future false flags.
- ⚠️ Still flagged (latent, NOT blocking): account-scope **pending** lookup keys by raw campaign `entityId` while the backend may key pause-pending by `act_` id → fail-closed could always-suppress account-scope pending — confirm/align before activating account rules (overlaps M7; account rules inactive today).

**🔴 OPEN — correctness (do before flipping off dry-run):** **M7** (account cooldown regex — latent).
**🟡 OPEN — observability/safety:** **L1** (all Telegram/email alerts DISABLED — turn ON for prod), **M2** (pull-log always 0/0), **L10** (FB total-failure swallowed), **L6** (`actionFailed` never gates).
**⚪ OPEN — cosmetic/minor:** **M6**, **L2**, **L4**, **L5**, **L7**, **L8**, **L9**, **L11–L15**.

**🏷️ NON-CODE go-prod gates:** (1) label high-spend campaigns so the engine watches them, (2) add a data-freshness guard, (3) flip rules off dry-run (LAST, after coverage verified).

Per-finding detail below (the original audit; "VERIFIED" tags = re-checked by hand).

---

## Flow (execution order)

`Every 5 Minutes` → `Acquire Cycle Lock` → `Log Cycle` (heartbeat, *before* gate) → **`Lock Acquired?`**
- TRUE → two branches: **(main)** `Get Active Rules` and **(monitor)** `Check Stale Pending`.
- FALSE → dead-end (silent cycle skip).

**Main:** `Get Active Rules` → `Dedupe Entities` → **`Has Global Data?`** (T→`FB Batch API`, F→`Build Entity Map`) → `Build Entity Map` → `Classify Pull Result` → `Log Pull Result` → `Restore After Pull Log` → **3-way fan-out**:
1. `Prepare Snapshots`→`Save Snapshots`→`Prepare Burst Check`→`Check Burst`→`Prepare Burst 1h`→`Check Burst 1h`→`Merge Burst Data`→**`Split Rules`** (loop).
2. `Check Consecutive Failures`→`Need Pull Fail Alert?`→`Check Recent Pull Alert`→`Not Yet Pull Alerted?`→`Pull Fail Alert`(DISABLED)→`Log Pull Fail Alert`→`Release Cycle Lock`.
3. `Extract Entity Names`→`Cache Entity Names`→**`Release Cycle Lock`** (the only guaranteed release in a normal cycle).

**Per-rule loop:** `Split Rules`[1] → `Evaluate Rules` → **`Has Trigger?`** (F→loop) → `Collect Batch`→`Batch Check Pending`→`Expand Batch Results`→**`Not Pending?`** (F→loop) → `Collect Exemption Batch`→`Batch Check Exemptions`→`Expand Exemption Results`→**`Not Exempt?`** (F→loop) → **`Is Dry Run?`**.
- FALSE (dry) → `Prepare Dry Run Log`→`Log Dry Run`→`Restore After Dry Run Log`→`Prepare Dry Run Alert`→`Dry Run Telegram`(DISABLED)→`Prepare Dry Run Cooldown`→`Set Dry Run Cooldown`→`Dry Run Is Critical?`→(`Dry Run Email`DISABLED)→loop.
- TRUE (live) → **`Is Campaign Scope?`** (T→`Build FB Action` **[skips learning]**; F→`Is Notify?` → notify or `Check Learning Phase`→`Restore Learning`→`Not In Learning?`→`Build FB Action`).

`Build FB Action` → **`Is Budget Action?`**
- FALSE (pause/enable) → `Call FB API`→`Restore After FB API`→`Prepare Pause Pending`→`Set Pause Pending`→`Restore After Set Pause`→`Prepare Telegram`.
- TRUE (budget) → `Fetch Current Budget`→`Restore Budget`→`Is Decrease Budget?`→(`Compute Decrease Budget`|`Compute Scale Budget`)→`Budget Changed?`→`Call FB API Scale`(LIVE)→`Restore After Scale`→`Is Decrease Action?`→`Is Dry Run Decrease?`→`Save Budget History`→`Prepare Telegram`.

**Converge:** `Prepare Telegram`→`Telegram Alert`(DISABLED)→`Is Critical?`→(`Email Alert`)→`Prepare Action Log`→`Log Action`→`Prepare Cooldown`→`Set Cooldown`→loop.

**Monitor:** `Check Stale Pending`→`Has Stale Pending?`→`Stale Pending Alert`(DISABLED)→`Release Cycle Lock`.

---

## Node-by-node

### Trigger & cycle lock
| idx | Node [type] | What it does |
|---|---|---|
| 80 | Every 5 Minutes [scheduleTrigger] | Fires every 5 min. |
| 69 | Acquire Cycle Lock [http] | POST cycle-lock/acquire `{name:'rules-engine-loop',max_age_minutes:30}`; onError continue, retry 3×. |
| 44 | Log Cycle [http] | POST static `cycle_ran` heartbeat — runs *before* the lock gate. |
| 70 | Lock Acquired? [if] | `Acquire Cycle Lock.acquired === true`; F = dead-end. |

### Data pull / dedupe / FB batch
| idx | Node [type] | What it does |
|---|---|---|
| 0 | Get Active Rules [http] | GET active-rules (+x-n8n-secret), retry 3×. |
| 81 | Dedupe Entities [code] | Dedupe → campaign/account maps; FB batch chunks ≤24; per-entity tokens + `fallbackToken`; skip sentinel if empty. |
| 82 | Has Global Data? [if] | `skip !== true`. |
| 2 | FB Batch API [http] | POST graph.facebook v25.0 batch; onError continue. |
| 83 | Build Entity Map [code] | Cursor-slice batch responses → `fbMap{eid:{status,insights}}`; `pullOk`/`pullStats`; `names`. |

### Pull-result logging + fan-out
| idx | Node [type] | What it does |
|---|---|---|
| 48 | Classify Pull Result [code] | `{pullOk,pullStats,entity_ids}` — **drops `fbResponses`**. |
| 49 | Log Pull Result [http] | POST pull log; counts `fbResponses` (now undefined → 0). |
| 50 | Restore After Pull Log [code] | Re-reads Classify; fans to 3 branches. |

### Snapshot / burst → loop entry
| idx | Node [type] | What it does |
|---|---|---|
| 3 | Prepare Snapshots [code] | `{entity_id,entity_type,spend}` + entity_ids from fbMap. |
| 4 | Save Snapshots [http] | POST snapshots (burst history). |
| 5 | Prepare Burst Check [code] | entity_ids for burst. |
| 6 | Check Burst [http] | POST burst-check (30m). |
| 61 | Prepare Burst 1h [code] | entity_ids + `minutes:60`. |
| 62 | Check Burst 1h [http] | POST burst-check (60m); onError continue. |
| 7 | Merge Burst Data [code] | Merge 30m+1h burst onto each rule (`Get Active Rules.all()`). |
| 1 | Split Rules [splitInBatches] | size 1; out[1]→Evaluate; out[0]/done → **unconnected**. |

### Per-rule evaluation & suppression gates
| idx | Node [type] | What it does |
|---|---|---|
| 8 | Evaluate Rules [code] | Core engine: FB+RT insights, `effCost=max(rtCost,spend)`, ROI/CPA/budget%/burst across today/3d/7d/30m/1h; returns triggered or `{noTrigger:true}`. |
| 9 | Has Trigger? [if] | `noTrigger !== true`. |
| 63 | Collect Batch [code] | Aggregate `[{rule_id,entity_id}]` + `_context`. |
| 64 | Batch Check Pending [http] | POST pause-pending/batch-check. |
| 65 | Expand Batch Results [code] | per-item `pending` from map (`String` key, `||false`). |
| 10 | Not Pending? [if] | `pending === false`. |
| 66 | Collect Exemption Batch [code] | Batch exemption check; account-scope regex `act_\d+` from name. |
| 67 | Batch Check Exemptions [http] | POST exemptions/batch-check. |
| 68 | Expand Exemption Results [code] | `exempt` from `rule_id:entity_id` map. |
| 11 | Not Exempt? [if] | `exempt === false`. |
| 12 | Is Dry Run? [if] | `rule.is_dry_run === 0` (strict num). TRUE→live, FALSE→dry. |

### Dry-run path
| idx | Node [type] | What it does |
|---|---|---|
| 13 | Prepare Dry Run Log [code] | `would_have_<action>d` log + `_restore`. |
| 14 | Log Dry Run [http] | POST dry-run log. |
| 15 | Restore After Dry Run Log [code] | restore `_restore`. |
| 16 | Prepare Dry Run Alert [code] | Telegram HTML + keyboard; hardcoded chat/thread. |
| 17 | Dry Run Telegram [http] **DISABLED** | sendMessage. |
| 57 | Prepare Dry Run Cooldown [code] | `cooldown_hours||0.5`. |
| 58 | Set Dry Run Cooldown [http] | POST exemptions cooldown. |
| 18 | Dry Run Is Critical? [if] | `alert_level==='critical'`. |
| 19 | Dry Run Email [gmail] **DISABLED** | Critical dry-run email. |

### Live action routing
| idx | Node [type] | What it does |
|---|---|---|
| 72 | Is Campaign Scope? [if] | `rule.scope==='campaign'`. TRUE→Build FB Action (**skips learning**). |
| 73 | Is Notify? [if] | `rule.action==='notify'`. |
| 74 | Prepare Notify Alert [code] | notify Telegram msg; hardcoded chat/thread. |
| 20 | Check Learning Phase [http] | GET learning_stage_info on `entityId`. |
| 21 | Restore Learning [code] | merge learning info (null fallback). |
| 22 | Not In Learning? [if] | `learning_stage_info?.status != 'LEARNING'`. |
| 23 | Build FB Action [code] | pause→PAUSED / enable→ACTIVE body; budget→empty body. |
| 24 | Is Budget Action? [if] | action∈{scale_budget,decrease_budget}. |

### Pause / enable
| idx | Node [type] | What it does |
|---|---|---|
| 31 | Call FB API [http] | POST status (`$json.body.status`). |
| 32 | Restore After FB API [code] | merge fbResult, set `actionFailed`. |
| 33 | Prepare Pause Pending [code] | `{rule_id,entity_id}`. |
| 34 | Set Pause Pending [http] | POST pause-pending. |
| 35 | Restore After Set Pause [code] | restore + propagate `actionFailed`. |

### Budget scale / decrease
| idx | Node [type] | What it does |
|---|---|---|
| 25 | Fetch Current Budget [http] | GET daily_budget (token in query). |
| 26 | Restore Budget [code] | merge daily_budget. |
| 75 | Is Decrease Budget? [if] | `decrease_budget`. |
| 27 | Compute Scale Budget [code] | `cents*(1+scalePct)` capped at `max_budget`; `noAction` if unchanged. |
| 76 | Compute Decrease Budget [code] | `cents*(1-decreasePct)` (default 50%) floored at `min_budget`. |
| 29 | Budget Changed? [if] | `noAction != true`. |
| 28 | Call FB API Scale [http] | POST `daily_budget=newBudgetCents` (LIVE). |
| 30 | Restore After Scale [code] | merge fbResult + actionFailed; **drops budget cents**. |
| 79 | Is Decrease Action? [if] | `decrease_budget`. |
| 77 | Is Dry Run Decrease? [if] | `is_dry_run != 1` (always true on live path). |
| 78 | Save Budget History [http] | POST `http://localhost:3000/api/n8n/budget-history` (no auth). |

### Alerts → action log → cooldown
| idx | Node [type] | What it does |
|---|---|---|
| 36 | Prepare Telegram [code] | action/burst Telegram msg; hardcoded chat/thread; reads `d.burstMetrics`. |
| 37 | Telegram Alert [http] **DISABLED** | sendMessage; onError continue. |
| 38 | Is Critical? [if] | `alert_level==='critical'`. |
| 39 | Email Alert [gmail] | critical email to info@; reads `metrics.*` unguarded. |
| 40 | Prepare Action Log [code] | `<action>d` or `<action>_failed` from `actionFailed`. |
| 41 | Log Action [http] | POST action log. |
| 42 | Prepare Cooldown [code] | account regex from name; `cooldown_hours||4`. |
| 43 | Set Cooldown [http] | POST exemptions cooldown → Split Rules. |

### Stale-pending & pull-failure monitoring
| idx | Node [type] | What it does |
|---|---|---|
| 45 | Check Stale Pending [http] | GET pause-pending/stale?minutes=10. |
| 46 | Has Stale Pending? [if] | `count > 0`. |
| 47 | Stale Pending Alert [telegram] **DISABLED** | lists ≤15 stale. |
| 51 | Check Consecutive Failures [http] | GET pull-failures/consecutive. |
| 52 | Need Pull Fail Alert? [if] | `alert === true`. |
| 53 | Check Recent Pull Alert [http] | GET logs (30-min dedupe). |
| 54 | Not Yet Pull Alerted? [if] | `(id!=null?1:0)===0`. |
| 55 | Pull Fail Alert [telegram] **DISABLED** | consecutive-failure alert. |
| 56 | Log Pull Fail Alert [http] | POST static `pull_fail_alert` log. |
| 59 | Extract Entity Names [code] | `Build Entity Map.names||[]`. |
| 60 | Cache Entity Names [http] | POST campaigns/names; onError continue. |
| 71 | Release Cycle Lock [http] | POST cycle-lock/release; onError continue. Terminal. |

---

## Issues (verified vs flagged)

### HIGH — verified by hand against the export
- **H1 — Campaign-scope live writes bypass the learning-phase gate.** `Is Campaign Scope?`[true]→`Build FB Action` directly; only the non-campaign/non-notify branch reaches `Check Learning Phase`→`Not In Learning?`. Since most rules are `scope='campaign'`, the learning check is effectively unused. (Also: `learning_stage_info` is an ad-set field, so the account-branch check is fail-open too.) *Fix:* route campaign scope through the learning gate, or move the gate upstream; query learning at ad-set level.
- **H2 — `Restore After Scale` drops `oldBudgetCents`/`newBudgetCents` → `Save Budget History` POSTs `undefined`.** jsCode rebuilds `$json` from `Evaluate Rules` (no cents); the http body templates `{{ $json.oldBudgetCents }}`/`{{ $json.newBudgetCents }}`. With retryOnFail + no onError this fails the execution. Live `decrease_budget` path only. *Fix:* carry cents through Restore, or read the Compute node directly.
- **H4 — Cycle-lock leak on any throw in the pull pipeline.** Normal cycle releases the lock via exactly one branch (`Extract Entity Names`→`Cache Entity Names`→`Release Cycle Lock`); the other two release edges sit behind disabled/dead-end branches. No error guard on `Build Entity Map`/`Classify Pull Result`/`Restore After Pull Log`/`Extract Entity Names`; a throw leaks the lock until the 30-min `max_age` (~6 skipped cycles). *Fix:* onError-continue on those code nodes, add release edges on the false branches, or merge before release; consider lower `max_age`.

### CORRECTED (audit was wrong)
- ~~M1 — "Is Dry Run? fails open to live on non-numeric/missing"~~ — **FALSE.** Strict `is_dry_run === 0` with TRUE→live means `'0'`/null/missing → FALSE → **dry-run (fail-safe)**. The gate does NOT fail open to live.

### HIGH — flagged by audit (not individually re-verified)
- **H3 — Account-scope evaluation ignores operator/metric/extra conditions** in `Evaluate Rules` (`if (condition && totalSpend > condition.value)` using only `conditions[0]`). A `roi lt -50` account rule would fire whenever `totalSpend > -50` (always). *Verify the `Evaluate Rules` account branch.*

### MEDIUM — flagged (worth confirming)
- **M2** `Classify Pull Result` drops `fbResponses` → `Log Pull Result` always records 0/0 (masks partial FB failures).
- **M3** `Compute Scale Budget` no-ops silently when campaign `daily_budget` is null (CBO/ad-set budgets).
- **M4** `Compute Decrease Budget` defaults to **50%** cut if `decrease_pct` absent; min-floor can *increase* budget.
- **M5** `Save Budget History` → hardcoded `http://localhost:3000/...`, `/api/n8n/*` not `/api/rules-engine/*`, no `x-n8n-secret`. **(localhost + cents confirmed during H2 check.)**
- **M6** `Is Dry Run Decrease?` (`is_dry_run != 1`) is dead/always-true on the live path and runs *after* the live budget POST — misleading name, not a real guard.
- **M7** Account-scope cooldown/exemption key is regex-parsed from the display name (`/\(Acct (act_\d+)\)/`); missing parenthetical → wrong-entity cooldown / silent `exempt=false`.
- **M8** Pending/exempt maps fail open on key-type miss (`map[String(id)] || false`).

### LOW / INFO (selected)
- **L1** All 5 operator-facing alert sinks DISABLED (action, dry-run, stale, pull-fail) — failures are silent. Matches the "Telegram/Email off during dev" note.
- **L2** `Log Cycle` runs before `Lock Acquired?` — inflates `cycle_ran` counts used for staleness.
- **L4** Unknown `rule.action` → `Call FB API` posts `status=undefined` live (allow-list before the call).
- **L6** `actionFailed` is recorded but never gates — pause-pending set even when the FB call failed.
- **L10** `FB Batch API` onError-continue passes an error body downstream as data → empty `fbMap`, rules silently don't trigger.
- **L14** FB `access_token` passed in query/body, not header (log exposure).
- **I1** No hardcoded FB ids/tokens anywhere — all use `v25.0/{{ $json.entityId }}` + per-item `{{ $json.token }}`. (Clean for the multi-BM token model.)
