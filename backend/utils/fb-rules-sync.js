import axios from 'axios';
import { RulesEngineDB } from '../db/rules-engine-db.js';
import { FacebookAuthDB } from './facebook-auth-db.js';
import { resolveSystemUserTokenForAccount } from './fb-token-selector.js';

const FB_API_VERSION = process.env.FB_API_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${FB_API_VERSION}`;

const ACTION_LABEL = { PAUSE: 'Turn off', UNPAUSE: 'Turn on', CHANGE_BUDGET: 'Change budget', NOTIFICATION: 'Notify' };

export function normalizeFbRule(api, { account_id, bm_id, bm_name }) {
  const filters = api.evaluation_spec?.filters || [];
  const entityFilter = filters.find(f => f.field === 'entity_type');
  const idFilter = filters.find(f => f.field === 'id');
  const appliedTo = {
    entity_type: entityFilter?.value || 'CAMPAIGN',
    count: Array.isArray(idFilter?.value) ? idFilter.value.length : (idFilter?.value ? 1 : 0),
  };
  const condFilters = filters.filter(f => !['entity_type', 'id', 'time_preset', 'effective_status'].includes(f.field));
  const condition_summary = condFilters.length
    ? condFilters.map(f => `${f.field} ${f.operator} ${f.value}`).join(', ')
    : 'No condition';
  const execType = api.execution_spec?.execution_type;
  return {
    meta_rule_id: api.id,
    account_id: String(account_id).replace(/^act_/, ''),
    bm_id, bm_name,
    name: api.name,
    status: api.status,
    action_summary: ACTION_LABEL[execType] || execType || 'Unknown',
    condition_summary,
    schedule_summary: api.schedule_spec?.schedule_type || 'Default',
    applied_to_json: JSON.stringify(appliedTo),
    created_by: api.created_by?.name || api.created_by || null,
    raw_json: JSON.stringify(api),
  };
}

export const fbRulesSync = {
  async syncFbRulesForAccount(accountId) {
    const { token, bm_id, bm_name } = await resolveSystemUserTokenForAccount(accountId);
    const acct = String(accountId).replace(/^act_/, '');
    const url = `${GRAPH}/act_${acct}/adrules_library`;
    const resp = await axios.get(url, {
      params: { fields: 'id,name,evaluation_spec,execution_spec,schedule_spec,status,created_by', access_token: token },
    });
    const rules = resp.data?.data || [];
    for (const r of rules) {
      await RulesEngineDB.upsertFbNativeRule(normalizeFbRule(r, { account_id: acct, bm_id, bm_name }));
    }
    return { account_id: acct, count: rules.length };
  },

  async syncAllFbRules() {
    const map = await FacebookAuthDB.getAccountBmMap();
    const synced = [];
    const errors = [];
    // SERIALIZED — VPS infra constraint (no fan-out).
    for (const accountId of Object.keys(map)) {
      try { synced.push(await fbRulesSync.syncFbRulesForAccount(accountId)); }
      catch (e) { errors.push({ account_id: accountId, code: e.code || 'error', message: e.message }); }
    }
    return { synced, errors };
  },

  async setFbRuleStatus(metaRuleId, accountId, enabled) {
    const { token } = await resolveSystemUserTokenForAccount(accountId);
    const status = enabled ? 'ENABLED' : 'DISABLED';
    await axios.post(`${GRAPH}/${metaRuleId}`, null, { params: { status, access_token: token } });
    return { status };
  },
};
