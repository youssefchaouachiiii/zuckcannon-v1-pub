# Safety rails — SGP Project 6

Three rails guard every Meta write this server makes. They live in
`backend/utils/meta-guard.js` and run in a single axios request interceptor, installed once in
`server.js`, because there are ~95 Graph API call sites and a rail that has to be remembered at
each one gets skipped when someone adds number 96.

**Reads are never blocked.** The dashboard keeps working with the switch on.

---

## 1. Kill switch

One flag file. While it exists, every Meta **write** from this server is refused.

```
node scripts/kill-switch.js on --reason "act_123 throttled by Meta"
node scripts/kill-switch.js status      # exit 1 while on; also prints calls this hour
node scripts/kill-switch.js off
```

The file is `$ZUCKCANNON_KILL_SWITCH`, else `<dataDir>/KILL` (`/data/KILL` in production,
`./data/KILL` in dev and test). Read-only status is also at `GET /api/meta-guard-status`.

**Flipping it is deliberately not an API call.** It has to work when this server is wedged,
mid-deploy, or pinned by a runaway loop, which is exactly when it gets reached for. A file and a
script work then; an authenticated endpoint on the wedged process does not.

It is read **per write**, so a flip lands on the next Graph call rather than the next cycle. A
refusal surfaces as a `MetaGuardError` with `code: 'KILL_SWITCH_ON'`.

### ⭐ It also stops n8n, which the interceptor cannot touch

n8n writes to Meta **directly** — `Call FB API` (pause/enable) and `Call FB API Scale`
(`daily_budget`) both post to graph.facebook.com without passing through this server. No axios
interceptor can see them.

But every rules-engine cycle begins by asking `GET /api/rules-engine/active-rules` what to act on.
**While the switch is on, that endpoint returns `[]`.** Starved of rules, the loop evaluates
nothing and acts on nothing: no pause, no budget change, no enable.

So one flag file is the stop button for all three Meta callers, with no edit inside n8n. This is
the single most load-bearing line in the whole rail, so `guard-e2e.mjs` proves it by seeding a
real active rule first — otherwise "0 rules served" passes for the wrong reason on an empty table.

**One judgement call, flagged rather than buried:** pausing is a write, so the switch blocks it
too. Literal, and predictable under pressure, which beats a half-open switch nobody can remember
the shape of. Pausing by hand in Ads Manager is unaffected and is instant.

## 2. Hourly cap, per ad account

Sliding 60-minute window, counted per `act_<id>` parsed out of the request URL. Calls where the
account cannot be derived share an `unresolved` bucket, which is also capped.

```
META_MAX_CALLS_PER_HOUR=150     # default; 0 disables
```

Read **per call**, so the ceiling can be raised or lowered without a restart — and a restart is
the last thing you want while an account is being hammered.

**The count lives on disk** (`<dataDir>/meta-rate-window.json`, guarded by a lock file), not in
memory. pm2 runs this with `instances: 'max'` in cluster mode, so an in-process counter is really
N independent counters that each think they see the whole picture. The existing
`rate-limit-tracker.js` has that problem; this does not. The two are complementary: that one
reads Meta's own `X-Business-Use-Case-Usage` header and paces reactively, this one is a hard
ceiling.

When the window is full the call is **refused, not queued**. An HTTP request holding a connection
open for 50 minutes is worse than a clear error.

## 3. No budget or bid change on a live entity

Blocked on a node update (`POST /v25.0/<entity_id>`): `daily_budget`, `lifetime_budget`,
`bid_amount`, `bid_strategy`, `adset_bid_amounts`, `adset_budgets`, `budget_rebalance_flag`.
Checked in the JSON body, form-encoded body, `URLSearchParams`, multipart fields, and the query
string.

**Creating an entity with a budget is allowed.** A campaign cannot be created without one, and
setting it is setting the brake. Moving it afterwards is what the plan bans, because the daily
budget is what stops the bleeding when a bad number lands somewhere else. So
`POST /act_123/campaigns` with a `daily_budget` goes through; `POST /120210000000` with one does
not.

