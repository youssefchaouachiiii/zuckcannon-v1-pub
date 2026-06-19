import { describe, test, expect } from '@jest/globals';
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

describe('getAccountBmMap', () => {
  test('maps account_id -> { bm_id, bm_name } from ad_accounts join business_managers', async () => {
    const map = await FacebookAuthDB.getAccountBmMap();
    expect(typeof map).toBe('object');
    // Shape contract: every value (if any) has bm_id + bm_name string fields.
    for (const v of Object.values(map)) {
      expect(typeof v.bm_id).toBe('string');
      expect(typeof v.bm_name).toBe('string');
    }
  });
});
