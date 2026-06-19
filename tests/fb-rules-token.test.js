import { describe, test, expect, jest } from '@jest/globals';
import { resolveSystemUserTokenForAccount } from '../backend/utils/fb-token-selector.js';
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

describe('resolveSystemUserTokenForAccount', () => {
  test('hard-fails (no OAuth fallback) when account has no known BM', async () => {
    jest.spyOn(FacebookAuthDB, 'getAccountBmMap').mockResolvedValue({});
    await expect(resolveSystemUserTokenForAccount('999')).rejects.toMatchObject({ code: 'no_bm_for_account' });
    FacebookAuthDB.getAccountBmMap.mockRestore();
  });

  test('hard-fails when BM has no system-user token', async () => {
    jest.spyOn(FacebookAuthDB, 'getAccountBmMap').mockResolvedValue({ '101': { bm_id: 'bm1', bm_name: 'Sigma 2' } });
    jest.spyOn(FacebookAuthDB, 'getSystemUserToken').mockResolvedValue(null);
    await expect(resolveSystemUserTokenForAccount('101')).rejects.toMatchObject({ code: 'no_system_user' });
    FacebookAuthDB.getAccountBmMap.mockRestore();
    FacebookAuthDB.getSystemUserToken.mockRestore();
  });

  test('returns the system-user token for the account BM', async () => {
    jest.spyOn(FacebookAuthDB, 'getAccountBmMap').mockResolvedValue({ '101': { bm_id: 'bm1', bm_name: 'Sigma 2' } });
    jest.spyOn(FacebookAuthDB, 'getSystemUserToken').mockResolvedValue({ access_token: 'SYS_TOKEN' });
    const r = await resolveSystemUserTokenForAccount('act_101');
    expect(r).toEqual({ token: 'SYS_TOKEN', bm_id: 'bm1', bm_name: 'Sigma 2' });
    FacebookAuthDB.getAccountBmMap.mockRestore();
    FacebookAuthDB.getSystemUserToken.mockRestore();
  });
});
