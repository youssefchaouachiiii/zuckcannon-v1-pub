// backend/routes/fb-accounts.js
import express from 'express';
import axios from 'axios';
import { FacebookAuthDB } from '../utils/facebook-auth-db.js';

export const fbAccountsRouter = express.Router();

const GRAPH_API_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ============================================================================
// Legacy /tokens routes — KEPT working. The live frontend + rules-engine setup
// checklist still call these. New /system-users/* routes live alongside below.
// ============================================================================
fbAccountsRouter.get('/tokens', async (req, res) => {
  try {
    const tokens = await FacebookAuthDB.listSystemUserTokens();
    const safe = tokens.map(({ access_token, ...rest }) => ({
      ...rest,
      token_preview: access_token.slice(0, 7) + '...',
    }));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list tokens' });
  }
});

fbAccountsRouter.post('/tokens/verify', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'access_token is required' });

  try {
    const meResponse = await axios.get(
      `https://graph.facebook.com/v25.0/me?fields=id,name&access_token=${access_token}`
    );
    const { id: businessManagerId, name: businessName } = meResponse.data;

    // Query debug_token to get actual expiry
    let expiresAt = null;
    try {
      const debugResp = await axios.get(
        `https://graph.facebook.com/v25.0/debug_token?input_token=${access_token}&access_token=${access_token}`
      );
      const expiresAtUnix = debugResp.data?.data?.expires_at;
      if (expiresAtUnix && expiresAtUnix > 0) {
        expiresAt = new Date(expiresAtUnix * 1000).toISOString();
      }
    } catch {}

    await FacebookAuthDB.saveSystemUserToken(businessManagerId, businessName, access_token, expiresAt);
    res.json({ business_manager_id: businessManagerId, business_name: businessName });
  } catch (err) {
    const message = err?.response?.data?.error?.message || 'Token verification failed';
    res.status(400).json({ error: message });
  }
});

