// public/rules-engine.js

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
];

const METRICS = [
  { value: 'spend_today', label: 'Spend Today ($)' },
  { value: 'cpa', label: 'CPA ($)' },
  { value: 'roas', label: 'ROAS' },
  { value: 'roi', label: 'ROI (%)' },
  { value: 'conversions', label: 'Conversions' },
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
  else if (tabName === 'coverage') loadCoverage();
  else if (tabName === 'activity-log') {
    document.getElementById('log-date-filter').value = new Date().toISOString().split('T')[0];
    loadLogs();
  }
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
  document.getElementById('rule-action').value = t.action;
  document.getElementById('rule-cooldown').value = t.cooldown_hours;
  document.getElementById('conditions-builder').innerHTML = '';
  t.conditions.forEach(c => addConditionRow(c));
  document.getElementById('rule-editor').style.display = 'block';
  document.getElementById('rule-editor-title').textContent = 'New Rule from Template';
  editingRuleId = null;
}

function addCondition() {
  addConditionRow({ metric: 'spend_today', operator: 'gt', value: '', lookback: 'today' });
}

function addConditionRow(c) {
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
    <input type="number" class="cond-value" value="${c.value}" step="any" style="width:80px;padding:4px 6px;font-size:13px;" />
    <button onclick="this.parentElement.remove()" class="btn-danger btn-sm">×</button>
  `;
  builder.appendChild(div);
}

function collectConditions() {
  return [...document.querySelectorAll('.condition-row')].map(row => ({
    metric: row.querySelector('.cond-metric').value,
    operator: row.querySelector('.cond-operator').value,
    value: parseFloat(row.querySelector('.cond-value').value),
    lookback: 'today',
  }));
}

async function saveRule() {
  const body = {
    name: document.getElementById('rule-name').value.trim(),
    scope: document.getElementById('rule-scope').value,
    conditions: collectConditions(),
    action: document.getElementById('rule-action').value,
    action_params: document.getElementById('rule-action').value === 'scale_budget'
      ? { scale_pct: parseInt(document.getElementById('scale-pct').value), cap: parseInt(document.getElementById('scale-cap').value) }
      : null,
    cooldown_hours: parseInt(document.getElementById('rule-cooldown').value),
    is_dry_run: document.getElementById('rule-dry-run').checked ? 1 : 0,
    is_active: 1,
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
  document.getElementById('conditions-builder').innerHTML = '';
  JSON.parse(rule.conditions_json).forEach(c => addConditionRow(c));
  document.getElementById('rule-editor').style.display = 'block';
  document.getElementById('rule-editor-title').textContent = 'Edit Rule';
}

function closeRuleEditor() {
  document.getElementById('rule-editor').style.display = 'none';
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
async function loadSchedules() {
  const tbody = document.getElementById('schedules-body');
  try {
    const res = await fetch('/api/rules-engine/ui/schedules');
    if (!res.ok) throw new Error('Server error');
    const schedules = await res.json();
    if (schedules.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:12px 8px;color:#888;">No schedules yet.</td></tr>';
      return;
    }
    tbody.innerHTML = schedules.map(s => {
      const days = JSON.parse(s.days_json).map(d => DAY_NAMES[d]).join(', ');
      return `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">${escapeHtml(s.name)}</td>
        <td style="padding:8px;">${escapeHtml(days)}</td>
        <td style="padding:8px;">${escapeHtml(s.start_time)} – ${escapeHtml(s.end_time)} ET</td>
        <td style="padding:8px;">
          <button class="btn-danger btn-sm delete-schedule-btn" data-sched-id="${s.id}" data-sched-name="${escapeHtml(s.name)}">Delete</button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:12px 8px;color:#dc3545;">Failed to load.</td></tr>';
  }
}

