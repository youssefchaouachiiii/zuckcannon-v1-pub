// tests/rules-engine-applied-to-route.test.js
import { describe, test, expect, afterAll } from '@jest/globals';
import { RulesEngineDB } from '../backend/db/rules-engine-db.js';
import { attachAppliedTo } from '../backend/routes/rules-engine-ui.js';

describe('attachAppliedTo', () => {
  let ruleId;
  afterAll(async () => { if (ruleId) await RulesEngineDB.deleteRule(ruleId); });

  test('adds applied_to.inline reflecting assignments', async () => {
    const rule = await RulesEngineDB.createRule({
      name: 'AppliedTo Test', scope: 'campaign', conditions_json: '[]',
      action: 'pause', action_params_json: null, cooldown_hours: 1, is_active: 1, is_dry_run: 0,
    });
    ruleId = rule.id;
    await RulesEngineDB.addAssignment(ruleId, 'vertical', 'Nutra');

    const [out] = await attachAppliedTo([rule]);
    expect(out.applied_to.inline).toBe('Vertical: Nutra');
  });
});
