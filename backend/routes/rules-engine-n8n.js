// backend/routes/rules-engine-n8n.js
import express from 'express';
import { RulesEngineDB } from '../db/rules-engine-db.js';
import { resolveRuleEntities } from '../utils/rules-engine-resolver.js';
import { FacebookAuthDB } from '../utils/facebook-auth-db.js';
import { FacebookCacheDB } from '../utils/facebook-cache-db.js';
import { selectFbToken } from '../utils/fb-token-selector.js';
import { maxStalenessHours, windowFreshness } from '../utils/data-staleness.js';

export const rulesEngineN8nRouter = express.Router();

// Per-entity system-user token routing, shared by /active-rules, /active-schedules
// and /schedules/enforcement. Resolves an entity (campaign or adset id) -> its ad
// account -> BM -> system-user token via selectFbToken, memoized per account for the
// life of one request. Falls back to `defaultToken` (legacy systemUserTokens[0]) when
// the account can't be derived or no healthy system_user is registered, so single-BM
// behaviour stays byte-identical. `campaignToAccount` is an optional fast-path map
// (from already-loaded cached campaigns); when omitted, the DB lookups cover it.
function makeTokenResolver(defaultToken, campaignToAccount = {}) {
  const tokenByAccount = new Map();
  return async (entityId) => {
    const acct = campaignToAccount[entityId]
      || await FacebookCacheDB.getAccountIdForCampaign(entityId)
      || await FacebookCacheDB.getAccountIdForAdset(entityId);
    if (!acct) return defaultToken; // can't derive -> fall back (single token), no regression
    if (!tokenByAccount.has(acct)) {
      const r = await selectFbToken(null, acct);
      tokenByAccount.set(acct, (r?.type === 'system_user' && r.token) ? r.token : defaultToken);
    }
    return tokenByAccount.get(acct);
  };
}

