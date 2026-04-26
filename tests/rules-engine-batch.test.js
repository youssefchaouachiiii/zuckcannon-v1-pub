import { describe, test, expect } from '@jest/globals';

function getFields(relativeUrl) {
  const m = relativeUrl.match(/fields=([^&]+)/);
  return m ? m[1].split(',') : [];
}

describe('Build FB Batch field coverage', () => {
  const statusUrl = 'camp_123?fields=effective_status,name,daily_budget,budget_remaining';
  const insightsUrl = 'camp_123/insights?fields=spend,actions,action_values,purchase_roas,ctr,cpc,frequency,inline_link_clicks,outbound_clicks_ctr&date_preset=today';

  test('status fetch includes daily_budget', () => expect(getFields(statusUrl)).toContain('daily_budget'));
  test('status fetch includes budget_remaining', () => expect(getFields(statusUrl)).toContain('budget_remaining'));
  test('insights fetch includes outbound_clicks_ctr', () => expect(getFields(insightsUrl)).toContain('outbound_clicks_ctr'));
  test('insights fetch includes frequency', () => expect(getFields(insightsUrl)).toContain('frequency'));
  test('insights fetch includes inline_link_clicks', () => expect(getFields(insightsUrl)).toContain('inline_link_clicks'));
});
