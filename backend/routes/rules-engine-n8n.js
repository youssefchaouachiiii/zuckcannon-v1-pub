// backend/routes/rules-engine-n8n.js
import express from 'express';
import { RulesEngineDB } from '../db/rules-engine-db.js';
import { resolveRuleEntities } from '../utils/rules-engine-resolver.js';
import { FacebookAuthDB } from '../utils/facebook-auth-db.js';
import { FacebookCacheDB } from '../utils/facebook-cache-db.js';

export const rulesEngineN8nRouter = express.Router();

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
    const defaultToken = systemUserTokens[0]?.access_token || null;

    const cachedCampaigns = await FacebookCacheDB.getCampaigns();
    await RulesEngineDB.autoAssignVerticalLabels(cachedCampaigns);
    const nameMap = Object.fromEntries(cachedCampaigns.map(c => [c.id, c.name]));

    const rtSnaps = await RulesEngineDB.getAllRedtrackSnapshots();
    const rtMap = Object.fromEntries(rtSnaps.map(r => [r.campaign_name.trim().toLowerCase(), r]));

    const resolvePerCampaignEntities = async (entityIds) => {
      return Promise.all(entityIds.map(async (entityId) => {
        const entityName = nameMap[entityId] || entityId;
        const rt = rtMap[entityName.trim().toLowerCase()] || null;
        const nameLower = entityName.trim().toLowerCase();

        const [fb3d, rt3d, fb7d, rt7d] = await Promise.all([
          RulesEngineDB.getFbDailyWindow(entityId, 3),
          RulesEngineDB.getRtDailyWindow(nameLower, 3),
          RulesEngineDB.getFbDailyWindow(entityId, 7),
          RulesEngineDB.getRtDailyWindow(nameLower, 7),
        ]);

        const mergeWindow = (fb, rt) => {
          if (!fb) return null;
          const spend = fb.spend || 0;
          const conversions = rt ? (rt.conversions || 0) : (fb.conversions || 0);
          const revenue = rt ? (rt.revenue || 0) : (fb.revenue || 0);
          const profit = rt ? (rt.profit || 0) : (revenue - spend);
          const roi = rt ? (rt.roi || 0) : (spend > 0 ? profit / spend : 0);
          const cpa = conversions > 0 ? spend / conversions : 0;
          return { spend, conversions, revenue, profit, roi, cpa };
        };

        return {
          entityId,
          entityName,
          token: defaultToken,
          rt: rt ? { roi: rt.roi, revenue: rt.revenue, profit: rt.profit, conversions: rt.conversions, offer_name: rt.offer_name } : null,
          insights_3d: mergeWindow(fb3d, rt3d),
          insights_7d: mergeWindow(fb7d, rt7d),
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
          entities = accountIds.map(aid => ({
            entityId: `act_${aid}`,
            entityName: `Account ${aid}`,
            token: defaultToken,
            rt: null,
            insights_3d: null,
            insights_7d: null,
          }));
        } else {
          const entityIds = await resolveRuleEntities(rule.id);
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

rulesEngineN8nRouter.get('/schedules/enforcement', async (req, res) => {
  try {
    const schedules = await RulesEngineDB.listActiveSchedules();
    const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();
    const token = systemUserTokens[0]?.access_token || null;

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
          actions.push({ campaign_id, action: 'ACTIVE', schedule_name: s.name });
        } else {
          actions.push({ campaign_id, action: 'PAUSED', schedule_name: s.name });
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
    for (const { campaign_name, date, revenue, profit, conversions, cost } of items) {
      if (!campaign_name || !date) continue;
      await RulesEngineDB.upsertRtDaily(campaign_name, date, {
        revenue: revenue || 0,
        profit: profit || 0,
        conversions: conversions || 0,
        cost: cost || 0,
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
    for (const { entity_id, entity_type, date, spend, conversions, revenue } of items) {
      if (!entity_id || !date) continue;
      await RulesEngineDB.upsertFbDaily(entity_id, entity_type || 'campaign', date, {
        spend: spend || 0,
        conversions: conversions || 0,
        revenue: revenue || 0,
      });
      count++;
    }
    await RulesEngineDB.pruneDaily(30);
    res.json({ ok: true, count });
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
