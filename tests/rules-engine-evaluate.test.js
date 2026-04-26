import { describe, test, expect } from '@jest/globals';

function parseInsights(resp, rt, statusBody) {
  if (!resp || resp.code !== 200) return null;
  let body; try { body = JSON.parse(resp.body); } catch { return null; }
  const d = body?.data?.[0];
  if (!d) return null;

  const spend = parseFloat(d.spend || 0);
  const fbConv = parseFloat(d.actions?.find(a => a.action_type === 'purchase')?.value || 0);
  const conversions = rt ? (rt.conversions || 0) : fbConv;
  const cpa = conversions > 0 ? spend / conversions : 0;
  const roas = parseFloat(d.purchase_roas?.[0]?.value || 0);
  const purchaseValue = parseFloat(d.action_values?.find(a => a.action_type === 'purchase')?.value || 0);
  const roi = rt ? (rt.roi || 0) : (spend > 0 ? (purchaseValue - spend) / spend : 0);
  const ctr = parseFloat(d.ctr || 0);
  const cpc = parseFloat(d.cpc || 0);
  const frequency = parseFloat(d.frequency || 0);
  const link_clicks = parseFloat(d.inline_link_clicks || 0);
  const lp_views = parseFloat(d.actions?.find(a => a.action_type === 'landing_page_view')?.value || 0);
  const initiate_checkout = parseFloat(d.actions?.find(a => a.action_type === 'initiate_checkout')?.value || 0);
  const outbound_clicks_ctr = parseFloat(d.outbound_clicks_ctr?.[0]?.value || 0);
  const lp_conv_rate = link_clicks > 0 ? (lp_views / link_clicks) * 100 : 0;

  const dailyBudgetCents = statusBody ? parseInt(statusBody.daily_budget || 0) : 0;
  const remainingCents = statusBody ? parseInt(statusBody.budget_remaining || 0) : 0;
  const budget_pct_used = dailyBudgetCents > 0 ? ((dailyBudgetCents - remainingCents) / dailyBudgetCents) * 100 : 0;
  const budget_remaining_pct = 100 - budget_pct_used;

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const time_of_day_et = nowET.getHours() * 60 + nowET.getMinutes();
  const day_of_week = nowET.getDay() === 0 ? 7 : nowET.getDay();

  return {
    spend_today: spend, conversions, cpa, roas, roi, ctr, cpc, frequency,
    link_clicks, lp_views, initiate_checkout,
    outbound_clicks_ctr, lp_conv_rate,
    budget_pct_used, budget_remaining_pct,
    time_of_day_et, day_of_week,
  };
}

const mockResp = (data) => ({ code: 200, body: JSON.stringify({ data: [data] }) });
const mockStatus = (budget, remaining) => ({ daily_budget: String(budget), budget_remaining: String(remaining) });

describe('parseInsights — new metrics', () => {
  test('computes budget_pct_used correctly', () => {
    const r = parseInsights(mockResp({ spend: '500' }), null, mockStatus(125000, 75000));
    // 125000 - 75000 = 50000 used out of 125000 = 40%
    expect(r.budget_pct_used).toBeCloseTo(40, 1);
    expect(r.budget_remaining_pct).toBeCloseTo(60, 1);
  });

  test('computes lp_conv_rate from lp_views / link_clicks', () => {
    const r = parseInsights(mockResp({
      spend: '100',
      inline_link_clicks: '100',
      actions: [{ action_type: 'landing_page_view', value: '30' }]
    }), null, null);
    expect(r.lp_conv_rate).toBeCloseTo(30, 1);
  });

  test('parses outbound_clicks_ctr', () => {
    const r = parseInsights(mockResp({
      spend: '100',
      outbound_clicks_ctr: [{ action_type: 'outbound_click', value: '2.7' }]
    }), null, null);
    expect(r.outbound_clicks_ctr).toBeCloseTo(2.7, 1);
  });

  test('returns 0 for missing fields gracefully', () => {
    const r = parseInsights(mockResp({ spend: '50', actions: [] }), null, null);
    expect(r.budget_pct_used).toBe(0);
    expect(r.lp_conv_rate).toBe(0);
    expect(r.outbound_clicks_ctr).toBe(0);
  });

  test('time_of_day_et is within 0-1439', () => {
    const r = parseInsights(mockResp({ spend: '0' }), null, null);
    expect(r.time_of_day_et).toBeGreaterThanOrEqual(0);
    expect(r.time_of_day_et).toBeLessThan(1440);
  });
});

describe('evaluate — spend alias', () => {
  test('spend metric with today lookback reads spend_today', () => {
    const todayInsights = { spend_today: 150 };
    const insights3d = { spend: 400 };
    const evaluate = (c) => {
      const src = c.lookback === 'last_3d' ? insights3d : todayInsights;
      const val = c.metric === 'spend'
        ? (c.lookback === 'today' ? src?.spend_today : src?.spend)
        : src?.[c.metric];
      if (val == null) return false;
      return c.operator === 'gt' ? val > c.value : val < c.value;
    };
    expect(evaluate({ metric: 'spend', operator: 'gt', value: 100, lookback: 'today' })).toBe(true);
    expect(evaluate({ metric: 'spend', operator: 'gt', value: 300, lookback: 'last_3d' })).toBe(true);
    expect(evaluate({ metric: 'spend', operator: 'gt', value: 500, lookback: 'last_3d' })).toBe(false);
  });
});
