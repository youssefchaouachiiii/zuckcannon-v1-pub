// backend/routes/rules-engine-n8n.js
import express from 'express';
import { RulesEngineDB } from '../db/rules-engine-db.js';
import { resolveRuleEntities } from '../utils/rules-engine-resolver.js';
import { FacebookAuthDB } from '../utils/facebook-auth-db.js';

export const rulesEngineN8nRouter = express.Router();

rulesEngineN8nRouter.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

rulesEngineN8nRouter.get('/active-rules', async (req, res) => {
  try {
    const rules = await RulesEngineDB.listActiveRules();
    const systemUserTokens = await FacebookAuthDB.listSystemUserTokens();
    const defaultToken = systemUserTokens[0]?.access_token || null;

    const resolved = await Promise.all(
      rules.map(async (rule) => {
        const entityIds = await resolveRuleEntities(rule.id);
        // Each entity gets a token; future: match per ad-account BM
        const entities = entityIds.map(entityId => ({ entityId, token: defaultToken }));
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

rulesEngineN8nRouter.get('/snapshots/:entityId', async (req, res) => {
  try {
    const minutes = parseInt(req.query.minutes) || 30;
    const snaps = await RulesEngineDB.getSpendSnapshots(req.params.entityId, minutes);
    res.json(snaps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/snapshots/burst-check', async (req, res) => {
  try {
    const { entity_ids, minutes = 30 } = req.body;
    const results = {};
    for (const entityId of (entity_ids || [])) {
      const recentSnaps = await RulesEngineDB.getSpendSnapshots(entityId, minutes);
      const baselineSnaps = await RulesEngineDB.getSpendSnapshots(entityId, 7 * 24 * 60);
      const spend_recent = recentSnaps.reduce((sum, s) => sum + s.spend, 0);
      const totalBaseline = baselineSnaps.reduce((sum, s) => sum + s.spend, 0);
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
    const expiring = await FacebookAuthDB.getExpiringTokens(7);
    res.json({ ok: true, expiring_soon: expiring });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

rulesEngineN8nRouter.post('/verticals/upsert', async (req, res) => {
  try {
    await RulesEngineDB.upsertVertical(req.body.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