rulesEngineN8nRouter.get('/health', async (req, res) => {
  try {
    const [lastCycleAt, lastPullSuccessAt, errorCount, tokens] = await Promise.all([
      RulesEngineDB.getLastCycleAt(),
      RulesEngineDB.getLastPullSuccessAt(),
      RulesEngineDB.getRecentErrorCount(24),
      FacebookAuthDB.listSystemUserTokens(),
    ]);
    const stale = !lastCycleAt || (Date.now() - new Date(lastCycleAt).getTime()) > 5 * 60000;
    res.json({
      ok: !stale,
      ts: new Date().toISOString(),
      last_cycle: lastCycleAt,
      last_pull_success: lastPullSuccessAt,
      stale,
      accounts: tokens.length,
      errors_24h: errorCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.get('/active-rules', async (req, res) => {
  try {
    const rules = await RulesEngineDB.listActiveRules();
    const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();
    // FIX: defaultToken must come from the maintained system_users table (where the FB
    // Accounts UI writes renewals), not the legacy/stale system_user_tokens table.
    const healthyDefault = await FacebookAuthDB.getAnyHealthySystemUser();
    const defaultToken = healthyDefault?.access_token || systemUserTokens[0]?.access_token || null;

    // Staleness threshold (hours) for the multi-day windows. Surfaced to n8n on
    // each window so the "Evaluate Rules" node can skip-and-alert instead of
    // firing last_3d/last_7d rules on stale data. Computed once per request.
    const stalenessHours = maxStalenessHours();
    const freshnessNow = new Date();

    const cachedCampaigns = await FacebookCacheDB.getCampaigns();
    await RulesEngineDB.autoAssignVerticalLabels(cachedCampaigns);
    const nameMap = Object.fromEntries(cachedCampaigns.map(c => [c.id, c.name]));

    // Per-entity system-user token routing. Each entity's token is resolved via
    // its ad account → BM → system-user (selectFbToken), memoized per account.
    // Falls back to defaultToken when the account can't be derived or no
    // system_user is registered — so single-BM stays behavior-identical.
    const campaignToAccount = Object.fromEntries(cachedCampaigns.map(c => [c.id, c.account_id]));
    const resolveEntityToken = makeTokenResolver(defaultToken, campaignToAccount);

    const rtSnaps = await RulesEngineDB.getAllRedtrackSnapshots();
    const rtByName = Object.fromEntries(rtSnaps.map(r => [r.campaign_name.trim().toLowerCase(), r]));
    // id-keyed map for the sub3 (FB campaign id) join; skip NULL-id rows so an
    // unstamped row never collides on key. Empty today (all campaign_id NULL) →
    // every lookup misses → falls back to rtByName = current behavior.
    // A renamed FB campaign can carry several RT aliases stamped to one id —
    // SUM their today numbers (plain Object.fromEntries kept only the last
    // alias, undercounting revenue/conversions for dual-name campaigns).
    const rtById = {};
    for (const r of rtSnaps) {
      if (!r.campaign_id) continue;
      const key = String(r.campaign_id);
      const acc = rtById[key];
      if (!acc) {
        rtById[key] = { ...r };
      } else {
        acc.revenue = (acc.revenue || 0) + (r.revenue || 0);
        acc.profit = (acc.profit || 0) + (r.profit || 0);
        acc.conversions = (acc.conversions || 0) + (r.conversions || 0);
        const cost = acc.revenue - acc.profit;
        acc.roi = cost > 0 ? acc.profit / cost : 0;
      }
    }

    // Verticals where lp_views isn't meaningful (redirect-link offers like
    // EDU). Rules that condition on lp_views / lp_conv_rate skip campaigns
    // labeled with these verticals — otherwise they fire on every campaign
    // since LPV is structurally undercounted there.
    const lpvOffVerticals = await RulesEngineDB.listVerticalsWithLpvOff();
    const lpvOffSet = new Set(lpvOffVerticals.map(v => v.name));
    const allVerticalLabels = await RulesEngineDB.listAllVerticalLabels();
    const campaignToVertical = Object.fromEntries(
      allVerticalLabels.map(l => [l.campaign_id, l.label_value])
    );
    const ruleUsesLpv = (rule) => {
      try {
        const conds = JSON.parse(rule.conditions_json || '[]');
        return conds.some(c => c.metric === 'lp_views' || c.metric === 'lp_conv_rate');
      } catch { return false; }
    };
    const filterLpvBlocked = (rule, entityIds) => {
      if (!ruleUsesLpv(rule) || lpvOffSet.size === 0) return entityIds;
      return entityIds.filter(id => !lpvOffSet.has(campaignToVertical[id]));
    };

    const resolvePerCampaignEntities = async (entityIds) => {
      return Promise.all(entityIds.map(async (entityId) => {
        const entityName = nameMap[entityId] || entityId;
        const nameLower = entityName.trim().toLowerCase();
        // id-first (sub3 == FB campaign id), name fallback. With no stamped ids
        // rtById is empty → resolves by name exactly as before.
        const rt = rtById[String(entityId)] ?? rtByName[nameLower] ?? null;

        const [fb3d, rt3d, fb7d, rt7d, rt3dMax, fb3dMax, rt7dMax, fb7dMax] = await Promise.all([
          RulesEngineDB.getFbDailyWindow(entityId, 3),
          RulesEngineDB.getRtDailyByIdWindow(entityId, nameLower, 3),
          RulesEngineDB.getFbDailyWindow(entityId, 7),
          RulesEngineDB.getRtDailyByIdWindow(entityId, nameLower, 7),
          RulesEngineDB.getRtDailyByIdMaxDate(entityId, nameLower, 3),
          RulesEngineDB.getFbDailyMaxDate(entityId, 3),
          RulesEngineDB.getRtDailyByIdMaxDate(entityId, nameLower, 7),
          RulesEngineDB.getFbDailyMaxDate(entityId, 7),
        ]);
        // Freshest date across whichever source(s) fed each window. The window
        // is only as fresh as its NEWEST row, so take the later of the two.
        const newerDate = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
        const max3d = newerDate(rt3dMax, fb3dMax);
        const max7d = newerDate(rt7dMax, fb7dMax);

        const mergeWindow = (fb, rt) => {
          if (!fb && !rt) return null;
          const fbObj = fb || {};
          const rtCost = rt ? (rt.cost || 0) : 0;
          const fbSpend = fbObj.spend || 0;
          const conversions = rt ? (rt.conversions || 0) : (fbObj.conversions || 0);
          // No data anywhere → return null so rules silently skip instead of
          // evaluating against zeros (prevents false fires when fb_daily is
          // stale and RT has no row either).
          if (rtCost === 0 && fbSpend === 0 && conversions === 0) return null;
          // Conservative cost floor: max(RT cost, FB gross spend). RT cost
          // covers only tracked-click spend and structurally understates FB
          // gross (~7% for LP funnels, ~30% for redirect-link EDU), which
          // inflated 3d/7d ROI and understated CPA on those campaigns. Mirrors
          // the today path; degrades gracefully — if fb_daily is partial
          // (fbSpend 0) it uses rtCost, and the guard above handles all-zero.
          const spend = Math.max(rtCost, fbSpend);
          const revenue = rt ? (rt.revenue || 0) : (fbObj.revenue || 0);
          const profit = revenue - spend;
          const roi = spend > 0 ? profit / spend : 0;
          const cpa = conversions > 0 ? spend / conversions : 0;
          const link_clicks = fbObj.link_clicks || 0;
          const lp_views = fbObj.lp_views || 0;
          return {
            spend, conversions, revenue, profit, roi, cpa,
            ctr: fbObj.ctr || 0,
            cpc: fbObj.cpc || 0,
            frequency: fbObj.frequency || 0,
            link_clicks,
            lp_views,
            initiate_checkout: fbObj.initiate_checkout || 0,
            outbound_clicks_ctr: fbObj.outbound_clicks || 0,
            lp_conv_rate: link_clicks > 0 ? (lp_views / link_clicks) * 100 : 0,
          };
        };

        // Attach freshness (max_date, days_stale, is_stale) so n8n can gate on
        // it. windowFreshness returns null when the merged window is null, so
        // the existing null-insights guard in the node is untouched.
        const insights_3d = windowFreshness(mergeWindow(fb3d, rt3d), max3d, stalenessHours, freshnessNow);
        const insights_7d = windowFreshness(mergeWindow(fb7d, rt7d), max7d, stalenessHours, freshnessNow);
        return {
          entityId,
          entityName,
          token: await resolveEntityToken(entityId),
          rt: rt ? { roi: rt.roi, revenue: rt.revenue, profit: rt.profit, conversions: rt.conversions, offer_name: rt.offer_name } : null,
          insights_3d,
          insights_7d,
          // untracked: FB is spending real money but neither id nor name matched
          // any RedTrack row (silent-miss detector). Returned only; no consumer yet.
          untracked: rt === null && insights_3d === null && insights_7d === null && (fb7d && fb7d.spend >= 100),
        };
      }));
    };

    const resolved = await Promise.all(
      rules.map(async (rule) => {
        let entities;

        if (rule.scope === 'account') {
          const entityIds = await resolveRuleEntities(rule.id);
          let accountIds;
          if (entityIds.length > 0) {
            const assigned = cachedCampaigns.filter(c => entityIds.includes(c.id));
            accountIds = [...new Set(assigned.map(c => c.account_id).filter(Boolean))];
          }
          if (!accountIds || accountIds.length === 0) {
            accountIds = [...new Set(cachedCampaigns.map(c => c.account_id).filter(Boolean))];
          }
          entities = await Promise.all(accountIds.map(async (aid) => {
            const r = await selectFbToken(null, aid);
            const token = (r?.type === 'system_user' && r.token) ? r.token : defaultToken;
            return {
              entityId: `act_${aid}`,
              entityName: `Account ${aid}`,
              token,
              rt: null,
              insights_3d: null,
              insights_7d: null,
              campaignIds: cachedCampaigns.filter(c => c.account_id === aid).map(c => c.id),
            };
          }));
        } else {
          const rawEntityIds = await resolveRuleEntities(rule.id);
          const entityIds = filterLpvBlocked(rule, rawEntityIds);
          entities = await resolvePerCampaignEntities(entityIds);
        }

        return {
          ...rule,
          conditions: JSON.parse(rule.conditions_json),
          action_params: rule.action_params_json ? JSON.parse(rule.action_params_json) : null,
          entities,
        };
      })
    );

    res.json(resolved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.get('/active-schedules', async (req, res) => {
  try {
    const schedules = await RulesEngineDB.listActiveSchedules();
    const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();
    // FIX: prefer a healthy system_users token (renewals land there, not system_user_tokens)
    const healthyDefault = await FacebookAuthDB.getAnyHealthySystemUser();
    const token = healthyDefault?.access_token || systemUserTokens[0]?.access_token || null;
    const resolveEntityToken = makeTokenResolver(token);

    const resolved = await Promise.all(
      schedules.map(async (s) => {
        const campaignRows = await RulesEngineDB.getCampaignsForSchedule(s.id);
        const campaign_ids = campaignRows.map(r => r.campaign_id);
        const campaign_tokens = Object.fromEntries(
          await Promise.all(campaign_ids.map(async (cid) => [cid, await resolveEntityToken(cid)]))
        );
        return {
          ...s,
          days: JSON.parse(s.days_json),
          campaign_ids,
          campaign_tokens,
          token,
        };
      })
    );

    res.json(resolved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.get('/schedules/enforcement', async (req, res) => {
  try {
    const schedules = await RulesEngineDB.listActiveSchedules();
    const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();
    // FIX: prefer a healthy system_users token (renewals land there, not system_user_tokens)
    const healthyDefault = await FacebookAuthDB.getAnyHealthySystemUser();
    const token = healthyDefault?.access_token || systemUserTokens[0]?.access_token || null;
    const resolveEntityToken = makeTokenResolver(token);

    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const actions = [];

    for (const s of schedules) {
      const campaignRows = await RulesEngineDB.getCampaignsForSchedule(s.id);
      if (campaignRows.length === 0) continue;

      const localTime = new Date(now.toLocaleString('en-US', { timeZone: s.timezone }));
      const currentDay = dayNames[localTime.getDay()];
      const currentTime = localTime.toTimeString().substring(0, 5); // HH:MM
      const days = JSON.parse(s.days_json);
      const inWindow = days.includes(currentDay) && currentTime >= s.start_time && currentTime < s.end_time;

      for (const { campaign_id } of campaignRows) {
        if (inWindow) {
          // Rules override: don't re-enable if a rule has this campaign paused
          const pending = await RulesEngineDB.isPausePending(null, campaign_id);
          if (pending) continue;
          actions.push({ campaign_id, action: 'ACTIVE', schedule_name: s.name, token: await resolveEntityToken(campaign_id) });
        } else {
          actions.push({ campaign_id, action: 'PAUSED', schedule_name: s.name, token: await resolveEntityToken(campaign_id) });
        }
      }
    }

    res.json({ actions, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/log', async (req, res) => {
  try {
    await RulesEngineDB.addLog(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.get('/exemptions/check', async (req, res) => {
  try {
    const { rule_id, entity_id } = req.query;
    const exempt = await RulesEngineDB.isExempt(parseInt(rule_id), entity_id);
    res.json({ exempt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/exemptions/batch-check', async (req, res) => {
  try {
    const { items, _context } = req.body;
    const results = await RulesEngineDB.batchIsExempt(items || []);
    res.json({ results, _context });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

rulesEngineN8nRouter.get('/tokens', async (req, res) => {
  try {
    const tokens = await FacebookAuthDB.listSystemUserTokens();
    res.json(tokens.map(({ access_token, ...rest }) => rest));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/snapshots', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    for (const { entity_id, entity_type, spend } of items) {
      if (!entity_id) continue;
      await RulesEngineDB.saveSpendSnapshot(entity_id, entity_type, spend ?? 0);
    }
    await RulesEngineDB.pruneSpendSnapshots(7);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/snapshots/redtrack', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    for (const item of items) {
      if (!item.campaign_name) continue;
      await RulesEngineDB.upsertRedtrackSnapshot(item.campaign_name, item);
    }
    await RulesEngineDB.pruneRedtrackSnapshots();
    res.json({ ok: true, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/daily/redtrack', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    let count = 0;
    for (const { campaign_id, campaign_name, date, revenue, profit, conversions, cost } of items) {
      if (!campaign_name || !date) continue;
      await RulesEngineDB.upsertRtDaily(campaign_name, date, {
        revenue: revenue || 0,
        profit: profit || 0,
        conversions: conversions || 0,
        cost: cost || 0,
        campaign_id: campaign_id ?? null,
      });
      count++;
    }
    await RulesEngineDB.pruneDaily(30);
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/daily/fb', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    let count = 0;
    for (const item of items) {
      const { entity_id, entity_type, date, spend, conversions, revenue,
              ctr, cpc, frequency, link_clicks, lp_views, initiate_checkout, outbound_clicks } = item;
      if (!entity_id || !date) continue;
      await RulesEngineDB.upsertFbDaily(entity_id, entity_type || 'campaign', date, {
        spend: spend||0, conversions: conversions||0, revenue: revenue||0,
        ctr: ctr||0, cpc: cpc||0, frequency: frequency||0,
        link_clicks: link_clicks||0, lp_views: lp_views||0,
        initiate_checkout: initiate_checkout||0, outbound_clicks: outbound_clicks||0,
      });
      count++;
    }
    await RulesEngineDB.pruneDaily(30);
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/budget-history', async (req, res) => {
  try {
    const { entity_id, entity_type, rule_id, old_budget_cents, new_budget_cents, action } = req.body;
    if (!entity_id || !old_budget_cents) return res.status(400).json({ error: 'missing fields' });
    await RulesEngineDB.saveBudgetHistory(entity_id, entity_type||'campaign', rule_id, old_budget_cents, new_budget_cents, action||'decrease_budget');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.get('/budget-history/yesterday-decreased', async (req, res) => {
  try {
    const rows = await RulesEngineDB.getYesterdayDecreasedBudgets();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all verticals (used by Airtable sync). Returns id, name, tracks_lpv,
// keyword, default_schedule_id.
rulesEngineN8nRouter.get('/verticals', async (req, res) => {
  try {
    res.json(await RulesEngineDB.listVerticals());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/offers/sync', async (req, res) => {
  try {
    const offers = Array.isArray(req.body) ? req.body : [req.body];
    const verticals = await RulesEngineDB.listVerticals();
    for (const { offer_id, offer_name } of offers) {
      if (!offer_id || !offer_name) continue;
      const matches = verticals.filter(v =>
        offer_name.toLowerCase().includes(v.name.toLowerCase())
      );
      const verticalId = matches.length === 1 ? matches[0].id : null;
      await RulesEngineDB.upsertRtOffer(offer_id, offer_name, verticalId);
    }
    const unmatched = await RulesEngineDB.getUnmappedRtOffers();
    if (unmatched.length) await RulesEngineDB.markOffersAlerted(unmatched.map(o => o.offer_id));
    res.json({ ok: true, unmatched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/campaigns/names', async (req, res) => {
  try {
    const names = Array.isArray(req.body) ? req.body : [];
    for (const { id, name } of names) {
      if (id && name) await FacebookCacheDB.upsertCampaignName(id, name);
    }
    res.json({ ok: true, count: names.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stamp the FB campaign id (sub3) onto existing name-keyed RedTrack rows.
// Fed ONLY by the separate daily "RT Campaign-ID Map Sync" workflow (not the
// /snapshots/redtrack or /daily/redtrack feeds). EXACT-name match only -- sub3
// validated /^120\d{15}$/ so a coarse 24-hex RT campaign_id can never be written.
rulesEngineN8nRouter.post('/map/rt-campaign-ids', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];
    let stamped = 0;
    for (const { campaign_name, campaign_id } of items) {
      if (!campaign_name || !/^120\d{15}$/.test(String(campaign_id || ''))) continue;
      await RulesEngineDB.stampRtCampaignId(campaign_name, String(campaign_id));
      stamped++;
    }
    res.json({ ok: true, stamped, received: items.length });
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

const MIN_BASELINE_HOURS = 24;

rulesEngineN8nRouter.post('/snapshots/burst-check', async (req, res) => {
  try {
    const { entity_ids, minutes = 30 } = req.body;
    const results = {};
    for (const entityId of (entity_ids || [])) {
      const recentSnaps = await RulesEngineDB.getSpendSnapshots(entityId, minutes);
      const baselineSnaps = await RulesEngineDB.getSpendSnapshots(entityId, 7 * 24 * 60);
      const spend_recent = recentSnaps.reduce((sum, s) => sum + s.spend_delta, 0);

      const oldestSnap = baselineSnaps[0];
      const hasEnoughBaseline = oldestSnap &&
        (Date.now() - new Date(oldestSnap.recorded_at).getTime()) >= MIN_BASELINE_HOURS * 3600000;

      if (!hasEnoughBaseline) {
        results[entityId] = { burst_multiplier: 0, spend_recent, avg_period: 0, insufficient_baseline: true };
        continue;
      }

      const totalBaseline = baselineSnaps.reduce((sum, s) => sum + s.spend_delta, 0);
      const periods = (7 * 24 * 60) / minutes;
      const avg_period = periods > 0 ? totalBaseline / periods : 0;
      results[entityId] = {
        burst_multiplier: avg_period > 0 ? spend_recent / avg_period : 0,
        spend_recent,
        avg_period,
      };
    }
    res.json(results);
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

rulesEngineN8nRouter.post('/pause-pending/batch-check', async (req, res) => {
  try {
    const { items, _context } = req.body;
    const results = await RulesEngineDB.batchIsPausePending(items || []);
    res.json({ results, _context });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// S03: stale pause_pending entries
rulesEngineN8nRouter.get('/pause-pending/stale', async (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes) || 10;
    const items = await RulesEngineDB.getStalePausePending(minutes);
    res.json({ count: items.length, items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// M02: consecutive pull failure count
rulesEngineN8nRouter.get('/pull-failures/consecutive', async (req, res) => {
  try {
    const count = await RulesEngineDB.getConsecutivePullFailures();
    res.json({ consecutive_failures: count, alert: count >= 3 });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

rulesEngineN8nRouter.get('/token-health', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const expiring = await FacebookAuthDB.getExpiringTokens(days);
    res.json({ ok: true, expiring_soon: expiring });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// System-user token expiry (new multi-BM schema). Feeds the n8n "Token Expiry
// Monitor" alert workflow. SECURITY: getExpiringSystemUsers returns SELECT * which
// includes access_token — we MUST whitelist alert-safe fields and never emit the
// token. Default window 7d (matches getExpiringSystemUsers + its unit test);
// overridable via ?days= or TOKEN_EXPIRY_ALERT_DAYS, clamped 1..90.
// Resolve explicitly (not via ||) so ?days=0 clamps to 1 instead of being
// mistaken for "missing": ?days=0/-5 -> 1, ?days=999 -> 90, non-numeric or
// absent -> default (env TOKEN_EXPIRY_ALERT_DAYS, else 7).
rulesEngineN8nRouter.get('/system-users/expiring', async (req, res) => {
  try {
    const envDefault = parseInt(process.env.TOKEN_EXPIRY_ALERT_DAYS, 10);
    const fallback = Number.isFinite(envDefault) ? envDefault : 7;
    const parsed = parseInt(req.query.days, 10);
    const requested = (req.query.days !== undefined && Number.isFinite(parsed))
      ? parsed
      : fallback;
    const days = Math.min(Math.max(requested, 1), 90);
    const rows = await FacebookAuthDB.getExpiringSystemUsers(days);
    const expiring = (rows || []).map((r) => ({
      fb_user_id: r.fb_user_id,
      business_manager_id: r.business_manager_id,
      name: r.name,
      expires_at: r.expires_at,
      last_validated_at: r.last_validated_at,
      last_validation_ok: r.last_validation_ok,
    }));
    res.json({
      ok: true,
      window_days: days,
      expiring,
      count: expiring.length,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Logs (for daily digest) ---
rulesEngineN8nRouter.get('/logs', async (req, res) => {
  try {
    const logs = await RulesEngineDB.getLogs({
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      rule_id: req.query.rule_id ? parseInt(req.query.rule_id) : undefined,
      action_taken: req.query.action_taken || undefined,
      limit: req.query.limit ? parseInt(req.query.limit) : 500,
    });
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cycle lock — manual mutex for n8n versions without concurrency control.
// Workflow's first node POSTs to /acquire; if another cycle is running and
// not yet stale, the response sets acquired=false and the workflow exits
// early. Last node POSTs to /release with the lock_id it received.
rulesEngineN8nRouter.post('/cycle-lock/acquire', async (req, res) => {
  try {
    const name = String(req.body?.name || req.query?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const maxAge = Math.min(Math.max(parseFloat(req.body?.max_age_minutes || req.query?.max_age_minutes || 30), 1), 120);
    const result = await RulesEngineDB.acquireCycleLock(name, maxAge);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/cycle-lock/release', async (req, res) => {
  try {
    const name = String(req.body?.name || req.query?.name || '').trim();
    const lockId = String(req.body?.lock_id || req.query?.lock_id || '').trim();
    if (!name || !lockId) return res.status(400).json({ error: 'name and lock_id required' });
    const result = await RulesEngineDB.releaseCycleLock(name, lockId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scale-pending — same shape as the existing pause-pending endpoints.
rulesEngineN8nRouter.post('/scale-pending/batch-check', async (req, res) => {
  try {
    const { items, _context } = req.body || {};
    const results = await RulesEngineDB.batchIsScalePending(items || []);
    res.json({ results, _context });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/scale-pending', async (req, res) => {
  try {
    const { rule_id, entity_id, cooldown_hours } = req.body || {};
    if (!rule_id || !entity_id) return res.status(400).json({ error: 'rule_id and entity_id required' });
    const hours = Number(cooldown_hours) || 4;
    await RulesEngineDB.setScalePending(rule_id, entity_id, hours);
    await RulesEngineDB.pruneExpiredScalePending();
    res.json({ ok: true, expires_at: new Date(Date.now() + hours * 3600000).toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute a rule's action live on a single entity. Used by the Telegram
// "Approve" button to promote a DRY RUN finding into a real action without
// waiting for the next engine cycle. v1 supports pause only — scale/decrease
// rules require knowing current budget and applying scale_pct safely, which
// is owned by the n8n loop; for those, the Telegram alert hides the Approve
// button so users adjust budget manually via the dashboard.
rulesEngineN8nRouter.post('/execute-once', async (req, res) => {
  try {
    const { rule_id, entity_id } = req.body || {};
    if (!rule_id || !entity_id) {
      return res.status(400).json({ error: 'rule_id and entity_id required' });
    }
    const rule = await RulesEngineDB.getRuleById(parseInt(rule_id, 10));
    if (!rule) return res.status(404).json({ error: 'rule not found' });

    if (rule.action !== 'pause') {
      return res.status(501).json({
        error: 'execute-once only supports pause rules in this version',
        rule_action: rule.action,
        hint: 'Adjust budget manually via the dashboard for scale/decrease rules.',
      });
    }

    const cachedCampaigns = await FacebookCacheDB.getCampaigns();
    const camp = cachedCampaigns.find(c => c.id === entity_id);
    const entityName = camp ? camp.name : entity_id;

    const tokens = await FacebookAuthDB.listSystemUserTokens();
    const token = tokens[0]?.access_token;
    if (!token) return res.status(500).json({ error: 'no FB token available' });

    const fbResp = await fetch(`https://graph.facebook.com/v25.0/${entity_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: 'PAUSED', access_token: token }),
    });
    let fbBody;
    try { fbBody = await fbResp.json(); } catch { fbBody = {}; }
    if (!fbResp.ok || fbBody.error) {
      return res.status(502).json({
        error: 'FB API rejected pause request',
        fb_error: fbBody.error || fbBody,
      });
    }

    await RulesEngineDB.setPausePending(rule.id, entity_id);
    await RulesEngineDB.addLog({
      rule_id: rule.id,
      entity_type: rule.scope || 'campaign',
      entity_id,
      entity_name: entityName,
      action_taken: 'telegram_approve_pause',
      trigger_data_json: JSON.stringify({ source: 'telegram', via: 'execute-once' }),
      is_dry_run: 0,
    });

    res.json({ ok: true, entity_id, entity_name: entityName, action: 'paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Offer performance (for ad performance summary) ---
rulesEngineN8nRouter.get('/offer-performance', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '7', 10) || 7, 1), 30);
    const cachedCampaigns = await FacebookCacheDB.getCampaigns();
    const nameToId = Object.fromEntries(
      cachedCampaigns.map(c => [c.name.trim().toLowerCase(), c.id])
    );
    const verticalLabels = await RulesEngineDB.listAllVerticalLabels();
    const idToVertical = Object.fromEntries(
      verticalLabels.map(l => [l.campaign_id, l.label_value])
    );

    // URL-decode campaign names — some RT entries arrive with %2F (slash)
    // and other percent-escapes embedded in the raw name. Try whole-string
    // decode first (handles multi-byte UTF-8), fall back to per-pair decode
    // for partially-malformed strings (e.g. trailing "%2" without 2 hex chars).
    const decodeName = (s) => {
      const str = String(s || '');
      try { return decodeURIComponent(str); }
      catch {
        return str.replace(/%[0-9A-Fa-f]{2}/g, m => {
          try { return decodeURIComponent(m); } catch { return m; }
        });
      }
    };

    const rows = await RulesEngineDB.getOfferPerformance(days);
    const enriched = rows.map(r => {
      const cleanName = decodeName(r.campaign_name);
      const cid = nameToId[cleanName.trim().toLowerCase()] ||
                  nameToId[String(r.campaign_name || '').trim().toLowerCase()];
      return {
        ...r,
        campaign_name: cleanName,
        campaign_id: cid || null,
        vertical: cid ? (idToVertical[cid] || null) : null,
      };
    });

    const totals = enriched.reduce((acc, r) => {
      acc.cost += r.cost || 0;
      acc.revenue += r.revenue || 0;
      acc.profit += r.profit || 0;
      acc.conversions += r.conversions || 0;
      return acc;
    }, { cost: 0, revenue: 0, profit: 0, conversions: 0 });
    totals.roi = totals.cost > 0 ? totals.profit / totals.cost : 0;
    totals.cpa = totals.conversions > 0 ? totals.cost / totals.conversions : 0;

    res.json({ days, count: enriched.length, totals, offers: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Coverage (for daily digest) ---
rulesEngineN8nRouter.get('/coverage', async (req, res) => {
  try {
    const cachedCampaigns = await FacebookCacheDB.getCampaigns();
    const assignments = await RulesEngineDB.listAllAssignedCampaignIds();
    const scheduledCampaigns = await RulesEngineDB.listAllScheduledCampaignIds();
    const orphans = cachedCampaigns.filter(c => {
      return !assignments.has(c.id) || !scheduledCampaigns.has(c.id);
    }).map(c => ({
      ...c,
      missing_rule: !assignments.has(c.id),
      missing_schedule: !scheduledCampaigns.has(c.id),
    }));
    res.json(orphans);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineN8nRouter.post('/verticals/upsert', async (req, res) => {
  try {
    await RulesEngineDB.upsertVertical(req.body.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
