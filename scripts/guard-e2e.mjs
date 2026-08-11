/**
 * End-to-end for the ZuckCannon Project 6 rails.
 *
 * Real axios singleton, real interceptor, real HTTP over the loopback to a stub standing in
 * for the Graph API. Nothing here is mocked — if the guard fails to refuse, the stub records
 * the request, which is the whole point of using a server instead of a spy.
 */
import http from 'http';
import express from 'express';
import axios from 'axios';

import { installMetaGuard, engageKillSwitch, releaseKillSwitch, markBudgetDecrease } from
  '../backend/utils/meta-guard.js';
import { validateRequest } from
  '../backend/middleware/validation.js';

installMetaGuard(axios);

// --- the stub Graph API ----------------------------------------------------------
const received = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    received.push({ method: req.method, url: req.url, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `OBJ_${received.length}` }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const PORT = stub.address().port;

// The interceptor keys off the URL containing graph.facebook.com, so the loopback path
// carries it. Everything else — axios, the request, the socket — is real.
const graph = (p) => `http://127.0.0.1:${PORT}/graph.facebook.com/v25.0${p}`;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

const attempt = async (fn) => {
  try { await fn(); return { refused: false }; }
  catch (e) { return { refused: true, code: e.code, message: e.message }; }
};

// --- A. normal write goes through ------------------------------------------------
releaseKillSwitch();
received.length = 0;
await axios.post(graph('/act_555/campaigns'), { name: 'Test', daily_budget: 5000 });
check('create a campaign with a budget goes through', received.length === 1,
  `${received.length} request(s) reached the stub`);

// --- B. kill switch --------------------------------------------------------------
engageKillSwitch('e2e check');
received.length = 0;
const b = await attempt(() => axios.post(graph('/act_555/ads'), { name: 'Blocked' }));
check('kill switch refuses the write', b.refused && b.code === 'KILL_SWITCH_ON', b.code);
check('kill switch: nothing reached Meta', received.length === 0,
  `${received.length} request(s) reached the stub`);

// Reads must keep working, or the dashboard dies whenever the switch is on.
const bRead = await attempt(() => axios.get(graph('/act_555/campaigns?fields=name')));
check('kill switch leaves reads alone', !bRead.refused, bRead.message || '');

releaseKillSwitch();
const bAfter = await attempt(() => axios.post(graph('/act_555/ads'), { name: 'Allowed' }));
check('write resumes on the next call after release', !bAfter.refused, bAfter.message || '');

// --- C. budget ban ---------------------------------------------------------------
received.length = 0;
const c1 = await attempt(() => axios.post(graph('/120210000000'), { daily_budget: 99999 }));
check('changing daily_budget on a live campaign is refused',
  c1.refused && c1.code === 'BUDGET_CHANGE_BLOCKED', c1.code);
check('budget ban: nothing reached Meta', received.length === 0,
  `${received.length} request(s) reached the stub`);

const c2 = await attempt(() => axios.post(graph('/120210000000'), { status: 'PAUSED' }));
check('pausing a live campaign still works', !c2.refused, c2.message || '');

const c3 = await attempt(() => axios.post(graph('/act_555/adsets'), { daily_budget: 5000 }));
check('creating an ad set with a budget still works', !c3.refused, c3.message || '');

// --- D. hourly cap ---------------------------------------------------------------
// Set after import on purpose: the cap is read per call, so a live change must take effect
// without a restart. Baking it in at module load is the bug this check exists to catch.
process.env.META_MAX_CALLS_PER_HOUR = '3';
const account = `act_${Date.now() % 1000000}`;
received.length = 0;
let landed = 0;
let capMessage = '';
for (let i = 0; i < 6; i++) {
  const r = await attempt(() => axios.post(graph(`/${account}/ads`), { name: `ad-${i}` }));
  if (r.refused) { capMessage = r.message; break; }
  landed++;
}
check('hourly cap stops the run at the ceiling', landed === 3 && capMessage.includes('cap is 3'),
  `${landed} landed, then: ${capMessage.slice(0, 70)}`);
check('hourly cap: only the allowed calls reached Meta', received.length === 3,
  `${received.length} request(s) reached the stub`);

// --- E. the automated-rule path, through the real express stack -------------------
const app = express();
app.use(express.json());
app.post('/api/rules', validateRequest.createRule, (req, res) => res.json({ created: true }));

const post = (payload) => new Promise((resolve) => {
  const data = JSON.stringify(payload);
  const req = http.request(
    { host: '127.0.0.1', port: apiPort, path: '/api/rules', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
    (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    }
  );
  req.end(data);
});

const api = app.listen(0, '127.0.0.1');
await new Promise((r) => api.once('listening', r));
const apiPort = api.address().port;

const rule = (action) => ({
  name: 'r', ad_account_id: 'act_555', entity_type: 'CAMPAIGN', rule_type: 'SCHEDULE',
  conditions: [{ field: 'spend', operator: 'GREATER_THAN', value: 100 }],
  action,
});

const e1 = await post(rule({ type: 'CHANGE_BUDGET', budget_change_type: 'INCREASE', amount: 20, unit: 'PERCENTAGE' }));
check('a CHANGE_BUDGET rule is refused by the API',
  e1.status === 400 && e1.body.code === 'BUDGET_RULE_BLOCKED', `${e1.status} ${e1.body.code || e1.body.error}`);

const e2 = await post(rule({ type: 'CHANGE_BID', budget_change_type: 'INCREASE', amount: 5 }));
check('a CHANGE_BID rule is refused by the API',
  e2.status === 400 && e2.body.code === 'BUDGET_RULE_BLOCKED', `${e2.status} ${e2.body.code || e2.body.error}`);

const e3 = await post(rule({ type: 'PAUSE' }));
check('a PAUSE rule is still accepted', e3.status === 200, `${e3.status}`);

const e4 = await post(rule({ type: 'SEND_NOTIFICATION' }));
check('a SEND_NOTIFICATION rule is still accepted', e4.status === 200, `${e4.status}`);

// --- F. the verified decrease, through real axios --------------------------------
// The risk this check exists for: markBudgetDecrease sets a non-standard key on the axios
// config, and only a real request proves axios carries it through to the interceptor.
process.env.META_MAX_CALLS_PER_HOUR = '150';
received.length = 0;
const live = `${graph('/120210000000')}`;

const f1 = await attempt(() => axios.post(
  live,
  new URLSearchParams({ daily_budget: '5000', access_token: 'T' }),
  markBudgetDecrease({}, { fromCents: 10000, toCents: 5000 })
));
check('a verified decrease is allowed through real axios', !f1.refused, f1.message || '');
check('the decrease actually reached Meta with the lowered value',
  received.length === 1 && received[0].body.includes('daily_budget=5000'),
  `${received.length} request(s), body=${(received[0]?.body || '').slice(0, 40)}`);

received.length = 0;
const f2 = await attempt(() => axios.post(
  live,
  new URLSearchParams({ daily_budget: '99999', access_token: 'T' }),
  markBudgetDecrease({}, { fromCents: 10000, toCents: 99999 })
));
check('a RAISE wearing a decrease marker is refused',
  f2.refused && f2.code === 'BUDGET_CHANGE_BLOCKED', f2.code);
check('the raise never reached Meta', received.length === 0,
  `${received.length} request(s) reached the stub`);

received.length = 0;
const f3 = await attempt(() => axios.post(
  live,
  new URLSearchParams({ daily_budget: '99999', access_token: 'T' }),
  markBudgetDecrease({}, { fromCents: 10000, toCents: 5000 })
));
check('a payload disagreeing with its marker is refused',
  f3.refused && f3.code === 'BUDGET_CHANGE_BLOCKED', f3.code);
check('the mismatched payload never reached Meta', received.length === 0,
  `${received.length} request(s) reached the stub`);

// --- G. budget-raise rules are refused at the DB layer ----------------------------
const { RulesEngineDB, BUDGET_RAISE_ACTIONS } = await import('../backend/db/rules-engine-db.js');

const mkRule = (action) => ({
  name: `e2e-${action}`, scope: 'campaign', conditions_json: '[]', action,
  action_params_json: '{}', cooldown_hours: 24, is_active: 0, is_dry_run: 1,
});

const g1 = await attempt(() => RulesEngineDB.createRule(mkRule('scale_budget')));
check('creating a scale_budget rule is refused',
  g1.refused && g1.code === 'BUDGET_RAISE_BLOCKED', g1.code);

let created = null;
const g2 = await attempt(async () => { created = await RulesEngineDB.createRule(mkRule('decrease_budget')); });
check('creating a decrease_budget rule still works', !g2.refused, g2.message || '');

const g3 = await attempt(() => RulesEngineDB.updateRule(created?.id, mkRule('scale_budget')));
check('editing a rule into a raise is refused',
  g3.refused && g3.code === 'BUDGET_RAISE_BLOCKED', g3.code);

// The rows that matter are the ones already in the DB: staging has 4 ACTIVE scale_budget rules
// that predate this guard and cannot be created through it. Insert one the same way — straight
// SQL, bypassing createRule — or the check below passes on an empty table and proves nothing.
const sqlite3 = (await import('sqlite3')).default;
const { getDbPath } = await import('../backend/utils/paths.js');
const raw = new sqlite3.Database(getDbPath('rules-engine.db'));
const legacyIds = await new Promise((resolve, reject) => {
  raw.run(
    `INSERT INTO rules (name,scope,conditions_json,action,action_params_json,cooldown_hours,is_active,is_dry_run)
     VALUES ('e2e-legacy-raise','campaign','[]','scale_budget','{"scale_pct":20}',24,1,1)`,
    function (err) {
      if (err) return reject(err);
      const raiseId = this.lastID;
      raw.run(
        `INSERT INTO rules (name,scope,conditions_json,action,action_params_json,cooldown_hours,is_active,is_dry_run)
         VALUES ('e2e-legacy-drop','campaign','[]','decrease_budget','{"decrease_pct":50}',24,1,1)`,
        function (err2) { err2 ? reject(err2) : resolve([raiseId, this.lastID]); }
      );
    }
  );
});

const active = await RulesEngineDB.listActiveRules();
const servedNames = active.map((r) => r.name);
check('a pre-existing ACTIVE budget-raise rule is withheld from the engine',
  !servedNames.includes('e2e-legacy-raise'),
  `served: ${servedNames.join(', ') || 'none'}`);
check('a pre-existing ACTIVE decrease rule is still served',
  servedNames.includes('e2e-legacy-drop'),
  `served: ${servedNames.join(', ') || 'none'}`);
check('no budget-raise action survives into what the engine receives',
  active.every((r) => !BUDGET_RAISE_ACTIONS.includes(r.action)),
  `${active.length} active rule(s) served`);

await new Promise((r) => raw.run(
  `DELETE FROM rules WHERE id IN (${[...legacyIds, created?.id].filter(Boolean).join(',')})`, r
));
raw.close();

// --- H. the kill switch reaches n8n through /active-rules -------------------------
// n8n posts to Meta directly, so the interceptor cannot stop it. The only lever is starving the
// loop of rules. If this check ever fails, the kill switch covers ZuckCannon alone and the claim
// that it stops everything is false.
const { rulesEngineN8nRouter } = await import('../backend/routes/rules-engine-n8n.js');
const engineApp = express();
engineApp.use(express.json());
engineApp.use('/api/rules-engine', rulesEngineN8nRouter);
const engineSrv = engineApp.listen(0, '127.0.0.1');
await new Promise((r) => engineSrv.once('listening', r));
const enginePort = engineSrv.address().port;

const getRules = () => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port: enginePort, path: '/api/rules-engine/active-rules' }, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(b || 'null'); } catch { parsed = null; }
      resolve({ status: res.statusCode, rules: Array.isArray(parsed) ? parsed : null });
    });
  }).on('error', () => resolve({ status: 0, rules: null }));
});

