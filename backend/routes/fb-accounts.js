// backend/routes/fb-accounts.js
import express from 'express';
import axios from 'axios';
import { FacebookAuthDB } from '../utils/facebook-auth-db.js';

export const fbAccountsRouter = express.Router();

fbAccountsRouter.get('/tokens', async (req, res) => {
  try {
    const tokens = await FacebookAuthDB.listSystemUserTokens();
    const safe = tokens.map(({ access_token, ...rest }) => ({
      ...rest,
      token_preview: access_token.slice(0, 7) + '...',
    }));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list tokens' });
  }
});

fbAccountsRouter.post('/tokens/verify', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'access_token is required' });

  try {
    const meResponse = await axios.get(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${access_token}`
    );
    const { id: businessManagerId, name: businessName } = meResponse.data;
    await FacebookAuthDB.saveSystemUserToken(businessManagerId, businessName, access_token, null);
    res.json({ business_manager_id: businessManagerId, business_name: businessName });
  } catch (err) {
    const message = err?.response?.data?.error?.message || 'Token verification failed';
    res.status(400).json({ error: message });
  }
});

fbAccountsRouter.delete('/tokens/:bmId', async (req, res) => {
  try {
    await FacebookAuthDB.deleteSystemUserToken(req.params.bmId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete token' });
  }
});
