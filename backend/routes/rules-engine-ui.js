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

rulesEngineUiRouter.get('/rules/:id', async (req, res) => {
  try {
    const rule = await RulesEngineDB.getRuleById(parseInt(req.params.id));
    if (!rule) return res.status(404).json({ error: 'Not found' });
    res.json(rule);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
      combinator: req.body.combinator || 'AND',
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
      combinator: req.body.combinator || 'AND',
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

rulesEngineUiRouter.post('/rules/:id/assign', async (req, res) => {
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

// Bulk assign campaigns to vertical/tag by name pattern
rulesEngineUiRouter.post('/campaigns/labels/bulk', async (req, res) => {
  try {
    const cachedCampaigns = await FacebookCacheDB.getCampaigns();
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

// --- Tags ---
rulesEngineUiRouter.get('/tags', async (req, res) => {
  try {
    const tags = await RulesEngineDB.getAllTags();
    res.json(tags);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.post('/tags', async (req, res) => {
  try {
    const { campaign_id, tag } = req.body;
    await RulesEngineDB.addTag(campaign_id, tag);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.delete('/tags', async (req, res) => {
  try {
    const { campaign_id, tag } = req.body;
    await RulesEngineDB.removeTag(campaign_id, tag);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