// Seed one active rule. Without this the "switch off" check reads 0 rules from an empty test DB
// and fails — and worse, the "switch ON" check would pass for the wrong reason: 0 because there
// was never anything to serve, not 0 because the switch starved it.
const rawH = new sqlite3.Database(getDbPath('rules-engine.db'));
const seededId = await new Promise((resolve, reject) => {
  rawH.run(
    `INSERT INTO rules (name,scope,conditions_json,action,action_params_json,cooldown_hours,is_active,is_dry_run)
     VALUES ('e2e-killswitch-probe','campaign','[]','pause','{}',24,1,1)`,
    function (err) { err ? reject(err) : resolve(this.lastID); }
  );
});

releaseKillSwitch();
const hOff = await getRules();
check('switch off: engine is served its rules',
  hOff.status === 200 && Array.isArray(hOff.rules) && hOff.rules.length > 0,
  `${hOff.status}, ${hOff.rules?.length ?? '?'} rule(s)`);

engageKillSwitch('e2e: starve the engine');
const hOn = await getRules();
check('switch ON: engine is served ZERO rules, so n8n cannot act at all',
  hOn.status === 200 && Array.isArray(hOn.rules) && hOn.rules.length === 0,
  `${hOn.status}, ${hOn.rules?.length ?? '?'} rule(s)`);

releaseKillSwitch();
const hBack = await getRules();
check('switch released: rules come back',
  hBack.rules?.length > 0 && hBack.rules?.length === hOff.rules?.length,
  `${hBack.rules?.length ?? '?'} rule(s)`);

await new Promise((r) => rawH.run('DELETE FROM rules WHERE id = ?', [seededId], r));
rawH.close();
engineSrv.close();

// ---------------------------------------------------------------------------------
stub.close();
api.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
