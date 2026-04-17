// public/rules-engine.js

// ── Tom Select helper ─────────────────────────────────────────────────
const _tomSelects = {};
function makeTomSelect(id, placeholder = 'Search...') {
  if (_tomSelects[id]) { _tomSelects[id].destroy(); }
  const el = document.getElementById(id);
  if (!el || typeof TomSelect === 'undefined') return;
  _tomSelects[id] = new TomSelect(el, {
    placeholder,
    allowEmptyOption: true,
    maxOptions: 500,
  });
}
function refreshTomSelect(id) {
  if (_tomSelects[id]) { _tomSelects[id].sync(); }
}

// ── XSS helper ────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const RULE_TEMPLATES = [
  {
    name: 'Spend Cap Kill',
    conditions: [{ metric: 'spend_today', operator: 'gt', value: 300, lookback: 'today' }],
    action: 'pause', cooldown_hours: 4,
  },
  {
    name: 'Negative ROI Kill',
    conditions: [
      { metric: 'spend_today', operator: 'gt', value: 300, lookback: 'today' },
      { metric: 'roi', operator: 'lt', value: -0.15, lookback: 'today' },
    ],
    action: 'pause', cooldown_hours: 4,
  },
  {
    name: 'Zero Conversions Kill',
    conditions: [
      { metric: 'spend_today', operator: 'gt', value: 80, lookback: 'today' },
      { metric: 'conversions', operator: 'eq', value: 0, lookback: 'today' },
    ],
    action: 'pause', cooldown_hours: 4,
  },
  {
    name: 'CPA Cap',
    conditions: [
      { metric: 'cpa', operator: 'gt', value: 45, lookback: 'last_3d' },
      { metric: 'spend_today', operator: 'gt', value: 100, lookback: 'today' },
    ],
    action: 'pause', cooldown_hours: 8,
  },
  {
    name: 'Scale Winner',
    conditions: [
      { metric: 'cpa', operator: 'lt', value: 25, lookback: 'last_3d' },
      { metric: 'conversions', operator: 'gte', value: 5, lookback: 'last_3d' },
      { metric: 'spend_today', operator: 'gt', value: 200, lookback: 'today' },
    ],
    action: 'scale_budget', cooldown_hours: 48,
    action_params: { scale_pct: 20, cap: 500 },
  },
  {
    name: 'Burst Spend',
    conditions: [
      { metric: 'burst_multiplier', operator: 'gt', value: 3, lookback: 'last_30m' },
    ],
    action: 'pause', cooldown_hours: 4,
    alert_level: 'critical',
  },
  {
    name: 'Account Spend Cap',
    conditions: [
      { metric: 'spend_today', operator: 'gt', value: 5000, lookback: 'today' },
    ],
    action: 'pause', cooldown_hours: 24,
    scope: 'account',
    alert_level: 'critical',
  },
];

const METRICS = [
  { value: 'spend_today', label: 'Spend Today ($)' },
  { value: 'cpa', label: 'CPA ($)' },
  { value: 'roas', label: 'ROAS' },
  { value: 'roi', label: 'ROI (%)' },
  { value: 'conversions', label: 'Conversions' },
  { value: 'burst_multiplier', label: 'Burst Multiplier' },
];

const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
];

let editingRuleId = null;
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Tab switching ──────────────────────────────────────────────────────
function switchReTab(tabName) {
  document.querySelectorAll('.re-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.re-tab-btn').forEach(el => el.classList.remove('active'));
  const content = document.getElementById('re-tab-' + tabName);
  if (content) content.style.display = 'block';
  const btn = document.querySelector(`.re-tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.classList.add('active');

  // Load data for the active tab
  if (tabName === 'rules') { renderTemplates(); loadRules(); }
  else if (tabName === 'schedules') loadSchedules();
  else if (tabName === 'verticals') loadVerticals();
  else if (tabName === 'coverage') loadVerticals().then(loadCoverage);
  else if (tabName === 'activity-log') {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('log-date-from').value = today;
    document.getElementById('log-date-to').value = today;
    loadLogs();
  }
  else if (tabName === 'tags') loadTags();
}

// ── Rules ─────────────────────────────────────────────────────────────
async function loadRules() {
  const tbody = document.getElementById('rules-body');
  try {
    const res = await fetch('/api/rules-engine/ui/rules');
    if (!res.ok) throw new Error('Server error');
    const rules = await res.json();
    if (rules.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:12px 8px;color:#888;">No rules yet. Use a template above.</td></tr>';
      return;
    }
    tbody.innerHTML = rules.map(r => `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">${escapeHtml(r.name)}</td>
        <td style="padding:8px;">${escapeHtml(r.scope)}</td>
        <td style="padding:8px;">${escapeHtml(r.action)}</td>
        <td style="padding:8px;">
          ${r.is_dry_run ? '<span style="background:#fff3cd;color:#856404;padding:2px 6px;border-radius:3px;font-size:11px;">DRY RUN</span> ' : ''}
          ${r.is_active ? '<span style="background:#d4edda;color:#155724;padding:2px 6px;border-radius:3px;font-size:11px;">Active</span>' : '<span style="background:#e2e3e5;color:#383d41;padding:2px 6px;border-radius:3px;font-size:11px;">Inactive</span>'}
        </td>
        <td style="padding:8px;white-space:nowrap;">
          <button class="btn-sm edit-rule-btn" data-rule-id="${r.id}">Edit</button>
          <button class="btn-danger btn-sm delete-rule-btn" data-rule-id="${r.id}" data-rule-name="${escapeHtml(r.name)}">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:12px 8px;color:#dc3545;">Failed to load rules.</td></tr>';
  }
}

