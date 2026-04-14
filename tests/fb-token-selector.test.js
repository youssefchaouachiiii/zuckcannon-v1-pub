// tests/fb-token-selector.test.js
import { jest } from '@jest/globals';

jest.mock('../backend/utils/facebook-auth-db.js');

import { selectFbToken } from '../backend/utils/fb-token-selector.js';
import { FacebookAuthDB } from '../backend/utils/facebook-auth-db.js';

describe('selectFbToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FacebookAuthDB.listSystemUserTokens = jest.fn();
    FacebookAuthDB.getToken = jest.fn();
  });

  test('returns system user token when available', async () => {
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([
      { business_manager_id: 'bm_1', access_token: 'SYSTEM_TOKEN', expires_at: null }
    ]);

    const result = await selectFbToken(1, 'act_123');
    expect(result.token).toBe('SYSTEM_TOKEN');
    expect(result.type).toBe('system_user');
  });

  test('falls back to OAuth token when no system user token', async () => {
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([]);
    FacebookAuthDB.getToken.mockResolvedValue({ access_token: 'OAUTH_TOKEN' });

    const result = await selectFbToken(1, 'act_123');
    expect(result.token).toBe('OAUTH_TOKEN');
    expect(result.type).toBe('oauth');
  });

  test('returns null when neither token exists', async () => {
    FacebookAuthDB.listSystemUserTokens.mockResolvedValue([]);
    FacebookAuthDB.getToken.mockResolvedValue(null);

    const result = await selectFbToken(1, 'act_123');
    expect(result).toBeNull();
  });
});
