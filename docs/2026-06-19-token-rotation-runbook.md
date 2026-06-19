# System-User Token Rotation Runbook

**Date:** 2026-06-19
**Scope:** What to do when a Business Manager (BM) system-user token is expiring or has expired on the de-facto-prod staging system (`staging-adgen.sigmagrowthpartners.com`).
**Audience:** Whoever is on call when a "Token Expiry Monitor" alert fires.

> Why this matters (memory `multi-bm-auth-goal`, `sigma1-token-blackout`): every ad write must run through a **per-BM system-user token**, never a personal OAuth identity. When a system-user token lapses, `resolveFbToken` can silently fall back to the OAuth token (`fb-token-resolver.js:22`) — i.e. bulk launches run on a **personal identity**, which is the single most dangerous ban hole. Rotate **before** expiry, not after.

---

## 0. How you find out

A token is "expiring" when its `system_users.expires_at` is within the alert window (default **7 days**). Two ways to check:

- **Automated:** the n8n **"Token Expiry Monitor"** workflow (see §5) GETs
  `/api/rules-engine/system-users/expiring?days=7` daily and alerts via Telegram if `count > 0`.
- **Manual:** hit the same endpoint yourself (needs the shared secret):

  ```bash
  curl -s -H "x-n8n-secret: $N8N_SHARED_SECRET" \
    "https://staging-adgen.sigmagrowthpartners.com/api/rules-engine/system-users/expiring?days=7" | jq
  ```

  Response (note: **the access token is never returned** — only alert metadata):

  ```json
  {
    "ok": true,
    "window_days": 7,
    "count": 1,
    "checked_at": "2026-06-19T12:00:00.000Z",
    "expiring": [
      { "fb_user_id": "...", "business_manager_id": "...", "name": "Sigma 1",
        "expires_at": "2026-06-24T00:00:00.000Z",
        "last_validated_at": "2026-06-19T...", "last_validation_ok": 1 }
    ]
  }
  ```

Each `expiring[]` entry tells you **which BM** (`business_manager_id` + `name`) and **when** (`expires_at`). That's the BM you rotate.

---

## 1. Generate a fresh system-user token (Meta side)

1. Log into **Meta Business Suite** for the affected BM (the `name` field from the alert, e.g. "Sigma 1").
2. **Business settings → Users → System users →** select the system user (its id == `fb_user_id` in the alert).
3. **Generate new token.** Select the app `781142368085268` and the same scopes the old token had (`ads_management`, `business_management`, `ads_read`). Choose the **60-day** (or never-expire, if the BM is verified) option.
4. Copy the new token. **Do not paste it into chat, tickets, or commit it.** Treat it like a password.

---

## 2. Register the new token (app side — re-runs the whole validation path)

Registration is idempotent (upserts) and **recomputes expiry from Meta's `debug_token`**, so re-registering the same `fb_user_id` simply overwrites the stored token + `expires_at`.

You must be **logged into the FB Accounts UI with an OAuth user that has admin access to that BM** (the register endpoint authorizes the BM via the OAuth user's `/me/businesses` — `fb-accounts.js:265`). Preferred path:

- **UI:** open the FB Accounts page on staging-adgen, paste the new token, submit. This calls
  `POST /api/fb-accounts/system-users/register`, which:
  1. validates via `/me` + `debug_token` (rejects `is_valid:false`),
  2. derives identity + true `expires_at` from `debug_token`,
  3. authorizes every BM in the token's scope against your OAuth `/me/businesses`,
  4. upserts `system_users` / `business_managers` / `ad_accounts`.

On success the response echoes `expires_at` — confirm it's ~60 days out.

> If you cannot use the UI, the same endpoint can be driven with a session cookie, but the UI is the supported path. There is **no** n8n/shared-secret route that accepts a raw token — by design (the secret-gated API never sees tokens).

---

## 3. Re-validate (optional but recommended)

Force a fresh validation so `last_validation_ok=1` and `expires_at` are current:

- `POST /api/fb-accounts/system-users/:fbUserId/:bmId/revalidate` (via the UI's "Revalidate" button).

This calls `debug_token` again and writes `markValidation({ ok, expires_at })` (`facebook-auth-db.js:481`).

---

## 4. Verify the rotation took

```bash
# Should now be EMPTY (or no longer list this BM) for the 7-day window:
curl -s -H "x-n8n-secret: $N8N_SHARED_SECRET" \
  "https://staging-adgen.sigmagrowthpartners.com/api/rules-engine/system-users/expiring?days=7" | jq '.expiring'

# token-health (legacy table) sanity:
curl -s -H "x-n8n-secret: $N8N_SHARED_SECRET" \
  "https://staging-adgen.sigmagrowthpartners.com/api/rules-engine/token-health" | jq
```

Confirm the rotated BM no longer appears in `expiring`, and that the rules engine still resolves a `system_user` token for that BM's campaigns (spot-check `/api/rules-engine/active-rules` — the entity tokens should be present; they are never the OAuth token).

---

## 5. n8n alert delivery (separate — see the n8n spec)

The endpoint is just the data source. Alert **delivery** lives in n8n and is currently OFF.
See the accompanying n8n spec ("Token Expiry Monitor" workflow): a daily Schedule node →
cycle-lock acquire → GET `/system-users/expiring?days=7` → IF `count > 0` → Telegram alert →
cycle-lock release. Re-enabling the Telegram node requires `TELEGRAM_BOT_TOKEN` + chat id in the
n8n environment.

---

## 6. Escalation / slow-rotation contingency

- **If the token is already expired** (not just expiring): the affected BM's writes are at risk of OAuth fallback. If you cannot rotate immediately, **pause launches on that BM's accounts** rather than let bulk creation run on a personal identity. (Strict "OAuth never in ads-ops" hard-fail is a planned blocker — `2026-06-18-go-to-prod-checklist.md` §1 — until then, manual pause is the safety net.)
- **If `register` rejects the new token** (`is_valid:false`, no `user_id`, or "no ad accounts"): re-generate in Meta — the old token may have been auto-revoked, or the system user lost its ad-account assignment. Verify `META_APP_ID` / `META_APP_SECRET` are set if `debug_token` returns nothing.
- **If the OAuth user lacks the BM** (403 from register, `Unauthorized BM(s)`): log in as an OAuth user who is an admin of that BM, then retry.

---

## Quick reference

| Thing | Value |
|---|---|
| Alert endpoint | `GET /api/rules-engine/system-users/expiring?days=7` (x-n8n-secret) |
| Default window | 7 days (`TOKEN_EXPIRY_ALERT_DAYS` overrides; `?days=` overrides that; clamped 1–90) |
| Register endpoint | `POST /api/fb-accounts/system-users/register` (OAuth-session auth) |
| Revalidate | `POST /api/fb-accounts/system-users/:fbUserId/:bmId/revalidate` |
| Shared app | `781142368085268` |
| Token table | `system_users` (per `fb_user_id` × BM); legacy `system_user_tokens` separate |
| Never exposed | `access_token` — the expiring endpoint whitelists alert-safe fields only |