function renderTemplates() {
  const container = document.getElementById('rule-templates');
  if (!container) return;
  container.innerHTML = RULE_TEMPLATES.map((t, i) => `
    <div style="border:1px solid #ddd;border-radius:4px;padding:8px 12px;min-width:150px;">
      <strong style="font-size:13px;">${escapeHtml(t.name)}</strong>
      <p style="font-size:12px;color:#666;margin:4px 0;">${t.conditions.length} condition(s) → ${escapeHtml(t.action)}</p>
      <button class="btn-secondary btn-sm apply-template-btn" data-template-index="${i}">Use</button>
    </div>
  `).join('');
}

function applyTemplate(index) {
  const t = RULE_TEMPLATES[index];
  document.getElementById('rule-name').value = t.name;
  document.getElementById('rule-scope').value = t.scope || 'campaign';
  document.getElementById('rule-action').value = t.action;
  document.getElementById('rule-cooldown').value = t.cooldown_hours;
  document.getElementById('rule-alert-level').value = t.alert_level || 'warning';
  document.querySelectorAll('input[name="rule-combinator"]').forEach(r => { r.checked = r.value === 'AND'; });
  document.getElementById('conditions-builder').innerHTML = '';
  t.conditions.forEach(c => addConditionRow(c));
  document.getElementById('scale-params').style.display = t.action === 'scale_budget' ? 'flex' : 'none';
  if (t.action_params) {
    if (t.action_params.scale_pct) document.getElementById('scale-pct').value = t.action_params.scale_pct;
    if (t.action_params.cap) document.getElementById('scale-cap').value = t.action_params.cap;
  }
  document.getElementById('rule-editor').style.display = 'block';
  document.getElementById('rule-editor-title').textContent = 'New Rule from Template';
  editingRuleId = null;
}

function addCondition() {
  addConditionRow({ metric: 'spend_today', operator: 'gt', value: '', lookback: 'today' });
}

function addConditionRow(c = {}) {
  const builder = document.getElementById('conditions-builder');
  const div = document.createElement('div');
  div.className = 'condition-row';
  div.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;';
  div.innerHTML = `
    <select class="cond-metric" style="padding:4px 6px;font-size:13px;">
      ${METRICS.map(m => `<option value="${m.value}"${c.metric===m.value?' selected':''}>${m.label}</option>`).join('')}
    </select>
    <select class="cond-operator" style="padding:4px 6px;font-size:13px;">
      ${OPERATORS.map(o => `<option value="${o.value}"${c.operator===o.value?' selected':''}>${o.label}</option>`).join('')}
    </select>
    <input type="number" class="cond-value" value="${c.value ?? ''}" step="any" style="width:80px;padding:4px 6px;font-size:13px;" />
    <select class="cond-lookback" style="padding:4px 6px;font-size:13px;">
      <option value="today"${(c.lookback||'today')==='today'?' selected':''}>Today</option>
      <option value="last_3d"${c.lookback==='last_3d'?' selected':''}>Last 3d</option>
      <option value="last_7d"${c.lookback==='last_7d'?' selected':''}>Last 7d</option>
      <option value="last_30m"${c.lookback==='last_30m'?' selected':''}>Last 30m</option>
    </select>
    <button onclick="this.parentElement.remove()" class="btn-danger btn-sm">×</button>
  `;
  builder.appendChild(div);
}

function collectConditions() {
  return [...document.querySelectorAll('.condition-row')].map(row => ({
    metric: row.querySelector('.cond-metric').value,
    operator: row.querySelector('.cond-operator').value,
    value: parseFloat(row.querySelector('.cond-value').value),
    lookback: row.querySelector('.cond-lookback')?.value || 'today',
  }));
}

async function saveRule() {
  const body = {
    name: document.getElementById('rule-name').value.trim(),
    scope: document.getElementById('rule-scope').value,
    conditions: collectConditions(),
    combinator: document.querySelector('input[name="rule-combinator"]:checked')?.value || 'AND',
    action: document.getElementById('rule-action').value,
    action_params: document.getElementById('rule-action').value === 'scale_budget'
      ? { scale_pct: parseInt(document.getElementById('scale-pct').value), cap: parseInt(document.getElementById('scale-cap').value) }
      : null,
    cooldown_hours: parseInt(document.getElementById('rule-cooldown').value),
    is_dry_run: document.getElementById('rule-dry-run').checked ? 1 : 0,
    alert_level: document.getElementById('rule-alert-level').value,
    is_active: document.getElementById('rule-active').checked ? 1 : 0,
  };
  const url = editingRuleId ? `/api/rules-engine/ui/rules/${editingRuleId}` : '/api/rules-engine/ui/rules';
  const method = editingRuleId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) { closeRuleEditor(); await loadRules(); }
  else if (typeof showError === 'function') { const e = await res.json(); showError('Failed to save: ' + e.error); }
}

