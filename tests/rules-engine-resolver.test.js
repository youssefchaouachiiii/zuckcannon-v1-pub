import { jest } from '@jest/globals';

jest.mock('../backend/db/rules-engine-db.js', () => ({
  RulesEngineDB: {
    getAssignmentsForRule: jest.fn(),
    getCampaignsByLabel: jest.fn(),
  },
}));

import { resolveRuleEntities } from '../backend/utils/rules-engine-resolver.js';
import { RulesEngineDB } from '../backend/db/rules-engine-db.js';

describe('resolveRuleEntities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RulesEngineDB.getAssignmentsForRule = jest.fn();
    RulesEngineDB.getCampaignsByLabel = jest.fn();
  });

  test('returns direct campaign assignments unchanged', async () => {
    RulesEngineDB.getAssignmentsForRule.mockResolvedValue([
      { entity_type: 'campaign', entity_id: 'camp_123' },
      { entity_type: 'campaign', entity_id: 'camp_456' },
    ]);
    const result = await resolveRuleEntities(1);
    expect(result).toEqual(['camp_123', 'camp_456']);
  });

  test('expands vertical assignments to campaign IDs', async () => {
    RulesEngineDB.getAssignmentsForRule.mockResolvedValue([
      { entity_type: 'vertical', entity_id: 'solar' },
    ]);
    RulesEngineDB.getCampaignsByLabel.mockResolvedValue([
      { campaign_id: 'camp_101' },
      { campaign_id: 'camp_102' },
    ]);
    const result = await resolveRuleEntities(1);
    expect(result).toEqual(['camp_101', 'camp_102']);
    expect(RulesEngineDB.getCampaignsByLabel).toHaveBeenCalledWith('vertical', 'solar');
  });

  test('deduplicates when same campaign appears in multiple assignments', async () => {
    RulesEngineDB.getAssignmentsForRule.mockResolvedValue([
      { entity_type: 'campaign', entity_id: 'camp_123' },
      { entity_type: 'vertical', entity_id: 'solar' },
    ]);
    RulesEngineDB.getCampaignsByLabel.mockResolvedValue([
      { campaign_id: 'camp_123' },
      { campaign_id: 'camp_456' },
    ]);
    const result = await resolveRuleEntities(1);
    expect(result).toEqual(['camp_123', 'camp_456']);
    expect(result.length).toBe(2);
  });
});
