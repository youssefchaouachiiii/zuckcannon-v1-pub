// tests/fb-token-resolver.test.js
import { jest } from '@jest/globals';

// ESM named-export mock: must register the mock module and import the SUT dynamically
// (after the mock is in place). selectFbToken is a top-level function export, so it
// can't be reassigned post-import the way the class methods in facebook-auth-db can.
const selectFbToken = jest.fn();
jest.unstable_mockModule('../backend/utils/fb-token-selector.js', () => ({
  selectFbToken,
}));

const { resolveFbToken } = await import('../backend/utils/fb-token-resolver.js');

const ORIGINAL_ENV = process.env;

function makeReq({ oauth = 'OAUTH_TOKEN', id = 1 } = {}) {
  return { user: { id, facebook_access_token: oauth } };
}

describe('resolveFbToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('writes', () => {
    test('write + flag OFF → returns OAuth session token, type oauth, does NOT call selectFbToken', async () => {
      delete process.env.USE_SYSTEM_USER_FOR_WRITES;
      const req = makeReq({ oauth: 'OAUTH_TOKEN' });

      const result = await resolveFbToken(req, 'act_123', { write: true });

      expect(result).toEqual({ token: 'OAUTH_TOKEN', type: 'oauth', reason: 'flag_off' });
      expect(selectFbToken).not.toHaveBeenCalled();
    });

    test('write + flag OFF + no OAuth → null', async () => {
      delete process.env.USE_SYSTEM_USER_FOR_WRITES;
      const req = makeReq({ oauth: null });

      const result = await resolveFbToken(req, 'act_123', { write: true });

      expect(result).toBeNull();
      expect(selectFbToken).not.toHaveBeenCalled();
    });

    test('write + flag ON → calls selectFbToken, returns system_user result', async () => {
      process.env.USE_SYSTEM_USER_FOR_WRITES = 'true';
      selectFbToken.mockResolvedValue({
        token: 'SYS_TOKEN',
        type: 'system_user',
        bm_id: 'bm_1',
        fb_user_id: 'sysuser_1',
      });
      const req = makeReq({ id: 7, oauth: 'OAUTH_TOKEN' });

      const result = await resolveFbToken(req, 'act_123', { write: true });

      expect(result).toEqual({
        token: 'SYS_TOKEN',
        type: 'system_user',
        bm_id: 'bm_1',
        fb_user_id: 'sysuser_1',
      });
      expect(selectFbToken).toHaveBeenCalledWith(7, 'act_123');
    });
  });

  describe('reads', () => {
    test('read (write:false) → always calls selectFbToken regardless of flag (flag OFF)', async () => {
      delete process.env.USE_SYSTEM_USER_FOR_WRITES;
      selectFbToken.mockResolvedValue({
        token: 'SYS_TOKEN',
        type: 'system_user',
        bm_id: 'bm_1',
        fb_user_id: 'sysuser_1',
      });
      const req = makeReq({ id: 3 });

      const result = await resolveFbToken(req, 'act_456', { write: false });

      expect(result.token).toBe('SYS_TOKEN');
      expect(selectFbToken).toHaveBeenCalledWith(3, 'act_456');
    });

    test('read default (no opts) also routes via selectFbToken', async () => {
      selectFbToken.mockResolvedValue({ token: 'SYS_TOKEN', type: 'system_user' });
      const req = makeReq({ id: 9 });

      const result = await resolveFbToken(req, 'act_789');

      expect(result.token).toBe('SYS_TOKEN');
      expect(selectFbToken).toHaveBeenCalledWith(9, 'act_789');
    });
  });

  describe('OAuth fallback when selectFbToken returns null', () => {
    test('selectFbToken null + OAuth present → falls back to OAuth, reason no_system_user', async () => {
      selectFbToken.mockResolvedValue(null);
      const req = makeReq({ oauth: 'OAUTH_TOKEN' });

      const result = await resolveFbToken(req, 'act_123', { write: false });

      expect(result).toEqual({ token: 'OAUTH_TOKEN', type: 'oauth', reason: 'no_system_user' });
    });

    test('selectFbToken null + no OAuth → null', async () => {
      selectFbToken.mockResolvedValue(null);
      const req = makeReq({ oauth: null });

      const result = await resolveFbToken(req, 'act_123', { write: false });

      expect(result).toBeNull();
    });
  });
});
