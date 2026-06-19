// backend/routes/rules-engine-ui.js
import express from 'express';
import { RulesEngineDB } from '../db/rules-engine-db.js';
import { FacebookCacheDB } from '../utils/facebook-cache-db.js';

export const rulesEngineUiRouter = express.Router();

// --- Rule Templates ---
const RULE_TEMPLATES = [
  {
    id: 'spend_cap',
    name: 'Spend Cap Kill',
    description: 'Pause when daily spend exceeds threshold',
    scope: 'campaign',
    action: 'pause',
    cooldown_hours: 4,
    alert_level: 'warning',
    combinator: 'AND',
    conditions: [{ metric: 'spend_today', operator: 'gt', value: 300, lookback: 'today' }],
    params: { threshold: 300 },
  },
  {
    id: 'roi_kill',
    name: 'Negative ROI Kill',
    description: 'Pause when spend is high but ROI is negative',
    scope: 'campaign',
    action: 'pause',
    cooldown_hours: 24,
    alert_level: 'critical',
    combinator: 'AND',
    conditions: [
      { metric: 'spend_today', operator: 'gt', value: 300, lookback: 'today' },
      { metric: 'roi', operator: 'lt', value: -15, lookback: 'today' },
    ],
    params: { spend_threshold: 300, roi_threshold: -15 },
  },
  {
    id: 'cpa_cap',
    name: 'CPA Cap',
    description: 'Pause when CPA exceeds threshold with sufficient spend',
    scope: 'ad',
    action: 'pause',
    cooldown_hours: 24,
    alert_level: 'warning',
    combinator: 'AND',
    conditions: [
      { metric: 'cpa', operator: 'gt', value: 45, lookback: 'last_3d' },
      { metric: 'spend_today', operator: 'gt', value: 100, lookback: 'today' },
    ],
    params: { cpa_threshold: 45, spend_threshold: 100 },
  },
  {
    id: 'zero_conv',
    name: 'Zero Conversions Kill',
    description: 'Pause when spend is high but zero conversions',
    scope: 'ad',
    action: 'pause',
    cooldown_hours: 12,
    alert_level: 'warning',
    combinator: 'AND',
    conditions: [
      { metric: 'spend_today', operator: 'gt', value: 80, lookback: 'today' },
      { metric: 'conversions', operator: 'eq', value: 0, lookback: 'today' },
    ],
    params: { spend_threshold: 80 },
  },
  {
    id: 'burst_spend',
    name: 'Burst Spend',
    description: 'Pause when spend velocity spikes vs 7-day baseline',
    scope: 'campaign',
    action: 'pause',
    cooldown_hours: 1,
    alert_level: 'critical',
    combinator: 'AND',
    conditions: [{ metric: 'spend_velocity', operator: 'gt', value: 3, lookback: 'last_30min' }],
    params: { multiplier: 3 },
  },
  {
    id: 'scale_winner',
    name: 'Scale Winner',
    description: 'Scale budget +20% when CPA is low and conversions are high',
    scope: 'adset',
    action: 'scale_budget',
    cooldown_hours: 48,
    alert_level: 'info',
    combinator: 'AND',
    conditions: [
      { metric: 'cpa', operator: 'lt', value: 25, lookback: 'last_3d' },
      { metric: 'conversions', operator: 'gte', value: 5, lookback: 'last_3d' },
      { metric: 'spend_today', operator: 'gt', value: 200, lookback: 'today' },
    ],
    action_params: { scale_pct: 20, cap: 500 },
    params: { cpa_threshold: 25, min_conversions: 5, spend_threshold: 200, cap: 500 },
  },
  {
    id: 'account_cap',
    name: 'Account Spend Cap',
    description: 'Pause all campaigns when account daily spend exceeds cap',
    scope: 'account',
    action: 'pause',
    cooldown_hours: 4,
    alert_level: 'critical',
    combinator: 'AND',
    conditions: [{ metric: 'account_spend_today', operator: 'gt', value: 5000, lookback: 'today' }],
    params: { cap: 5000 },
  },
];

rulesEngineUiRouter.get('/templates', (req, res) => {
  res.json(RULE_TEMPLATES);
});

