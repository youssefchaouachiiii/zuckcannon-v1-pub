// backend/utils/fb-actor.js
// Maps a resolved tokenData (from resolveFbToken / selectFbToken) to a display-safe
// "actor" descriptor for the UI — proof of WHICH FB identity actually executed a write.
//
// NEVER returns the access_token. For non-system-user results (OAuth fallback or strict
// "none"), returns is_system_user:false so the UI shows the honest "your own account"
// wording instead of fabricating a system-user name. This is the anti-ban proof surface:
// it must reflect the REAL resolved identity, never a hardcoded value.
import { FacebookAuthDB } from './facebook-auth-db.js';

export async function describeActor(tokenData) {
  if (!tokenData || tokenData.type !== 'system_user') {
    return {
      is_system_user: false,
      type: tokenData?.type || 'none',
      reason: tokenData?.reason || null,
    };
  }
  let su = null, bm = null;
  try { su = await FacebookAuthDB.getSystemUserForBm(tokenData.bm_id); } catch (_) {}
  try { bm = await FacebookAuthDB.getBusinessManager(tokenData.bm_id); } catch (_) {}
  // Only trust the stored name if it's the SAME fb_user_id that was actually resolved
  // (defends against a BM whose latest SU row differs from the one used for this write).
  const system_user_name = (su && su.fb_user_id === tokenData.fb_user_id && su.name)
    ? su.name
    : `System User ${tokenData.fb_user_id}`;
  return {
    is_system_user: true,
    type: 'system_user',
    system_user_name,
    fb_user_id: tokenData.fb_user_id,
    bm_id: tokenData.bm_id,
    bm_name: (bm && bm.name) ? bm.name : tokenData.bm_id,
    reason: tokenData.reason || null,
  };
}