async function editRule(id) {
  const res = await fetch(`/api/rules-engine/ui/rules/${id}`);
  if (!res.ok) { if (typeof showError === 'function') showError('Failed to load rule. Try again.'); return; }
  const rule = await res.json();
  editingRuleId = id;
  document.getElementById('rule-name').value = rule.name;
  document.getElementById('rule-scope').value = rule.scope;
  document.getElementById('rule-action').value = rule.action;
  document.getElementById('rule-cooldown').value = rule.cooldown_hours;
  document.getElementById('rule-dry-run').checked = !!rule.is_dry_run;
  document.getElementById('rule-active').checked = rule.is_active !== 0;
  document.getElementById('rule-alert-level').value = rule.alert_level || 'warning';
  document.getElementById('conditions-builder').innerHTML = '';
  JSON.parse(rule.conditions_json).forEach(c => addConditionRow(c));
  const combinator = rule.combinator || 'AND';
  document.querySelectorAll('input[name="rule-combinator"]').forEach(r => { r.checked = r.value === combinator; });
  document.getElementById('rule-editor').style.display = 'block';
  document.getElementById('rule-editor-title').textContent = 'Edit Rule';
  // show tabs for edit mode
  document.getElementById('rule-editor-tabs').style.display = 'block';
  switchRuleTab('configure');
  // pre-load dropdowns for assign tab
  loadVerticals().then(() => {
    const sel = document.getElementById('assign-vertical-select');
    if (sel) {
      const verts = [...document.getElementById('bulk-vertical-select').options];
      sel.innerHTML = '<option value="">Select vertical...</option>' + verts.slice(1).map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.text)}</option>`).join('');
      makeTomSelect('assign-vertical-select', 'Select vertical...');
    }
  });
  fetch('/api/rules-engine/ui/campaigns/cached').then(r => r.json()).then(camps => {
    const sel = document.getElementById('assign-campaign-select');
    if (sel) {
      sel.innerHTML = '<option value="">Select campaign...</option>' + camps.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
      makeTomSelect('assign-campaign-select', 'Search campaign...');
    }
  });
}

function switchRuleTab(tab) {
  document.getElementById('rule-tab-configure').style.display = tab === 'configure' ? '' : 'none';
  document.getElementById('rule-tab-assign').style.display = tab === 'assign' ? '' : 'none';
  document.querySelectorAll('.rule-tab-btn').forEach(btn => {
    const active = btn.dataset.rtab === tab;
    btn.style.borderBottomColor = active ? '#3b82f6' : 'transparent';
    btn.style.fontWeight = active ? '600' : 'normal';
  });
  if (tab === 'assign' && editingRuleId) loadRuleAssignments(editingRuleId);
}

async function loadRuleAssignments(ruleId) {
  const el = document.getElementById('assignments-list');
  el.textContent = 'Loading...';
  const [res, campsRes] = await Promise.all([
    fetch(`/api/rules-engine/ui/rules/${ruleId}/assignments`),
    fetch('/api/rules-engine/ui/campaigns/cached'),
  ]);
  const rows = res.ok ? await res.json() : [];
  const camps = campsRes.ok ? await campsRes.json() : [];
  const campMap = {};
  camps.forEach(c => { campMap[c.id] = c.name; });
  if (!rows.length) { el.innerHTML = '<em style="color:#aaa;">No assignments yet.</em>'; return; }
  el.innerHTML = rows.map(a => {
    const label = a.entity_type === 'campaign' && campMap[a.entity_id]
      ? `${escapeHtml(campMap[a.entity_id])} <span style="color:#aaa;font-size:11px;">${escapeHtml(a.entity_id)}</span>`
      : escapeHtml(a.entity_id);
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0;">
      <span><span style="background:#e8f4fd;padding:1px 6px;border-radius:3px;font-size:11px;margin-right:6px;">${escapeHtml(a.entity_type)}</span>${label}</span>
      <button class="btn-danger btn-sm" onclick="removeRuleAssignment(${ruleId},'${escapeHtml(a.entity_type)}','${escapeHtml(a.entity_id)}')">Remove</button>
    </div>`;
  }).join('');
}

async function addRuleAssignment(entityType) {
  if (!editingRuleId) return;
  let entityId;
  if (entityType === 'vertical') entityId = document.getElementById('assign-vertical-select').value;
  else if (entityType === 'tag') entityId = document.getElementById('assign-tag-input').value.trim();
  else if (entityType === 'campaign') entityId = document.getElementById('assign-campaign-select').value;
  if (!entityId) { window.showError?.('Select a value first.'); return; }
  const res = await fetch(`/api/rules-engine/ui/rules/${editingRuleId}/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: [{ entity_type: entityType, entity_id: entityId }] }),
  });
  if (!res.ok) { window.showError?.('Failed to assign.'); return; }
  if (entityType === 'tag') document.getElementById('assign-tag-input').value = '';
  loadRuleAssignments(editingRuleId);
}

async function removeRuleAssignment(ruleId, entityType, entityId) {
  const res = await fetch(`/api/rules-engine/ui/rules/${ruleId}/assign`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
  });
  if (!res.ok) { window.showError?.('Failed to remove.'); return; }
  loadRuleAssignments(ruleId);
}

function closeRuleEditor() {
  document.getElementById('rule-editor').style.display = 'none';
  document.getElementById('rule-editor-tabs').style.display = 'none';
  switchRuleTab('configure');
  editingRuleId = null;
}

// ── Shared confirm-delete dialog ──────────────────────────────────────
function showConfirmDelete(message, onConfirm) {
  const panel = document.getElementById('re-delete-confirm');
  const msg = document.getElementById('re-delete-msg');
  if (!panel) return;
  msg.textContent = message;
  panel.style.display = 'block';
  const yes = document.getElementById('re-delete-yes').cloneNode(true);
  const no = document.getElementById('re-delete-no').cloneNode(true);
  document.getElementById('re-delete-yes').replaceWith(yes);
  document.getElementById('re-delete-no').replaceWith(no);
  yes.addEventListener('click', async () => {
    panel.style.display = 'none';
    await onConfirm();
  });
  no.addEventListener('click', () => { panel.style.display = 'none'; });
}

function confirmDeleteRule(id, name) {
  showConfirmDelete(`Delete rule "${name}"? This cannot be undone.`, async () => {
    const res = await fetch(`/api/rules-engine/ui/rules/${id}`, { method: 'DELETE' });
    if (!res.ok) { if (typeof showError === 'function') showError('Failed to delete rule. Try again.'); return; }
    await loadRules();
  });
}

// ── Schedules ─────────────────────────────────────────────────────────
let editingScheduleId = null;
let assigningScheduleId = null;

async function loadSchedules() {
  const tbody = document.getElementById('schedules-body');
  try {
    const res = await fetch('/api/rules-engine/ui/schedules');
    if (!res.ok) throw new Error('Server error');
    const schedules = await res.json();
    if (schedules.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:12px 8px;color:#888;">No schedules yet.</td></tr>';
      return;
    }
    // Fetch campaign counts in parallel
    const counts = await Promise.all(schedules.map(s =>
      fetch(`/api/rules-engine/ui/schedules/${s.id}/campaigns`).then(r => r.json()).then(d => d.count || 0).catch(() => 0)
    ));
    tbody.innerHTML = schedules.map((s, i) => {
      const days = JSON.parse(s.days_json).map(d => DAY_NAMES[d]).join(', ');
      return `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">${escapeHtml(s.name)}</td>
        <td style="padding:8px;">${escapeHtml(days)}</td>
        <td style="padding:8px;">${escapeHtml(s.start_time)} – ${escapeHtml(s.end_time)} ET</td>
        <td style="padding:8px;"><button class="btn-secondary btn-sm sched-assign-btn" data-sched-id="${s.id}" data-sched-name="${escapeHtml(s.name)}">${counts[i]} campaign(s)</button></td>
        <td style="padding:8px;white-space:nowrap;">
          <button class="btn-sm edit-schedule-btn" data-sched-id="${s.id}">Edit</button>
          <button class="btn-danger btn-sm delete-schedule-btn" data-sched-id="${s.id}" data-sched-name="${escapeHtml(s.name)}">Delete</button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:12px 8px;color:#dc3545;">Failed to load.</td></tr>';
  }
}

