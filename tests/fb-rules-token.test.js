import { describe, test, expect, jest } from '@jest/globals';
import { resolveSystemUserTokenForAccount } from '../backend/utils/fb-token-selector.js';
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

describe('resolveSystemUserTokenForAccount', () => {
  test('hard-fails (no OAuth fallback) when account has no known BM', async () => {
    jest.spyOn(FacebookAuthDB, 'getAccountBmMap').mockResolvedValue({});
    await expect(resolveSystemUserTokenForAccount('999')).rejects.toMatchObject({ code: 'no_bm_for_account' });
    FacebookAuthDB.getAccountBmMap.mockRestore();
  });

  test('hard-fails when BM has no system user (null)', async () => {
    jest.spyOn(FacebookAuthDB, 'getAccountBmMap').mockResolvedValue({ '101': { bm_id: 'bm1', bm_name: 'Sigma 2' } });
    jest.spyOn(FacebookAuthDB, 'getSystemUserForBm').mockResolvedValue(null);
    const err = await resolveSystemUserTokenForAccount('101').catch(e => e);
    expect(err).toMatchObject({ code: 'no_system_user' });
    expect(err.bm_name).toBe('Sigma 2');
    FacebookAuthDB.getAccountBmMap.mockRestore();
    FacebookAuthDB.getSystemUserForBm.mockRestore();
  });

  test('hard-fails when system user exists but is unhealthy (health gate)', async () => {
    jest.spyOn(FacebookAuthDB, 'getAccountBmMap').mockResolvedValue({ '101': { bm_id: 'bm1', bm_name: 'Sigma 2' } });
    jest.spyOn(FacebookAuthDB, 'getSystemUserForBm').mockResolvedValue({ access_token: 'X', last_validation_ok: 0 });
    const err = await resolveSystemUserTokenForAccount('101').catch(e => e);
    expect(err).toMatchObject({ code: 'no_system_user' });
    FacebookAuthDB.getAccountBmMap.mockRestore();
    FacebookAuthDB.getSystemUserForBm.mockRestore();
  });

  test('returns the system-user token for the account BM when healthy', async () => {
    jest.spyOn(FacebookAuthDB, 'getAccountBmMap').mockResolvedValue({ '101': { bm_id: 'bm1', bm_name: 'Sigma 2' } });
    jest.spyOn(FacebookAuthDB, 'getSystemUserForBm').mockResolvedValue({ access_token: 'SYS_TOKEN', last_validation_ok: 1, expires_at: null });
    const r = await resolveSystemUserTokenForAccount('act_101');
    expect(r).toEqual({ token: 'SYS_TOKEN', bm_id: 'bm1', bm_name: 'Sigma 2' });
    FacebookAuthDB.getAccountBmMap.mockRestore();
    FacebookAuthDB.getSystemUserForBm.mockRestore();
  });
});