async function saveSchedule() {
  const days = [...document.querySelectorAll('.day-picker input:checked')].map(el => parseInt(el.value));
  const body = {
    name: document.getElementById('schedule-name').value.trim(),
    days, start_time: document.getElementById('schedule-start').value,
    end_time: document.getElementById('schedule-end').value,
    timezone: 'America/New_York', is_active: 1,
  };
  const res = await fetch('/api/rules-engine/ui/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { if (typeof showError === 'function') showError('Failed to save schedule. Try again.'); return; }
  closeScheduleEditor();
  await loadSchedules();
}

function confirmDeleteSchedule(id, name) {
  showConfirmDelete(`Delete schedule "${name}"? This cannot be undone.`, async () => {
    const res = await fetch(`/api/rules-engine/ui/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) { if (typeof showError === 'function') showError('Failed to delete schedule. Try again.'); return; }
    await loadSchedules();
  });
}

function closeScheduleEditor() { document.getElementById('schedule-editor').style.display = 'none'; }

// ── Verticals ─────────────────────────────────────────────────────────
async function loadVerticals() {
  const tbody = document.getElementById('verticals-body');
  try {
    const res = await fetch('/api/rules-engine/ui/verticals');
    if (!res.ok) throw new Error('Server error');
    const verticals = await res.json();
    const sel = document.getElementById('bulk-vertical-select');
    sel.innerHTML = '<option value="">Select vertical</option>' + verticals.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');
    if (verticals.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="padding:12px 8px;color:#888;">No verticals yet.</td></tr>';
      return;
    }
    tbody.innerHTML = verticals.map(v => `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">${escapeHtml(v.name)}</td>
        <td style="padding:8px;">${v.default_schedule_id ? `Schedule #${escapeHtml(String(v.default_schedule_id))}` : 'None'}</td>
        <td style="padding:8px;">
          <button class="btn-danger btn-sm delete-vertical-btn" data-vert-id="${v.id}" data-vert-name="${escapeHtml(v.name)}">Delete</button>
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
}

// ── Coverage ─────────────────────────────────────────────────────────
async function loadCoverage() {
  const tbody = document.getElementById('coverage-body');
  tbody.innerHTML = '<tr><td colspan="4" style="padding:12px 8px;color:#888;">Loading...</td></tr>';
  try {
    const res = await fetch('/api/rules-engine/ui/coverage');
    if (!res.ok) throw new Error('Server error');
    const orphans = await res.json();
    if (orphans.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:12px 8px;color:#28a745;">All campaigns are covered.</td></tr>';
      return;
    }
    tbody.innerHTML = orphans.map(c => `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">${escapeHtml(c.name || c.id)}</td>
        <td style="padding:8px;">${c.missing_rule ? '<span style="color:#f59e0b;">No rule</span>' : '<span style="color:#28a745;">OK</span>'}</td>
        <td style="padding:8px;">${c.missing_schedule ? '<span style="color:#f59e0b;">No schedule</span>' : '<span style="color:#28a745;">OK</span>'}</td>
        <td style="padding:8px;"><button class="btn-sm quick-assign-btn" data-camp-id="${escapeHtml(String(c.id))}">Assign to Vertical</button></td>
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
    const date = document.getElementById('log-date-filter').value;
    const dryRunOnly = document.getElementById('log-dryrun-filter').checked;
    let url = '/api/rules-engine/ui/logs?limit=200';
    if (date) url += `&date=${date}`;
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
    document.getElementById('conditions-builder').innerHTML = '';
    document.getElementById('rule-name').value = '';
  });

  // New schedule button
  document.getElementById('new-schedule-btn').addEventListener('click', () => {
    document.getElementById('schedule-editor').style.display = 'block';
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

  // Event delegation for schedules delete
  document.getElementById('schedules-body').addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-schedule-btn')) {
      confirmDeleteSchedule(parseInt(e.target.dataset.schedId), e.target.dataset.schedName);
    }
  });

  // Event delegation for verticals delete
  document.getElementById('verticals-body').addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-vertical-btn')) {
      confirmDeleteVertical(parseInt(e.target.dataset.vertId), e.target.dataset.vertName);
    }
  });

  // Event delegation for coverage quick-assign
  document.getElementById('coverage-body').addEventListener('click', async (e) => {
    if (e.target.classList.contains('quick-assign-btn')) {
      const vertical = document.getElementById('bulk-vertical-select')?.value;
      if (!vertical) { if (typeof showError === 'function') showError('Go to Verticals tab first and create a vertical.'); return; }
      const res = await fetch('/api/rules-engine/ui/campaigns/labels/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: e.target.dataset.campId, label_type: 'vertical', label_value: vertical }),
      });
      if (!res.ok) { if (typeof showError === 'function') showError('Failed to assign campaign to vertical. Try again.'); return; }
      await loadCoverage();
    }
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
window.editRule = editRule;
window.saveSchedule = saveSchedule;
window.closeScheduleEditor = closeScheduleEditor;
window.saveVertical = saveVertical;
window.showAddVertical = showAddVertical;
window.bulkAssignByPattern = bulkAssignByPattern;
window.loadCoverage = loadCoverage;
window.loadLogs = loadLogs;
window.initRulesEnginePanel = initRulesEnginePanel;
window.updateSetupChecklist = updateSetupChecklist;
