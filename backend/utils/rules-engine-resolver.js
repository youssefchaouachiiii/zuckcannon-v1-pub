// backend/utils/rules-engine-resolver.js
import { RulesEngineDB } from '../db/rules-engine-db.js';

/**
 * Resolves a rule's assignments into a deduplicated flat list of FB entity IDs.
 * Direct campaign/adset/ad → returned as-is.
 * Vertical/tag → expanded via campaign_labels lookup.
 * Account type → handled at route level.
 */
export async function resolveRuleEntities(ruleId) {
  const assignments = await RulesEngineDB.getAssignmentsForRule(ruleId);
  const entityIds = new Set();

  for (const a of assignments) {
    if (a.entity_type === 'campaign' || a.entity_type === 'adset' || a.entity_type === 'ad') {
      entityIds.add(a.entity_id);
    } else if (a.entity_type === 'vertical') {
      const rows = await RulesEngineDB.getCampaignsByLabel('vertical', a.entity_id);
      rows.forEach(r => entityIds.add(r.campaign_id));
    } else if (a.entity_type === 'tag') {
      const rows = await RulesEngineDB.getCampaignsByLabel('tag', a.entity_id);
      rows.forEach(r => entityIds.add(r.campaign_id));
    }
  }

  return [...entityIds];
}
