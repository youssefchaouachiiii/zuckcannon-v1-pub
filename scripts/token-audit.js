#!/usr/bin/env node
/**
 * Which Meta system-user tokens does this instance hold, and which still work?
 *
 * Read-only: one `GET /me` per token. Tokens are read from the local DB and never printed.
 *
 *   docker exec staging-zuckcannon-v1-pub-app-1 node scripts/token-audit.js
 *
 * Exists as a file rather than a `node -e` one-liner because the inline form does not survive
 * ssh's remote-shell re-parsing — the quoting mangles and you get a syntax error, not an answer.
 *
 * Note the table: live tokens are in `system_users`. `system_user_tokens` is an older table
 * (one row, expired 2026-06-14) and `facebook_tokens` is empty. Reading the wrong one reports
 * "no tokens" and sends you looking for a problem that is not there.
 */
import https from 'https';
import sqlite3 from 'sqlite3';

import { getDbPath } from '../backend/utils/paths.js';

const db = new sqlite3.Database(getDbPath('facebook-auth.db'), sqlite3.OPEN_READONLY);

const probe = (token) => new Promise((resolve) => {
  https.get(
    `https://graph.facebook.com/v25.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
    (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* non-JSON */ }
        resolve({
          ok: res.statusCode === 200,
          detail: json?.name || json?.error?.message || `HTTP ${res.statusCode}`,
        });
      });
    }
  ).on('error', (e) => resolve({ ok: false, detail: e.message }));
});

db.all(
  'SELECT business_manager_id, name, expires_at, access_token FROM system_users ORDER BY business_manager_id',
  async (err, rows) => {
    if (err) { console.error('cannot read system_users:', err.message); process.exit(1); }
    if (!rows.length) { console.log('system_users kosong.'); process.exit(1); }

    let dead = 0;
    for (const r of rows) {
      if (!r.access_token) { console.log(`KOSONG  BM ${r.business_manager_id}  ${r.name}`); dead++; continue; }
      const { ok, detail } = await probe(r.access_token);
      if (!ok) dead++;
      console.log(`${ok ? 'HIDUP ' : 'MATI  '} BM ${r.business_manager_id}  ${r.name}`);
      console.log(`        ${detail}`);
    }

    console.log(`\n${rows.length - dead}/${rows.length} token hidup.`);
    process.exit(dead ? 1 : 0);
  }
);
