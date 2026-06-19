import { describe, test, expect } from '@jest/globals';
import { FacebookCacheDB } from '../backend/utils/facebook-cache-db.js';

describe('getCampaignAccountMap', () => {
  test('returns an object mapping campaign id -> account id (strings)', async () => {
    const map = await FacebookCacheDB.getCampaignAccountMap();
    expect(typeof map).toBe('object');
    for (const [cid, acct] of Object.entries(map)) {
      expect(typeof cid).toBe('string');
      expect(typeof acct).toBe('string');
    }
  });
});