fbAccountsRouter.delete('/tokens/:bmId', async (req, res) => {
  try {
    await FacebookAuthDB.deleteSystemUserToken(req.params.bmId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete token' });
  }
});

// ============================================================================
// System-user (server-to-server) Facebook token management (multi-BM schema).
// Mounted behind ensureAuthenticatedAPI in server.js, so req.user is the
// logged-in OAuth user.
// ============================================================================

// Meta returns numeric account_status. Translate to our enum.
// Map per Meta docs (and tolerant of unknown codes — never throws).
function mapAccountStatus(code) {
  if (code === 1) return 'active';
  if ([2, 3, 7, 8, 9].includes(code)) return 'disabled';
  if ([100, 101, 102].includes(code)) return 'restricted';
  return 'unknown';
}

// Convert Meta's debug_token unix epoch to ISO. 0 / missing means non-expiring.
function expiresAtToIso(epochSeconds) {
  if (!epochSeconds || epochSeconds <= 0) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

// Step A: identify the token holder.
async function fetchMe(accessToken) {
  const url = `${GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;
  const resp = await axios.get(url);
  return resp.data; // { id, name }
}

// Step B: discover all ad accounts + their owning BMs.
// NOTE: cap is intentional for v1 — we read a single page only. Following
// paging.next (full cursor pagination) is a follow-up; for now we warn loudly
// if the cap is hit so overflow isn't silently dropped.
async function fetchAdAccounts(accessToken) {
  const url = `${GRAPH_BASE}/me/adaccounts?fields=account_id,name,currency,timezone_name,account_status,business{id,name}&limit=500&access_token=${encodeURIComponent(accessToken)}`;
  const resp = await axios.get(url);
  if (resp.data?.paging?.next) {
    console.warn('[fb-accounts] /me/adaccounts pagination cap (limit=500) hit — additional ad accounts exist beyond the first page and were DROPPED. Full pagination is a v1 follow-up.');
  }
  return resp.data?.data || [];
}

// Step C: OAuth-user's BMs (used for authz only).
// NOTE: cap is intentional for v1 — single page only (see fetchAdAccounts).
// A dropped BM here would NOT trip the register authz check, so warn loudly.
async function fetchOauthUserBusinesses(oauthToken) {
  const url = `${GRAPH_BASE}/me/businesses?fields=id,name&limit=200&access_token=${encodeURIComponent(oauthToken)}`;
  const resp = await axios.get(url);
  if (resp.data?.paging?.next) {
    console.warn('[fb-accounts] /me/businesses pagination cap (limit=200) hit — additional business managers exist beyond the first page and were DROPPED. A dropped BM will not appear in the authz allow-list. Full pagination is a v1 follow-up.');
  }
  return resp.data?.data || [];
}

// Step D: expiry. Failure is non-fatal — return null + log.
async function fetchTokenExpiry(accessToken) {
  try {
    const url = `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`;
    const resp = await axios.get(url);
    return expiresAtToIso(resp.data?.data?.expires_at);
  } catch (err) {
    console.warn('[fb-accounts] debug_token failed; proceeding with expires_at=null:', err?.message || err);
    return null;
  }
}

// Pulls unique BMs from the ad-account list. Skips accounts without a `business`.
function collectBusinessManagers(adAccounts) {
  const bms = new Map();
  for (const acct of adAccounts) {
    if (!acct.business || !acct.business.id) continue;
    if (!bms.has(acct.business.id)) {
      bms.set(acct.business.id, { id: acct.business.id, name: acct.business.name });
    }
  }
  return bms;
}

// Step E: persist registration. All DB mutations live here so the partial-
// write boundary is explicit. The underlying upserts are idempotent, so the
// caller (or the operator) can re-run register safely.
async function persistRegistration({ me, businessManagers, adAccounts, accessToken, expiresAt }) {
  for (const bm of businessManagers) {
    await FacebookAuthDB.upsertBusinessManager({
      id: bm.id,
      name: bm.name,
      role: 'launching',
      status: 'active',
    });
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: me.id,
      business_manager_id: bm.id,
      name: me.name,
      access_token: accessToken,
      expires_at: expiresAt,
    });
    await FacebookAuthDB.markValidation({
      fb_user_id: me.id,
      business_manager_id: bm.id,
      ok: true,
      expires_at: expiresAt,
    });
  }
  await upsertAdAccountsForBm(adAccounts);
}

// Upsert ad-account rows from the Graph /me/adaccounts response. Shared by
// register (no filter — all BM-owned accounts) and revalidate (filter to one
// BM). Personal accounts (no `business`) are skipped in both cases.
async function upsertAdAccountsForBm(adAccounts, bmIdFilter = null) {
  for (const acct of adAccounts) {
    if (!acct.business || !acct.business.id) continue;
    if (bmIdFilter && acct.business.id !== bmIdFilter) continue;
    await FacebookAuthDB.upsertAdAccount({
      id: `act_${acct.account_id}`,
      account_id: String(acct.account_id),
      business_manager_id: acct.business.id,
      name: acct.name,
      currency: acct.currency || null,
      timezone_name: acct.timezone_name || null,
      status: mapAccountStatus(acct.account_status),
    });
  }
}

// ============================================================================
// POST /system-users/register
// ============================================================================
fbAccountsRouter.post('/system-users/register', async (req, res) => {
  const { access_token } = req.body || {};
  if (!access_token) {
    return res.status(400).json({ error: 'access_token is required' });
  }

  const oauthToken = req.user?.facebook_access_token;
  if (!oauthToken) {
    return res.status(401).json({
      error: 'OAuth Facebook token missing on session. Connect your Facebook account before registering a system user.',
    });
  }

  // Step A: /me
  let me;
  try {
    me = await fetchMe(access_token);
  } catch (err) {
    const message = err?.response?.data?.error?.message || 'Token verification failed (/me)';
    return res.status(400).json({ error: message });
  }

  // Step B: /me/adaccounts
  let adAccounts;
  try {
    adAccounts = await fetchAdAccounts(access_token);
  } catch (err) {
    const message = err?.response?.data?.error?.message || 'Failed to fetch ad accounts';
    return res.status(400).json({ error: message });
  }

  const bms = collectBusinessManagers(adAccounts);

  // Step C: authz via OAuth user's /me/businesses (must run before any write)
  let oauthBusinesses;
  try {
    oauthBusinesses = await fetchOauthUserBusinesses(oauthToken);
  } catch (err) {
    const message = err?.response?.data?.error?.message || 'Failed to verify OAuth user business access';
    return res.status(401).json({ error: message });
  }
  const authorizedBmIds = new Set(oauthBusinesses.map((b) => b.id));
  const rejected = [...bms.keys()].filter((id) => !authorizedBmIds.has(id));
  if (rejected.length > 0) {
    return res.status(403).json({
      error: `Unauthorized BM(s) in system user scope: ${rejected.join(', ')}. ` +
             `The logged-in OAuth user does not have admin access to these business managers.`,
      rejected_bm_ids: rejected,
    });
  }

  // Step D: expiry (non-fatal)
  const expiresAt = await fetchTokenExpiry(access_token);

  // Step E: persist. See persistRegistration for the partial-write contract.
  try {
    await persistRegistration({
      me,
      businessManagers: [...bms.values()],
      adAccounts,
      accessToken: access_token,
      expiresAt,
    });
  } catch (err) {
    console.error('[fb-accounts] DB write failed during registration:', err);
    return res.status(500).json({
      error: 'Database write failed during registration. Re-running the request is safe (upserts are idempotent).',
    });
  }

  return res.json({
    system_user: { id: me.id, name: me.name },
    business_managers: [...bms.values()],
    ad_accounts_wired: adAccounts.filter((a) => a.business && a.business.id).length,
    expires_at: expiresAt,
  });
});

// ============================================================================
// POST /system-users/:fbUserId/:bmId/revalidate
// ============================================================================
fbAccountsRouter.post('/system-users/:fbUserId/:bmId/revalidate', async (req, res) => {
  const { fbUserId, bmId } = req.params;

  const stored = await FacebookAuthDB.getSystemUserForBm(bmId);
  if (!stored || stored.fb_user_id !== fbUserId) {
    return res.status(404).json({ error: 'System user not found for this (fb_user_id, business_manager_id)' });
  }
  const accessToken = stored.access_token;

  // Step A: /me — confirms the token still resolves to the same user
  let me;
  try {
    me = await fetchMe(accessToken);
  } catch (err) {
    // Mark validation as failed so the operator sees a stale row in the UI.
    try {
      await FacebookAuthDB.markValidation({
        fb_user_id: fbUserId,
        business_manager_id: bmId,
        ok: false,
      });
    } catch (markErr) {
      console.error('[fb-accounts] markValidation(false) failed:', markErr);
    }
    const message = err?.response?.data?.error?.message || 'Token verification failed (/me)';
    return res.status(400).json({ error: message });
  }

  // Step A2: guard against token identity drift. A rotated/swapped token may
  // still be live but now resolve to a DIFFERENT user. Treat that as a
  // validation failure and bail before touching ad-account statuses.
  if (me.id !== fbUserId) {
    try {
      await FacebookAuthDB.markValidation({
        fb_user_id: fbUserId,
        business_manager_id: bmId,
        ok: false,
      });
    } catch (markErr) {
      console.error('[fb-accounts] markValidation(false) failed:', markErr);
    }
    return res.status(409).json({
      error: `token identity drift: stored ${fbUserId}, token resolves to ${me.id}`,
    });
  }

  // Step B: refresh ad-account status
  let adAccounts = [];
  try {
    adAccounts = await fetchAdAccounts(accessToken);
  } catch (err) {
    console.warn('[fb-accounts] revalidate: /me/adaccounts failed:', err?.message || err);
  }

  // Step D: expiry
  const expiresAt = await fetchTokenExpiry(accessToken);

  // Persist
  try {
    await FacebookAuthDB.markValidation({
      fb_user_id: fbUserId,
      business_manager_id: bmId,
      ok: true,
      expires_at: expiresAt,
    });

    await upsertAdAccountsForBm(adAccounts, bmId);
  } catch (err) {
    console.error('[fb-accounts] DB write failed during revalidate:', err);
    return res.status(500).json({ error: 'Database write failed during revalidate' });
  }

  return res.json({
    system_user: { id: me.id, name: me.name },
    business_managers: [{ id: bmId }],
    ad_accounts_wired: adAccounts.filter((a) => a.business && a.business.id === bmId).length,
    expires_at: expiresAt,
    validated_at: new Date().toISOString(),
  });
});

// ============================================================================
// GET /system-users
// ============================================================================
fbAccountsRouter.get('/system-users', async (_req, res) => {
  try {
    const rows = await FacebookAuthDB.listSystemUsers();
    const safe = rows.map(({ access_token, ...rest }) => ({
      ...rest,
      token_preview: access_token ? access_token.slice(0, 7) + '...' : null,
    }));
    res.json(safe);
  } catch (err) {
    console.error('[fb-accounts] listSystemUsers failed:', err);
    res.status(500).json({ error: 'Failed to list system users' });
  }
});

// ============================================================================
// DELETE /system-users/:fbUserId/:bmId  (does NOT cascade BMs / ad-accounts)
// ============================================================================
fbAccountsRouter.delete('/system-users/:fbUserId/:bmId', async (req, res) => {
  try {
    await FacebookAuthDB.deleteSystemUser(req.params.fbUserId, req.params.bmId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[fb-accounts] deleteSystemUser failed:', err);
    res.status(500).json({ error: 'Failed to delete system user' });
  }
});

// ============================================================================
// GET /business-managers   (optional ?role, ?status)
// ============================================================================
fbAccountsRouter.get('/business-managers', async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = String(req.query.role);
  if (req.query.status) filter.status = String(req.query.status);
  try {
    const rows = await FacebookAuthDB.listBusinessManagers(filter);
    res.json(rows);
  } catch (err) {
    console.error('[fb-accounts] listBusinessManagers failed:', err);
    res.status(500).json({ error: 'Failed to list business managers' });
  }
});

// ============================================================================
// GET /business-managers/:id/ad-accounts
// ============================================================================
fbAccountsRouter.get('/business-managers/:id/ad-accounts', async (req, res) => {
  try {
    const rows = await FacebookAuthDB.listAdAccountsForBm(req.params.id);
    res.json(rows);
  } catch (err) {
    console.error('[fb-accounts] listAdAccountsForBm failed:', err);
    res.status(500).json({ error: 'Failed to list ad accounts' });
  }
});
