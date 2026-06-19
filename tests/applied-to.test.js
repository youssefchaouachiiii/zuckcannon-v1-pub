import { describe, test, expect } from '@jest/globals';
import { buildAppliedTo } from '../backend/utils/applied-to.js';

const accountBm = {
  '101': { bm_name: 'Sigma 2' },
  '202': { bm_name: 'Sigma 3' },
};
const campaignAccount = { c1: '101', c2: '101', c3: '202' };
const maps = { accountBm, campaignAccount };

describe('buildAppliedTo', () => {
  test('account scope shows BM · account name', () => {
    const r = buildAppliedTo([{ entity_type: 'account', entity_id: '101' }], maps);
    expect(r.inline).toBe('Sigma 2 · Ad Account 101');
  });
  test('multiple accounts collapse to count', () => {
    const r = buildAppliedTo(
      [{ entity_type: 'account', entity_id: '101' }, { entity_type: 'account', entity_id: '202' }],
      maps,
    );
    expect(r.inline).toBe('2 accounts');
  });
  test('campaign assignments show count (no BM inline)', () => {
    const r = buildAppliedTo(
      [{ entity_type: 'campaign', entity_id: 'c1' }, { entity_type: 'campaign', entity_id: 'c2' }, { entity_type: 'campaign', entity_id: 'c3' }],
      maps,
    );
    expect(r.inline).toBe('3 campaigns');
  });
  test('adset and ad counts pluralize', () => {
    expect(buildAppliedTo([{ entity_type: 'adset', entity_id: 'a1' }], maps).inline).toBe('1 adset');
    expect(buildAppliedTo([{ entity_type: 'ad', entity_id: 'x1' }, { entity_type: 'ad', entity_id: 'x2' }], maps).inline).toBe('2 ads');
  });
  test('vertical shows name', () => {
    expect(buildAppliedTo([{ entity_type: 'vertical', entity_id: 'Nutra' }], maps).inline).toBe('Vertical: Nutra');
  });
  test('tag shows name', () => {
    expect(buildAppliedTo([{ entity_type: 'tag', entity_id: 'scaling' }], maps).inline).toBe('Tag: scaling');
  });
  test('mixed combines basis parts', () => {
    const r = buildAppliedTo(
      [{ entity_type: 'vertical', entity_id: 'Nutra' }, { entity_type: 'campaign', entity_id: 'c1' }, { entity_type: 'campaign', entity_id: 'c2' }],
      maps,
    );
    expect(r.inline).toBe('Vertical: Nutra + 2 campaigns');
  });
  test('empty assignments', () => {
    expect(buildAppliedTo([], maps).inline).toBe('Unassigned');
  });
  test('detail resolves campaign rows to BM·account, deduped', () => {
    const r = buildAppliedTo(
      [{ entity_type: 'campaign', entity_id: 'c1' }, { entity_type: 'campaign', entity_id: 'c2' }, { entity_type: 'campaign', entity_id: 'c3' }],
      maps,
    );
    expect(r.detail).toEqual([
      { bm_name: 'Sigma 2', account_name: 'Ad Account 101', account_id: '101' },
      { bm_name: 'Sigma 3', account_name: 'Ad Account 202', account_id: '202' },
    ]);
  });
});