async function editSchedule(id) {
  const res = await fetch('/api/rules-engine/ui/schedules');
  if (!res.ok) return;
  const schedules = await res.json();
  const s = schedules.find(x => x.id === id);
  if (!s) return;
  editingScheduleId = id;
  document.getElementById('schedule-editor-title').textContent = 'Edit Schedule';
  document.getElementById('schedule-name').value = s.name;
  const days = JSON.parse(s.days_json);
  document.querySelectorAll('.day-picker input').forEach(el => { el.checked = days.includes(parseInt(el.value)); });
  document.getElementById('schedule-start').value = s.start_time;
  document.getElementById('schedule-end').value = s.end_time;
  document.getElementById('schedule-editor').style.display = 'block';
}

async function saveSchedule() {
  const days = [...document.querySelectorAll('.day-picker input:checked')].map(el => parseInt(el.value));
  const body = {
    name: document.getElementById('schedule-name').value.trim(),
    days, start_time: document.getElementById('schedule-start').value,
    end_time: document.getElementById('schedule-end').value,
    timezone: 'America/New_York', is_active: 1,
  };
  const url = editingScheduleId ? `/api/rules-engine/ui/schedules/${editingScheduleId}` : '/api/rules-engine/ui/schedules';
  const method = editingScheduleId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { window.showError?.('Failed to save schedule.'); return; }
  closeScheduleEditor();
  await loadSchedules();
}