rulesEngineUiRouter.post('/rules/from-template', async (req, res) => {
  try {
    const { template_id, overrides = {} } = req.body;
    const tpl = RULE_TEMPLATES.find(t => t.id === template_id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const conditions = tpl.conditions.map(c => {
      const directVal = overrides[c.metric];
      const namedKey = Object.keys(overrides).find(k => {
        if (k === 'threshold' || k === 'cap' || k === 'multiplier') return false;
        const stripped = k.replace('_threshold', '').replace('_cap', '').replace('_multiplier', '');
        return stripped && c.metric.includes(stripped);
      });
      const val = directVal ?? (namedKey !== undefined ? overrides[namedKey] : undefined) ?? overrides.threshold ?? overrides.cap ?? overrides.multiplier ?? c.value;
      return { ...c, value: val };
    });

    const rule = await RulesEngineDB.createRule({
      name: overrides.name || tpl.name,
      scope: tpl.scope,
      conditions_json: JSON.stringify(conditions),
      action: tpl.action,
      action_params_json: tpl.action_params ? JSON.stringify(tpl.action_params) : null,
      cooldown_hours: overrides.cooldown_hours ?? tpl.cooldown_hours,
      is_active: 1,
      is_dry_run: overrides.is_dry_run ?? 1,
      combinator: tpl.combinator,
      alert_level: tpl.alert_level,
    });
    res.status(201).json({ ...rule, template_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
      alert_level: req.body.alert_level || 'warning',
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
      alert_level: req.body.alert_level || 'warning',
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

rulesEngineUiRouter.get('/rules/:id/assignments', async (req, res) => {
  try {
    const rows = await RulesEngineDB.getAssignmentsForRule(parseInt(req.params.id));
    res.json(rows);
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
  try {
    const ruleId = parseInt(req.params.id);
    const assignments = Array.isArray(req.body.assignments)
      ? req.body.assignments
      : [{ entity_type: req.body.entity_type, entity_id: req.body.entity_id }];
    for (const a of assignments) {
      await RulesEngineDB.removeAssignment(ruleId, a.entity_type, a.entity_id);
    }
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
      is_dry_run: req.body.is_dry_run ?? 1,
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
      is_dry_run: req.body.is_dry_run ?? 1,
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

rulesEngineUiRouter.get('/schedules/:id/campaigns', async (req, res) => {
  try {
    const schedId = parseInt(req.params.id);
    // Direct assignments only — this is what the Schedule Check workflow actually
    // enforces (getCampaignsForSchedule reads schedule_assignments). Vertical
    // default_schedule_id is coverage/intent, NOT enforced, so it is excluded here
    // to keep the displayed count honest about what the engine will act on.
    const rows = await RulesEngineDB.getCampaignsForSchedule(schedId);
    const campaignIds = new Set(rows.map(r => r.campaign_id));
    const allCached = await FacebookCacheDB.getCampaigns();
    const seen = new Set();
    const campaigns = [];
    for (const c of allCached) {
      if (campaignIds.has(c.id) && !seen.has(c.id)) {
        seen.add(c.id);
        campaigns.push({ id: c.id, name: c.name, account_id: c.account_id });
      }
    }
    for (const id of campaignIds) {
      if (!seen.has(id)) { seen.add(id); campaigns.push({ id, name: null, account_id: null }); }
    }
    res.json({ count: campaigns.length, campaigns });
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

rulesEngineUiRouter.delete('/schedules/:id/assign', async (req, res) => {
  try {
    const { campaign_id } = req.body;
    await RulesEngineDB.removeScheduleAssignment(parseInt(req.params.id), campaign_id);
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

rulesEngineUiRouter.put('/verticals/:id', async (req, res) => {
  try {
    const v = await RulesEngineDB.updateVertical(parseInt(req.params.id), {
      default_schedule_id: req.body.default_schedule_id,
    });
    res.json(v);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Toggle whether a vertical's landing page is FB-pixel tracked. Verticals
// with tracks_lpv=0 (e.g. EDU redirect-link offers) are excluded from any
// rule that conditions on lp_views or lp_conv_rate, since LPV is structurally
// undercounted there and the rule would always fire on healthy traffic.
rulesEngineUiRouter.put('/verticals/:id/tracks-lpv', async (req, res) => {
  try {
    const v = await RulesEngineDB.setVerticalTracksLpv(
      parseInt(req.params.id),
      !!req.body.tracks_lpv
    );
    res.json(v);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.get('/verticals/:id/campaigns', async (req, res) => {
  try {
    const vertical = await RulesEngineDB.getVerticalById(parseInt(req.params.id));
    if (!vertical) return res.status(404).json({ error: 'Not found' });
    const rows = await RulesEngineDB.getCampaignsByVertical(vertical.name);
    const campaignIds = new Set(rows.map(r => r.campaign_id));
    const allCached = await FacebookCacheDB.getCampaigns();
    const seen = new Set();
    const campaigns = [];
    for (const c of allCached) {
      if (campaignIds.has(c.id) && !seen.has(c.id)) {
        seen.add(c.id);
        campaigns.push({ id: c.id, name: c.name, account_id: c.account_id });
      }
    }
    for (const id of campaignIds) {
      if (!seen.has(id)) { seen.add(id); campaigns.push({ id, name: null, account_id: null }); }
    }
    res.json({ vertical: vertical.name, count: campaigns.length, campaigns });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.delete('/verticals/:id/campaigns', async (req, res) => {
  try {
    const vertical = await RulesEngineDB.getVerticalById(parseInt(req.params.id));
    if (!vertical) return res.status(404).json({ error: 'Not found' });
    await RulesEngineDB.clearCampaignsByVertical(vertical.name);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.delete('/verticals/:id', async (req, res) => {
  try {
    await RulesEngineDB.deleteVertical(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List cached campaigns (for dropdowns)
rulesEngineUiRouter.get('/campaigns/cached', async (req, res) => {
  try {
    const campaigns = await FacebookCacheDB.getCampaigns();
    const seen = new Set();
    const unique = [];
    for (const c of campaigns) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      unique.push({ id: c.id, name: c.name, account_id: c.account_id });
    }
    res.json(unique);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Direct assign a single campaign to a label (vertical/tag)
rulesEngineUiRouter.post('/campaigns/labels', async (req, res) => {
  try {
    const { campaign_id, label_type, label_value } = req.body;
    await RulesEngineDB.addCampaignLabel(campaign_id, label_type, label_value);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

rulesEngineUiRouter.delete('/campaigns/labels', async (req, res) => {
  try {
    const { campaign_id, label_type, label_value } = req.body;
    await RulesEngineDB.removeCampaignLabel(campaign_id, label_type, label_value);
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
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      rule_id: req.query.rule_id ? parseInt(req.query.rule_id) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit) : 500,
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

    const seen = new Set();
    const orphans = [];
    for (const c of cachedCampaigns) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (!assignments.has(c.id) || !scheduledCampaigns.has(c.id)) {
        orphans.push({ ...c, missing_rule: !assignments.has(c.id), missing_schedule: !scheduledCampaigns.has(c.id) });
      }
    }
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

rulesEngineUiRouter.delete('/tags/global', async (req, res) => {
  try {
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: 'tag required' });
    await RulesEngineDB.removeTagGlobally(tag);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