`spend_cap` is deliberately left alone — the plan names the campaign spending limit as the
sanctioned way to let something spend more, $100 at a time.

### The one exception: lowering a budget

**Rayhan's call, 2026-08-11.** A decrease can only ever reduce spend, so it is strictly less risky
than a raise. Decreases are allowed; **raises stay banned everywhere**.

The only way through is `POST /api/rules-engine/decrease-budget`:

```json
{ "entity_id": "120210000000", "entity_type": "campaign",
  "new_daily_budget_cents": 5000, "rule_id": 42, "reason": "cpa 3x target" }
```

The endpoint reads the live `daily_budget` back from Meta, refuses unless the target is strictly
lower and at or above `META_MIN_DAILY_BUDGET_CENTS` (default 100), performs the write, and records
it in `budget_history`.

**Direction is never taken on the caller's word, and that is not paranoia.** The rules engine
computes `newCents = current * (1 - pct)`, so a rule saved with `decrease_pct: -50` computes a
**50% raise** and still calls itself a decrease. A rail keyed on the action name would wave it
through. Only a fresh read of the live value settles it.

The write carries a marker (`markBudgetDecrease`) holding the value just read. The interceptor
**redoes the comparison itself**, so the marker is not a password:

- a marker whose `toCents >= fromCents` is refused
- a payload whose `daily_budget` differs from the vouched value is refused
- a `lifetime_budget` or `bid_amount` riding alongside is refused
- a malformed marker is refused rather than trusted
- the kill switch still wins over all of it

**Raises are gone at the rule layer too.** `RulesEngineDB.createRule` and `updateRule` refuse
`scale_budget` (`BUDGET_RAISE_ACTIONS` in `backend/db/rules-engine-db.js`), and `listActiveRules`
withholds any that already exist from the engine, logging what it withheld. That last part is
what matters in practice: staging has **4 pre-existing ACTIVE `scale_budget` rules** that predate
the guard and cannot be created through it.

**Automated rules are the same write, deferred.** Meta runs them for us on a schedule, so the
interceptor never sees the budget change and this is the only place it can be stopped:
`CHANGE_BUDGET` and `CHANGE_BID` are refused at rule create/update in
`backend/middleware/validation.js` (`BUDGET_MOVING_ACTIONS`, one list referenced three times).
`PAUSE`, `UNPAUSE` and `SEND_NOTIFICATION` still work.

---

## Verifying

```
npm test -- tests/meta-guard.test.js                  # 44 unit tests
node scripts/guard-e2e.mjs                            # 25 end-to-end checks
```

`guard-e2e.mjs` drives the **real** axios singleton with the **real** interceptor over the
loopback into a stub standing in for the Graph API, plus the rules API through a real express
stack. Nothing is mocked: if a guard fails to refuse, the stub records the request. That is what
caught the cap being baked in at module load, which every unit test happily passed.

## Known gaps, stated rather than implied

- **Automated rules that already exist inside Meta are not touched.** Blocking rule creation
  stops new ones; any `CHANGE_BUDGET` rule already pushed to Meta keeps running on Meta's
  schedule. Auditing and removing those is a client-system write and needs a human.
- **The `unresolved` bucket is coarse.** Writes addressed to a bare entity id (`POST /<id>`)
  carry no account in the URL, so they share one window across accounts rather than having their
  own. Conservative in the right direction, but not per-account for those calls.
- **A module imported without `server.js`** does not get the interceptor, since it is installed
  there. In production `server.js` is the entry point, so every path inherits it. A script that
  imports `meta-batch.js` directly would not, and should call `installMetaGuard(axios)` itself.
- ⚠️ **n8n still calls Meta directly for the writes themselves.** Workflow "Rules Engine Loop"
  (`8ZlqLnlpsYyOOM8P`) posts `status` and `daily_budget` straight to the Graph API. The kill switch
  now reaches it by starving `/active-rules`, so it can be **stopped** — but while the switch is
  off, those writes still bypass the hourly cap and the direction check. Repointing
  `Call FB API Scale` at `/api/rules-engine/decrease-budget` is what closes that remainder.