function confirmDeleteSchedule(id, name) {
  showConfirmDelete(`Delete schedule "${name}"? This cannot be undone.`, async () => {
    const res = await fetch(`/api/rules-engine/ui/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) { window.showError?.('Failed to delete schedule.'); return; }
    await loadSchedules();
  });
}

function closeScheduleEditor() {
  document.getElementById('schedule-editor').style.display = 'none';
  document.getElementById('schedule-editor-title').textContent = 'New Schedule';
  editingScheduleId = null;
}

async function openScheduleAssign(id, name) {
  assigningScheduleId = id;
  document.getElementById('schedule-assign-name').textContent = name;
  document.getElementById('schedule-assign-panel').style.display = 'block';
  // Load campaign dropdown
  const campsRes = await fetch('/api/rules-engine/ui/campaigns/cached');
  const camps = campsRes.ok ? await campsRes.json() : [];
  // Destroy existing TomSelect first, then rebuild options
  if (_tomSelects['schedule-campaign-select']) {
    _tomSelects['schedule-campaign-select'].destroy();
    delete _tomSelects['schedule-campaign-select'];
  }
  const sel = document.getElementById('schedule-campaign-select');
  sel.innerHTML = camps.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  _tomSelects['schedule-campaign-select'] = new TomSelect(sel, {
    placeholder: 'Search campaign...',
    maxOptions: 500,
  });
  await loadScheduleCampaigns(id);
}

async function loadScheduleCampaigns(schedId) {
  const el = document.getElementById('schedule-campaigns-list');
  el.textContent = 'Loading...';
  const res = await fetch(`/api/rules-engine/ui/schedules/${schedId}/campaigns`);
  const data = res.ok ? await res.json() : { campaigns: [] };
  if (!data.campaigns.length) { el.innerHTML = '<em style="color:#aaa;">No campaigns assigned.</em>'; return; }
  el.innerHTML = data.campaigns.map(c => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0;">
      <span>${escapeHtml(c.name || c.id)}<span style="color:#aaa;font-size:11px;margin-left:6px;">${c.name ? escapeHtml(c.id) : '(not in cache)'}</span></span>
      <button class="btn-danger btn-sm" onclick="unassignCampaignFromSchedule('${escapeHtml(c.id)}')">Remove</button>
    </div>
  `).join('');
}

async function assignCampaignToSchedule() {
  if (!assigningScheduleId) return;
  const cid = document.getElementById('schedule-campaign-select').value;
  if (!cid) { window.showError?.('Select a campaign first.'); return; }
  const res = await fetch(`/api/rules-engine/ui/schedules/${assigningScheduleId}/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_ids: [cid] }),
  });
  if (!res.ok) { window.showError?.('Failed to assign.'); return; }
  await loadScheduleCampaigns(assigningScheduleId);
  await loadSchedules();
}

async function unassignCampaignFromSchedule(campaignId) {
  if (!assigningScheduleId) return;
  const res = await fetch(`/api/rules-engine/ui/schedules/${assigningScheduleId}/assign`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_id: campaignId }),
  });
  if (!res.ok) { window.showError?.('Failed to remove.'); return; }
  await loadScheduleCampaigns(assigningScheduleId);
  await loadSchedules();
}

function closeScheduleAssign() {
  document.getElementById('schedule-assign-panel').style.display = 'none';
  assigningScheduleId = null;
}

// ── Verticals ─────────────────────────────────────────────────────────
async function loadVerticals() {
  const tbody = document.getElementById('verticals-body');
  try {
    const [vertRes, schedRes] = await Promise.all([
      fetch('/api/rules-engine/ui/verticals'),
      fetch('/api/rules-engine/ui/schedules'),
    ]);
    if (!vertRes.ok) throw new Error('Server error');
    const verticals = await vertRes.json();
    const schedules = schedRes.ok ? await schedRes.json() : [];
    const schedMap = {};
    schedules.forEach(s => { schedMap[s.id] = s.name; });
    const schedOpts = '<option value="">None</option>' + schedules.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

    const options = '<option value="">Select vertical</option>' + verticals.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
    document.getElementById('bulk-vertical-select').innerHTML = options;
    makeTomSelect('bulk-vertical-select', 'Select vertical...');
    if (verticals.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 8px;color:#888;">No verticals yet.</td></tr>';
      return;
    }
    tbody.innerHTML = verticals.map(v => `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">${escapeHtml(v.name)}</td>
        <td style="padding:8px;">
          <select class="vert-schedule-select" data-vert-id="${v.id}" style="padding:4px 6px;font-size:13px;">
            ${schedOpts.replace(`value="${v.default_schedule_id}"`, `value="${v.default_schedule_id}" selected`)}
          </select>
        </td>
        <td style="padding:8px;white-space:nowrap;">
          <button class="btn-secondary btn-sm view-vert-campaigns-btn" data-vert-id="${v.id}" data-vert-name="${escapeHtml(v.name)}" style="margin-right:6px;">View Campaigns</button>
          <button class="btn-secondary btn-sm clear-vert-campaigns-btn" data-vert-id="${v.id}" data-vert-name="${escapeHtml(v.name)}" style="margin-right:6px;">Clear</button>
          <button class="btn-danger btn-sm delete-vertical-btn" data-vert-id="${v.id}" data-vert-name="${escapeHtml(v.name)}">Delete</button>
        </td>
      </tr>
      <tr id="vert-campaigns-${v.id}" style="display:none;background:#f9f9f9;">
        <td colspan="3" style="padding:8px 16px;">
          <div id="vert-campaigns-inner-${v.id}" style="font-size:13px;color:#555;">Loading...</div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 8px;color:#dc3545;">Failed to load.</td></tr>';
  }
}

async function saveVertical() {
  const name = document.getElementById('vertical-name').value.trim();
  if (!name) return;
  const res = await fetch('/api/rules-engine/ui/verticals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!res.ok) { if (typeof showError === 'function') showError('Failed to save vertical. Try again.'); return; }
  document.getElementById('vertical-editor').style.display = 'none';
  await loadVerticals();
}

function confirmDeleteVertical(id, name) {
  showConfirmDelete(`Delete vertical "${name}"? This cannot be undone.`, async () => {
    const res = await fetch(`/api/rules-engine/ui/verticals/${id}`, { method: 'DELETE' });
    if (!res.ok) { if (typeof showError === 'function') showError('Failed to delete vertical. Try again.'); return; }
    await loadVerticals();
  });
}

function showAddVertical() { document.getElementById('vertical-editor').style.display = 'block'; }

async function toggleVerticalCampaigns(id, name, btn) {
  const row = document.getElementById(`vert-campaigns-${id}`);
  if (row.style.display !== 'none') {
    row.style.display = 'none';
    btn.textContent = 'View Campaigns';
    return;
  }
  row.style.display = '';
  btn.textContent = 'Hide';
  const inner = document.getElementById(`vert-campaigns-inner-${id}`);
  inner.textContent = 'Loading...';
  try {
    const [campRes, cachedRes] = await Promise.all([
      fetch(`/api/rules-engine/ui/verticals/${id}/campaigns`),
      fetch('/api/rules-engine/ui/campaigns/cached'),
    ]);
    if (!campRes.ok) throw new Error('Server error');
    const data = await campRes.json();
    const cached = cachedRes.ok ? await cachedRes.json() : [];
    const assignedIds = new Set(data.campaigns.map(c => c.id));
    const available = cached.filter(c => !assignedIds.has(c.id));
    const listHtml = data.campaigns.length === 0
      ? '<em>No campaigns assigned yet.</em>'
      : `<strong>${data.count} campaign(s) in "${escapeHtml(data.vertical)}"</strong>
         <ul style="margin:6px 0 0 0;padding:0 0 0 16px;max-height:200px;overflow-y:auto;">
           ${data.campaigns.map(c => `<li style="display:flex;align-items:center;justify-content:space-between;margin:2px 0;">
             <span>${escapeHtml(c.name || c.id)}<span style="color:#aaa;font-size:11px;margin-left:6px;">${c.name ? escapeHtml(c.id) : '(not in cache)'}</span></span>
             <button class="btn-danger btn-sm vert-unassign-btn" data-vert-id="${id}" data-vert-name="${escapeHtml(name)}" data-camp-id="${escapeHtml(c.id)}" style="margin-left:8px;">Remove</button>
           </li>`).join('')}
         </ul>`;
    inner.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
        <select id="vert-camp-select-${id}" style="flex:1;min-width:0;padding:6px;font-size:13px;">
          ${available.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <button class="btn-primary btn-sm vert-assign-btn" data-vert-id="${id}" data-vert-name="${escapeHtml(name)}">Assign</button>
      </div>
      ${listHtml}`;
    // Init TomSelect on the dropdown
    const selId = `vert-camp-select-${id}`;
    if (_tomSelects[selId]) { _tomSelects[selId].destroy(); delete _tomSelects[selId]; }
    const selEl = document.getElementById(selId);
    if (selEl && typeof TomSelect !== 'undefined') {
      _tomSelects[selId] = new TomSelect(selEl, { placeholder: 'Search campaign...', maxOptions: 500 });
    }
  } catch (err) {
    inner.textContent = 'Failed to load campaigns.';
  }
}

async function bulkAssignByPattern() {
  const pattern = document.getElementById('bulk-pattern').value.trim();
  const vertical = document.getElementById('bulk-vertical-select').value;
  if (!pattern || !vertical) { if (typeof showError === 'function') showError('Enter a pattern and select a vertical.'); return; }
  const preview = document.getElementById('bulk-preview');
  preview.textContent = 'Assigning...';
  const res = await fetch('/api/rules-engine/ui/campaigns/labels/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern, label_type: 'vertical', label_value: vertical }),
  });
  if (!res.ok) { if (typeof showError === 'function') showError('Failed to bulk assign. Try again.'); preview.textContent = ''; return; }
  const data = await res.json();
  preview.textContent = `Assigned ${data.matched} campaign(s) matching "${pattern}" to "${vertical}"`;
  await loadVerticals();
}

// ── Coverage ─────────────────────────────────────────────────────────
async function loadCoverage() {
  const tbody = document.getElementById('coverage-body');
  tbody.innerHTML = '<tr><td colspan="4" style="padding:12px 8px;color:#888;">Loading...</td></tr>';
  try {
    const [res, vertRes] = await Promise.all([
      fetch('/api/rules-engine/ui/coverage'),
      fetch('/api/rules-engine/ui/verticals'),
    ]);
    if (!res.ok) throw new Error('Server error');
    const orphans = await res.json();
    const verticals = vertRes.ok ? await vertRes.json() : [];
    const vertOpts = verticals.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
    if (orphans.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:12px 8px;color:#28a745;">All campaigns are covered.</td></tr>';
      return;
    }
    tbody.innerHTML = orphans.map(c => `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">${escapeHtml(c.name || c.id)}</td>
        <td style="padding:8px;">${c.missing_rule ? '<span style="color:#f59e0b;">No rule</span>' : '<span style="color:#28a745;">OK</span>'}</td>
        <td style="padding:8px;">${c.missing_schedule ? '<span style="color:#f59e0b;">No schedule</span>' : '<span style="color:#28a745;">OK</span>'}</td>
        <td style="padding:8px;">
          <div style="display:flex;gap:4px;align-items:center;">
            <select class="coverage-vert-select" style="padding:3px 6px;font-size:12px;">
              <option value="">Vertical...</option>${vertOpts}
            </select>
            <button class="btn-sm quick-assign-btn" data-camp-id="${escapeHtml(String(c.id))}">Assign</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:12px 8px;color:#dc3545;">Failed to load.</td></tr>';
  }
}

// ── Activity Log ──────────────────────────────────────────────────────
async function loadLogs() {
  const tbody = document.getElementById('logs-body');
  tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 8px;color:#888;">Loading...</td></tr>';
  try {
    const dateFrom = document.getElementById('log-date-from').value;
    const dateTo = document.getElementById('log-date-to').value;
    const dryRunOnly = document.getElementById('log-dryrun-filter').checked;
    let url = '/api/rules-engine/ui/logs?limit=500';
    if (dateFrom) url += `&date_from=${dateFrom}`;
    if (dateTo) url += `&date_to=${dateTo}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Server error');
    let logs = await res.json();
    if (dryRunOnly) logs = logs.filter(l => l.is_dry_run === 1);
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 8px;color:#888;">No log entries found.</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => {
      const time = new Date(l.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' });
      const triggerData = l.trigger_data_json
        ? Object.entries(JSON.parse(l.trigger_data_json)).map(([k,v]) => `${escapeHtml(String(k))}: ${escapeHtml(String(v))}`).join(' | ')
        : '—';
      return `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;font-size:12px;">${escapeHtml(time)}</td>
        <td style="padding:8px;">${l.rule_id ? escapeHtml(String(l.rule_id)) : '—'}</td>
        <td style="padding:8px;">${escapeHtml(l.entity_name || String(l.entity_id))}</td>
        <td style="padding:8px;">${escapeHtml(l.action_taken)}</td>
        <td style="padding:8px;font-size:11px;color:#666;">${triggerData}</td>
        <td style="padding:8px;">${l.is_dry_run
          ? '<span style="background:#fff3cd;color:#856404;padding:2px 6px;border-radius:3px;font-size:11px;">DRY RUN</span>'
          : '<span style="background:#d4edda;color:#155724;padding:2px 6px;border-radius:3px;font-size:11px;">LIVE</span>'}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 8px;color:#dc3545;">Failed to load.</td></tr>';
  }
}

// ── Panel init ────────────────────────────────────────────────────────
function initRulesEnginePanel() {
  document.getElementById('rules-engine-btn').addEventListener('click', openRulesEnginePanel);
  document.getElementById('rules-engine-panel-close').addEventListener('click', closeRulesEnginePanel);

  // Tab switching
  document.querySelectorAll('.re-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchReTab(btn.dataset.tab));
  });

  // Close on backdrop click
  document.getElementById('rules-engine-panel').addEventListener('click', (e) => {
    if (e.target === document.getElementById('rules-engine-panel')) closeRulesEnginePanel();
  });

  // Rule editor: show/hide scale params
  document.getElementById('rule-action').addEventListener('change', e => {
    document.getElementById('scale-params').style.display = e.target.value === 'scale_budget' ? 'flex' : 'none';
  });

  // New rule button
  document.getElementById('new-rule-btn').addEventListener('click', () => {
    editingRuleId = null;
    document.getElementById('rule-editor').style.display = 'block';
    document.getElementById('rule-editor-title').textContent = 'New Rule';
    document.getElementById('rule-editor-tabs').style.display = 'none';
    document.getElementById('conditions-builder').innerHTML = '';
    document.getElementById('rule-name').value = '';
    document.getElementById('rule-active').checked = true;
    document.getElementById('rule-dry-run').checked = false;
  });

  // Rule editor tab switching
  document.getElementById('rule-editor-tabs').addEventListener('click', (e) => {
    if (e.target.classList.contains('rule-tab-btn')) switchRuleTab(e.target.dataset.rtab);
  });

  // New schedule button
  document.getElementById('new-schedule-btn').addEventListener('click', () => {
    editingScheduleId = null;
    document.getElementById('schedule-editor').style.display = 'block';
    document.getElementById('schedule-editor-title').textContent = 'New Schedule';
    document.getElementById('schedule-name').value = '';
    document.getElementById('schedule-start').value = '';
    document.getElementById('schedule-end').value = '';
    document.querySelectorAll('.day-picker input').forEach(cb => cb.checked = false);
  });

  // Event delegation for rules table (edit + delete)
  document.getElementById('rules-body').addEventListener('click', (e) => {
    if (e.target.classList.contains('edit-rule-btn')) {
      editRule(e.target.dataset.ruleId);
    }
    if (e.target.classList.contains('delete-rule-btn')) {
      confirmDeleteRule(parseInt(e.target.dataset.ruleId), e.target.dataset.ruleName);
    }
  });

  // Event delegation for templates
  document.getElementById('rule-templates').addEventListener('click', (e) => {
    if (e.target.classList.contains('apply-template-btn')) {
      applyTemplate(Number(e.target.dataset.templateIndex));
    }
  });

  // Event delegation for schedules (edit + assign + delete)
  document.getElementById('schedules-body').addEventListener('click', (e) => {
    if (e.target.classList.contains('edit-schedule-btn')) {
      editSchedule(parseInt(e.target.dataset.schedId));
    }
    if (e.target.classList.contains('sched-assign-btn')) {
      openScheduleAssign(parseInt(e.target.dataset.schedId), e.target.dataset.schedName);
    }
    if (e.target.classList.contains('delete-schedule-btn')) {
      confirmDeleteSchedule(parseInt(e.target.dataset.schedId), e.target.dataset.schedName);
    }
  });

  // Event delegation for vertical schedule dropdown
  document.getElementById('verticals-body').addEventListener('change', async (e) => {
    if (e.target.classList.contains('vert-schedule-select')) {
      const vertId = parseInt(e.target.dataset.vertId);
      const schedId = e.target.value ? parseInt(e.target.value) : null;
      const res = await fetch(`/api/rules-engine/ui/verticals/${vertId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_schedule_id: schedId }),
      });
      if (!res.ok) { window.showError?.('Failed to update schedule.'); return; }
      window.showSuccess?.('Default schedule updated.');
    }
  });

  // Event delegation for verticals
  document.getElementById('verticals-body').addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-vertical-btn')) {
      confirmDeleteVertical(parseInt(e.target.dataset.vertId), e.target.dataset.vertName);
    }
    if (e.target.classList.contains('view-vert-campaigns-btn')) {
      toggleVerticalCampaigns(parseInt(e.target.dataset.vertId), e.target.dataset.vertName, e.target);
    }
    if (e.target.classList.contains('vert-assign-btn')) {
      const vertId = parseInt(e.target.dataset.vertId);
      const vertName = e.target.dataset.vertName;
      const sel = document.getElementById(`vert-camp-select-${vertId}`);
      const campId = sel?.value;
      if (!campId) { window.showError?.('Select a campaign first.'); return; }
      const res = await fetch('/api/rules-engine/ui/campaigns/labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campId, label_type: 'vertical', label_value: vertName }),
      });
      if (!res.ok) { window.showError?.('Failed to assign.'); return; }
      window.showSuccess?.('Campaign assigned to ' + vertName);
      toggleVerticalCampaigns(vertId, vertName, e.target.closest('tr').previousElementSibling.querySelector('.view-vert-campaigns-btn'));
      toggleVerticalCampaigns(vertId, vertName, e.target.closest('tr').previousElementSibling.querySelector('.view-vert-campaigns-btn'));
    }
    if (e.target.classList.contains('vert-unassign-btn')) {
      const campId = e.target.dataset.campId;
      const vertName = e.target.dataset.vertName;
      const vertId = parseInt(e.target.dataset.vertId);
      const res = await fetch('/api/rules-engine/ui/campaigns/labels', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campId, label_type: 'vertical', label_value: vertName }),
      });
      if (!res.ok) { window.showError?.('Failed to remove.'); return; }
      window.showSuccess?.('Campaign removed from ' + vertName);
      const viewBtn = e.target.closest('tr').previousElementSibling?.querySelector('.view-vert-campaigns-btn');
      if (viewBtn) { toggleVerticalCampaigns(vertId, vertName, viewBtn); toggleVerticalCampaigns(vertId, vertName, viewBtn); }
    }
    if (e.target.classList.contains('clear-vert-campaigns-btn')) {
      const { vertId, vertName } = e.target.dataset;
      showConfirmDelete(`Clear all campaign assignments from "${vertName}"? This removes the labels but keeps the vertical.`, async () => {
        const res = await fetch(`/api/rules-engine/ui/verticals/${vertId}/campaigns`, { method: 'DELETE' });
        if (!res.ok) { window.showError?.('Failed to clear.'); return; }
        window.showSuccess?.(`Cleared all campaigns from "${vertName}".`);
        loadVerticals();
      });
    }
  });

  // Event delegation for tags remove
  document.getElementById('tags-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="remove-tag"]');
    if (!btn) return;
    const res = await fetch('/api/rules-engine/ui/tags', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: btn.dataset.cid, tag: btn.dataset.tag }),
    });
    if (!res.ok) { window.showError?.('Failed to remove tag'); return; }
    loadTags();
  });

  // Event delegation for coverage quick-assign
  document.getElementById('coverage-body').addEventListener('click', async (e) => {
    if (e.target.classList.contains('quick-assign-btn')) {
      const row = e.target.closest('tr');
      const vertical = row.querySelector('.coverage-vert-select')?.value;
      if (!vertical) { window.showError?.('Select a vertical first.'); return; }
      const res = await fetch('/api/rules-engine/ui/campaigns/labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: e.target.dataset.campId, label_type: 'vertical', label_value: vertical }),
      });
      if (!res.ok) { window.showError?.('Failed to assign.'); return; }
      window.showSuccess?.('Assigned to ' + vertical);
      await loadCoverage();
    }
  });

  // Coverage search filter
  document.getElementById('coverage-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#coverage-body tr').forEach(row => {
      const name = row.querySelector('td')?.textContent?.toLowerCase() || '';
      row.style.display = name.includes(q) ? '' : 'none';
    });
  });
}

function openRulesEnginePanel() {
  document.getElementById('rules-engine-panel').style.display = 'flex';
  switchReTab('rules');
}

function closeRulesEnginePanel() {
  document.getElementById('rules-engine-panel').style.display = 'none';
}

// ── Setup Checklist ──────────────────────────────────────────────────
async function updateSetupChecklist() {
  try {
    const [tokens, verticals, rules, schedules] = await Promise.all([
      fetch('/api/fb-accounts/tokens').then(r => r.json()),
      fetch('/api/rules-engine/ui/verticals').then(r => r.json()),
      fetch('/api/rules-engine/ui/rules').then(r => r.json()),
      fetch('/api/rules-engine/ui/schedules').then(r => r.json()),
    ]);

    const checks = {
      'check-token': Array.isArray(tokens) && tokens.length > 0,
      'check-vertical': Array.isArray(verticals) && verticals.length > 0,
      'check-rule': Array.isArray(rules) && rules.length > 0,
      'check-schedule': Array.isArray(schedules) && schedules.length > 0,
    };

    let allDone = true;
    for (const [id, done] of Object.entries(checks)) {
      const el = document.getElementById(id);
      if (el) el.textContent = (done ? '✅' : '⬜') + ' ' + el.textContent.slice(2).trim();
      if (!done) allDone = false;
    }

    const checklist = document.getElementById('setup-checklist');
    if (checklist) checklist.style.display = allDone ? 'none' : 'block';
  } catch (e) {
    // Silently ignore — checklist is non-critical
  }
}

// Expose globals
window.addCondition = addCondition;
window.applyTemplate = applyTemplate;
window.saveRule = saveRule;
window.closeRuleEditor = closeRuleEditor;
// ── Tags ──────────────────────────────────────────────────────────────
async function loadTags() {
  const [tagsRes, campsRes] = await Promise.all([
    fetch('/api/rules-engine/ui/tags'),
    fetch('/api/rules-engine/ui/campaigns/cached'),
  ]);
  const tags = tagsRes.ok ? await tagsRes.json() : [];
  const camps = campsRes.ok ? await campsRes.json() : [];

  // Populate campaign dropdown (multi-select)
  const sel = document.getElementById('tag-campaign-select');
  const campMap = {};
  camps.forEach(c => { campMap[c.id] = c.name; });
  if (_tomSelects['tag-campaign-select']) { _tomSelects['tag-campaign-select'].destroy(); delete _tomSelects['tag-campaign-select']; }
  sel.innerHTML = camps.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  _tomSelects['tag-campaign-select'] = new TomSelect(sel, { placeholder: 'Search campaigns...', maxOptions: 500, plugins: ['remove_button'] });

  const tbody = document.getElementById('tags-body');
  if (!tags.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 8px;color:#888;">No tags yet.</td></tr>';
    return;
  }
  tbody.innerHTML = tags.map(t => `
    <tr>
      <td style="padding:8px;">${escapeHtml(campMap[t.campaign_id] || t.campaign_id)}<br><span style="color:#aaa;font-size:11px;">${escapeHtml(t.campaign_id)}</span></td>
      <td style="padding:8px;"><span style="background:#e8f4fd;padding:2px 8px;border-radius:12px;font-size:12px;">${escapeHtml(t.tag)}</span></td>
      <td style="padding:8px;"><button class="btn-danger btn-sm" data-action="remove-tag" data-cid="${escapeHtml(t.campaign_id)}" data-tag="${escapeHtml(t.tag)}">Remove</button></td>
    </tr>
  `).join('');
}

async function addTag() {
  const ts = _tomSelects['tag-campaign-select'];
  const campaignIds = ts ? ts.getValue() : [];
  const tag = document.getElementById('tag-value').value.trim();
  if (!campaignIds.length || !tag) { window.showError?.('Select campaign(s) and enter a tag name.'); return; }
  let ok = true;
  for (const cid of campaignIds) {
    const res = await fetch('/api/rules-engine/ui/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: cid, tag }),
    });
    if (!res.ok) ok = false;
  }
  if (!ok) { window.showError?.('Some tags failed to add.'); }
  else { window.showSuccess?.(`Tag "${tag}" added to ${campaignIds.length} campaign(s).`); }
  if (ts) ts.clear();
  document.getElementById('tag-value').value = '';
  loadTags();
}
window.addTag = addTag;

window.addRuleAssignment = addRuleAssignment;
window.removeRuleAssignment = removeRuleAssignment;
window.editRule = editRule;
window.editSchedule = editSchedule;
window.openScheduleAssign = openScheduleAssign;
window.assignCampaignToSchedule = assignCampaignToSchedule;
window.unassignCampaignFromSchedule = unassignCampaignFromSchedule;
window.closeScheduleAssign = closeScheduleAssign;
window.saveSchedule = saveSchedule;
window.closeScheduleEditor = closeScheduleEditor;
window.saveVertical = saveVertical;
window.showAddVertical = showAddVertical;
window.bulkAssignByPattern = bulkAssignByPattern;
window.loadCoverage = loadCoverage;
window.loadLogs = loadLogs;
window.initRulesEnginePanel = initRulesEnginePanel;
window.updateSetupChecklist = updateSetupChecklist;
