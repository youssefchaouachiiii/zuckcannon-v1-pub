// tests/fb-token-selector.test.js
import { jest } from '@jest/globals';

jest.mock('../backend/utils/facebook-auth-db.js');

import { selectFbToken } from '../backend/utils/fb-token-selector.js';
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

// Test-side helpers ---------------------------------------------------

function futureIso(daysAhead = 30) {
  return new Date(Date.now() + daysAhead * 86400 * 1000).toISOString();
}

function pastIso(daysAgo = 1) {
  return new Date(Date.now() - daysAgo * 86400 * 1000).toISOString();
}

describe('selectFbToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FacebookAuthDB.getAdAccount = jest.fn();
    FacebookAuthDB.getSystemUserForBm = jest.fn();
    FacebookAuthDB.getAnyHealthySystemUser = jest.fn();
    FacebookAuthDB.getValidToken = jest.fn();
  });

  describe('adAccountId resolves to a system user via BM', () => {
    test('returns system_user token with bm_id and fb_user_id', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue({
        id: 'act_123',
        account_id: '123',
        business_manager_id: 'bm_1',
      });
      FacebookAuthDB.getSystemUserForBm.mockResolvedValue({
        fb_user_id: 'sysuser_1',
        business_manager_id: 'bm_1',
        access_token: 'SYS_TOKEN',
        last_validation_ok: 1,
        expires_at: futureIso(30),
      });

      const result = await selectFbToken(1, 'act_123');

      expect(result).toEqual({
        token: 'SYS_TOKEN',
        type: 'system_user',
        bm_id: 'bm_1',
        fb_user_id: 'sysuser_1',
      });
      expect(FacebookAuthDB.getAdAccount).toHaveBeenCalledWith('act_123');
      expect(FacebookAuthDB.getSystemUserForBm).toHaveBeenCalledWith('bm_1');
    });

    test('numeric form (no act_ prefix) still resolves', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue({
        id: 'act_123',
        account_id: '123',
        business_manager_id: 'bm_1',
      });
      FacebookAuthDB.getSystemUserForBm.mockResolvedValue({
        fb_user_id: 'sysuser_1',
        business_manager_id: 'bm_1',
        access_token: 'SYS_TOKEN',
        last_validation_ok: 1,
        expires_at: null,
      });

      const result = await selectFbToken(1, '123');

      expect(result.token).toBe('SYS_TOKEN');
      expect(result.type).toBe('system_user');
      expect(result.bm_id).toBe('bm_1');
      expect(result.fb_user_id).toBe('sysuser_1');
      expect(FacebookAuthDB.getAdAccount).toHaveBeenCalledWith('123');
    });

    test('system_user with null expires_at is treated as healthy', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue({
        id: 'act_123', account_id: '123', business_manager_id: 'bm_1',
      });
      FacebookAuthDB.getSystemUserForBm.mockResolvedValue({
        fb_user_id: 'sysuser_1',
        business_manager_id: 'bm_1',
        access_token: 'SYS_TOKEN',
        last_validation_ok: 1,
        expires_at: null,
      });

      const result = await selectFbToken(1, 'act_123');
      expect(result.type).toBe('system_user');
      expect(result.reason).toBeUndefined();
    });
  });

  describe('fallback to any healthy system_user', () => {
    test('adAccountId not registered → fallback', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue(null);
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue({
        fb_user_id: 'sysuser_fallback',
        business_manager_id: 'bm_other',
        access_token: 'FALLBACK_TOKEN',
        last_validation_ok: 1,
        expires_at: futureIso(30),
      });

      const result = await selectFbToken(1, 'act_unknown');

      expect(result).toEqual({
        token: 'FALLBACK_TOKEN',
        type: 'system_user',
        bm_id: 'bm_other',
        fb_user_id: 'sysuser_fallback',
        reason: 'fallback_no_ad_account_match',
      });
      expect(FacebookAuthDB.getSystemUserForBm).not.toHaveBeenCalled();
    });

    test('ad_account exists but no system_user for its BM → fallback', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue({
        id: 'act_123', account_id: '123', business_manager_id: 'bm_1',
      });
      FacebookAuthDB.getSystemUserForBm.mockResolvedValue(null);
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue({
        fb_user_id: 'sysuser_fallback',
        business_manager_id: 'bm_other',
        access_token: 'FALLBACK_TOKEN',
        last_validation_ok: 1,
        expires_at: null,
      });

      const result = await selectFbToken(1, 'act_123');

      expect(result.token).toBe('FALLBACK_TOKEN');
      expect(result.type).toBe('system_user');
      expect(result.bm_id).toBe('bm_other');
      expect(result.fb_user_id).toBe('sysuser_fallback');
      expect(result.reason).toBe('fallback_no_ad_account_match');
    });

    test('system_user for BM is expired → fallback', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue({
        id: 'act_123', account_id: '123', business_manager_id: 'bm_1',
      });
      FacebookAuthDB.getSystemUserForBm.mockResolvedValue({
        fb_user_id: 'sysuser_expired',
        business_manager_id: 'bm_1',
        access_token: 'EXPIRED_TOKEN',
        last_validation_ok: 1,
        expires_at: pastIso(1),
      });
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue({
        fb_user_id: 'sysuser_fallback',
        business_manager_id: 'bm_other',
        access_token: 'FALLBACK_TOKEN',
        last_validation_ok: 1,
        expires_at: futureIso(30),
      });

      const result = await selectFbToken(1, 'act_123');

      expect(result.token).toBe('FALLBACK_TOKEN');
      expect(result.reason).toBe('fallback_no_ad_account_match');
    });

    test('system_user for BM has last_validation_ok = 0 → fallback', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue({
        id: 'act_123', account_id: '123', business_manager_id: 'bm_1',
      });
      FacebookAuthDB.getSystemUserForBm.mockResolvedValue({
        fb_user_id: 'sysuser_unvalidated',
        business_manager_id: 'bm_1',
        access_token: 'BAD_TOKEN',
        last_validation_ok: 0,
        expires_at: futureIso(30),
      });
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue({
        fb_user_id: 'sysuser_fallback',
        business_manager_id: 'bm_other',
        access_token: 'FALLBACK_TOKEN',
        last_validation_ok: 1,
        expires_at: null,
      });

      const result = await selectFbToken(1, 'act_123');

      expect(result.token).toBe('FALLBACK_TOKEN');
      expect(result.reason).toBe('fallback_no_ad_account_match');
    });

    test('no adAccountId → goes straight to fallback system_user', async () => {
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue({
        fb_user_id: 'sysuser_any',
        business_manager_id: 'bm_any',
        access_token: 'ANY_TOKEN',
        last_validation_ok: 1,
        expires_at: null,
      });

      const result = await selectFbToken(1, null);

      expect(result).toEqual({
        token: 'ANY_TOKEN',
        type: 'system_user',
        bm_id: 'bm_any',
        fb_user_id: 'sysuser_any',
        reason: 'fallback_no_ad_account_match',
      });
      expect(FacebookAuthDB.getAdAccount).not.toHaveBeenCalled();
    });

    test('empty-string adAccountId is treated as missing', async () => {
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue({
        fb_user_id: 'sysuser_any',
        business_manager_id: 'bm_any',
        access_token: 'ANY_TOKEN',
        last_validation_ok: 1,
        expires_at: null,
      });

      const result = await selectFbToken(1, '');

      expect(result.type).toBe('system_user');
      expect(result.reason).toBe('fallback_no_ad_account_match');
      expect(FacebookAuthDB.getAdAccount).not.toHaveBeenCalled();
    });
  });

  describe('OAuth fallback', () => {
    test('no adAccountId, no system_user, OAuth user has token', async () => {
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue(null);
      FacebookAuthDB.getValidToken.mockResolvedValue({
        access_token: 'OAUTH_TOKEN',
      });

      const result = await selectFbToken(1, null);

      expect(result).toEqual({
        token: 'OAUTH_TOKEN',
        type: 'oauth',
        reason: 'no_system_user_available',
      });
      expect(FacebookAuthDB.getValidToken).toHaveBeenCalledWith(1);
    });

    test('adAccountId provided, no system_user anywhere, OAuth has token', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue(null);
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue(null);
      FacebookAuthDB.getValidToken.mockResolvedValue({
        access_token: 'OAUTH_TOKEN',
      });

      const result = await selectFbToken(1, 'act_unknown');

      // reason reflects the FINAL state (no system_user), not the intermediate ad-account miss.
      expect(result).toEqual({
        token: 'OAUTH_TOKEN',
        type: 'oauth',
        reason: 'no_system_user_available',
      });
    });
  });

  describe('no token available', () => {
    test('no adAccountId, no system_user, no OAuth', async () => {
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue(null);
      FacebookAuthDB.getValidToken.mockResolvedValue(null);

      const result = await selectFbToken(1, null);

      expect(result).toBeNull();
    });

    test('returns null when no token of any kind is available', async () => {
      FacebookAuthDB.getAdAccount.mockResolvedValue(null);
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue(null);
      FacebookAuthDB.getValidToken.mockResolvedValue(null);

      const result = await selectFbToken(1, 'act_anything');

      expect(result).toBeNull();
    });
  });

  describe('multiple system_users — picks the most recently updated', () => {
    test('getAnyHealthySystemUser ordering is delegated to the DB layer', async () => {
      // The selector trusts the DB query to ORDER BY updated_at DESC.
      // We assert the selector returns whatever getAnyHealthySystemUser returns.
      FacebookAuthDB.getAdAccount.mockResolvedValue(null);
      FacebookAuthDB.getAnyHealthySystemUser.mockResolvedValue({
        fb_user_id: 'sysuser_latest',
        business_manager_id: 'bm_latest',
        access_token: 'LATEST_TOKEN',
        last_validation_ok: 1,
        expires_at: null,
      });

      const result = await selectFbToken(1, 'act_unknown');

      expect(result.token).toBe('LATEST_TOKEN');
      expect(result.fb_user_id).toBe('sysuser_latest');
      expect(result.bm_id).toBe('bm_latest');
    });
  });
});
