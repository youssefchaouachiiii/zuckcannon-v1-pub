import { describe, test, expect } from '@jest/globals';
import { normalizeFbRule } from '../backend/utils/fb-rules-sync.js';

const ctx = { account_id: '101', bm_id: 'bm1', bm_name: 'Sigma 2' };

describe('normalizeFbRule', () => {
  test('maps a schedule turn-off rule', () => {
    const api = {
      id: 'r1', name: 'Turn off 9pm', status: 'ENABLED', created_by: { name: 'Youssef' },
      execution_spec: { execution_type: 'PAUSE' },
      evaluation_spec: { evaluation_type: 'SCHEDULE', filters: [
        { field: 'entity_type', operator: 'EQUAL', value: 'CAMPAIGN' },
        { field: 'id', operator: 'IN', value: ['c1'] },
      ] },
      schedule_spec: { schedule_type: 'CUSTOM' },
    };
    const row = normalizeFbRule(api, ctx);
    expect(row.meta_rule_id).toBe('r1');
    expect(row.account_id).toBe('101');
    expect(row.bm_name).toBe('Sigma 2');
    expect(row.status).toBe('ENABLED');
    expect(row.action_summary).toBe('Turn off');
    expect(row.created_by).toBe('Youssef');
    expect(JSON.parse(row.applied_to_json)).toEqual({ entity_type: 'CAMPAIGN', count: 1 });
  });

  test('action mapping covers UNPAUSE and CHANGE_BUDGET and unknown', () => {
    const mk = (t) => normalizeFbRule({ id: 'x', name: 'n', status: 'ENABLED', execution_spec: { execution_type: t }, evaluation_spec: { filters: [] } }, ctx).action_summary;
    expect(mk('UNPAUSE')).toBe('Turn on');
    expect(mk('CHANGE_BUDGET')).toBe('Change budget');
    expect(mk('NOTIFICATION')).toBe('Notify');
    expect(mk('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
