// tests/facebook-auth-db.test.js
import sqlite3 from "sqlite3";
import { FacebookAuthDB } from "../backend/utils/facebook-auth-db.js";
import { getDbPath } from "../backend/utils/paths.js";

// Helpers -----------------------------------------------------------

// Open a raw DB handle to the same auth DB so cleanup tests can poke at it.
function openRawDb() {
  const d = new sqlite3.Database(getDbPath("facebook-auth.db"));
  d.runAsync = (sql, params) =>
    new Promise((resolve, reject) => {
      d.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  d.getAsync = (sql, params) =>
    new Promise((resolve, reject) => {
      d.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  d.allAsync = (sql, params) =>
    new Promise((resolve, reject) => {
      d.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  return d;
}

async function wipeNewTables() {
  const d = openRawDb();
  // Foreign keys cascade from business_managers -> system_users, ad_accounts
  await d.runAsync("DELETE FROM ad_accounts", []);
  await d.runAsync("DELETE FROM system_users", []);
  await d.runAsync("DELETE FROM business_managers", []);
  d.close();
}

// Tests -------------------------------------------------------------

describe("BusinessManagers", () => {
  beforeEach(wipeNewTables);

  test("upsertBusinessManager stores a new BM with defaults", async () => {
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_1", name: "SGP" });
    const bm = await FacebookAuthDB.getBusinessManager("bm_1");
    expect(bm).not.toBeNull();
    expect(bm.name).toBe("SGP");
    expect(bm.role).toBe("launching");
    expect(bm.status).toBe("active");
  });

  test("upsertBusinessManager is idempotent and updates fields", async () => {
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_1", name: "Original" });
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_1", name: "Renamed", role: "tm", status: "disabled", notes: "moved" });
    const bm = await FacebookAuthDB.getBusinessManager("bm_1");
    expect(bm.name).toBe("Renamed");
    expect(bm.role).toBe("tm");
    expect(bm.status).toBe("disabled");
    expect(bm.notes).toBe("moved");
  });

  test("getBusinessManager returns null when not found", async () => {
    expect(await FacebookAuthDB.getBusinessManager("nope")).toBeNull();
  });

  test("listBusinessManagers returns all rows sorted by name asc", async () => {
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_b", name: "Bravo" });
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_a", name: "Alpha" });
    const list = await FacebookAuthDB.listBusinessManagers();
    expect(list.map((b) => b.id)).toEqual(["bm_a", "bm_b"]);
  });

  test("listBusinessManagers filters by role", async () => {
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_tm", name: "TM", role: "tm" });
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_l", name: "Launching", role: "launching" });
    const tms = await FacebookAuthDB.listBusinessManagers({ role: "tm" });
    expect(tms).toHaveLength(1);
    expect(tms[0].id).toBe("bm_tm");
  });

  test("listBusinessManagers filters by status", async () => {
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_ok", name: "Ok", status: "active" });
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_bad", name: "Bad", status: "disabled" });
    const disabled = await FacebookAuthDB.listBusinessManagers({ status: "disabled" });
    expect(disabled).toHaveLength(1);
    expect(disabled[0].id).toBe("bm_bad");
  });
});

describe("SystemUsers", () => {
  beforeEach(async () => {
    await wipeNewTables();
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_1", name: "BM 1" });
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_2", name: "BM 2" });
  });

  test("upsertSystemUser stores and round-trips", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1",
      business_manager_id: "bm_1",
      name: "Sys User",
      access_token: "EAAB_token",
    });
    const su = await FacebookAuthDB.getSystemUserForBm("bm_1");
    expect(su).not.toBeNull();
    expect(su.fb_user_id).toBe("u1");
    expect(su.name).toBe("Sys User");
    expect(su.access_token).toBe("EAAB_token");
  });

  test("upsertSystemUser is idempotent on (fb_user_id, business_manager_id)", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_1", name: "Old", access_token: "tok1",
    });
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_1", name: "New", access_token: "tok2",
    });
    const d = openRawDb();
    const { c } = await d.getAsync(
      "SELECT COUNT(*) AS c FROM system_users WHERE fb_user_id = ? AND business_manager_id = ?",
      ["u1", "bm_1"]
    );
    d.close();
    expect(c).toBe(1);
    const su = await FacebookAuthDB.getSystemUserForBm("bm_1");
    expect(su.name).toBe("New");
    expect(su.access_token).toBe("tok2");
  });

  test("same fb_user_id + different BM yields two rows", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_1", name: "Sys", access_token: "t1",
    });
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_2", name: "Sys", access_token: "t2",
    });
    const su1 = await FacebookAuthDB.getSystemUserForBm("bm_1");
    const su2 = await FacebookAuthDB.getSystemUserForBm("bm_2");
    expect(su1.access_token).toBe("t1");
    expect(su2.access_token).toBe("t2");
  });

  test("getSystemUserForBm returns null when no row exists", async () => {
    expect(await FacebookAuthDB.getSystemUserForBm("bm_1")).toBeNull();
  });

  test("getSystemUserForBm prefers last_validation_ok=1 over older rows", async () => {
    // Two rows in same BM but different fb_user_ids — verify ordering on validation_ok.
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_old", business_manager_id: "bm_1", name: "Old", access_token: "old_t",
    });
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_new", business_manager_id: "bm_1", name: "New", access_token: "new_t",
    });
    await FacebookAuthDB.markValidation({
      fb_user_id: "u_new", business_manager_id: "bm_1", ok: true,
    });
    const su = await FacebookAuthDB.getSystemUserForBm("bm_1");
    expect(su.fb_user_id).toBe("u_new");
  });

  test("markValidation sets last_validated_at and ok flag", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_1", name: "Sys", access_token: "t",
    });
    await FacebookAuthDB.markValidation({
      fb_user_id: "u1", business_manager_id: "bm_1", ok: true,
    });
    const su = await FacebookAuthDB.getSystemUserForBm("bm_1");
    expect(su.last_validation_ok).toBe(1);
    expect(su.last_validated_at).not.toBeNull();
  });

  test("markValidation can also set expires_at", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_1", name: "Sys", access_token: "t",
    });
    const expires = new Date(Date.now() + 60 * 86400 * 1000).toISOString();
    await FacebookAuthDB.markValidation({
      fb_user_id: "u1", business_manager_id: "bm_1", ok: true, expires_at: expires,
    });
    const su = await FacebookAuthDB.getSystemUserForBm("bm_1");
    expect(su.expires_at).toBe(expires);
  });

  test("listSystemUsers returns all rows across BMs", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_1", name: "Sys 1", access_token: "t1",
    });
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u2", business_manager_id: "bm_2", name: "Sys 2", access_token: "t2",
    });
    const all = await FacebookAuthDB.listSystemUsers();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.fb_user_id).sort()).toEqual(["u1", "u2"]);
  });

  test("deleteSystemUser removes the row by composite key", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_1", name: "Sys", access_token: "t",
    });
    await FacebookAuthDB.deleteSystemUser("u1", "bm_1");
    expect(await FacebookAuthDB.getSystemUserForBm("bm_1")).toBeNull();
  });

  test("getAnyHealthySystemUser returns the most recently updated healthy row", async () => {
    // Seed 2 healthy rows in different BMs; mark both validated; ensure the
    // later-updated one wins.
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_old", business_manager_id: "bm_1", name: "Old", access_token: "old_t",
    });
    await FacebookAuthDB.markValidation({
      fb_user_id: "u_old", business_manager_id: "bm_1", ok: true,
      expires_at: new Date(Date.now() + 60 * 86400 * 1000).toISOString(),
    });
    // Force a tick so updated_at differs (SQLite CURRENT_TIMESTAMP is second-resolution).
    await new Promise((r) => setTimeout(r, 1100));
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_new", business_manager_id: "bm_2", name: "New", access_token: "new_t",
    });
    await FacebookAuthDB.markValidation({
      fb_user_id: "u_new", business_manager_id: "bm_2", ok: true,
      expires_at: new Date(Date.now() + 60 * 86400 * 1000).toISOString(),
    });

    const su = await FacebookAuthDB.getAnyHealthySystemUser();
    expect(su).not.toBeNull();
    expect(su.fb_user_id).toBe("u_new");
  });

  test("getAnyHealthySystemUser ignores rows with last_validation_ok=0", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_unvalidated", business_manager_id: "bm_1",
      name: "Unvalidated", access_token: "t",
    });
    // No markValidation → ok=0 (default).
    expect(await FacebookAuthDB.getAnyHealthySystemUser()).toBeFalsy();
  });

  test("getAnyHealthySystemUser ignores expired rows", async () => {
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_expired", business_manager_id: "bm_1",
      name: "Expired", access_token: "t",
    });
    await FacebookAuthDB.markValidation({
      fb_user_id: "u_expired", business_manager_id: "bm_1", ok: true,
      expires_at: new Date(Date.now() - 86400 * 1000).toISOString(), // yesterday
    });
    expect(await FacebookAuthDB.getAnyHealthySystemUser()).toBeFalsy();
  });

  test("getAnyHealthySystemUser returns null when no rows exist", async () => {
    expect(await FacebookAuthDB.getAnyHealthySystemUser()).toBeNull();
  });

  test("getExpiringSystemUsers returns rows within window", async () => {
    const inWindow = new Date(Date.now() + 3 * 86400 * 1000).toISOString(); // 3 days
    const outWindow = new Date(Date.now() + 30 * 86400 * 1000).toISOString(); // 30 days
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_in", business_manager_id: "bm_1", name: "Soon", access_token: "t1", expires_at: inWindow,
    });
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_out", business_manager_id: "bm_1", name: "Later", access_token: "t2", expires_at: outWindow,
    });
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u_null", business_manager_id: "bm_1", name: "NoExp", access_token: "t3",
    });
    const rows = await FacebookAuthDB.getExpiringSystemUsers(7);
    const ids = rows.map((r) => r.fb_user_id);
    expect(ids).toContain("u_in");
    expect(ids).not.toContain("u_out");
    expect(ids).not.toContain("u_null");
  });
});

describe("AdAccounts (BM-scoped)", () => {
  beforeEach(async () => {
    await wipeNewTables();
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_1", name: "BM 1" });
  });

  test("upsertAdAccount + getAdAccount by full id", async () => {
    await FacebookAuthDB.upsertAdAccount({
      id: "act_123456", account_id: "123456", business_manager_id: "bm_1",
      name: "Acct", currency: "USD", timezone_name: "America/New_York",
    });
    const a = await FacebookAuthDB.getAdAccount("act_123456");
    expect(a).not.toBeNull();
    expect(a.id).toBe("act_123456");
    expect(a.account_id).toBe("123456");
    expect(a.currency).toBe("USD");
    expect(a.status).toBe("unknown");
  });

  test("getAdAccount looks up by numeric account_id too", async () => {
    await FacebookAuthDB.upsertAdAccount({
      id: "act_999", account_id: "999", business_manager_id: "bm_1", name: "Acct",
    });
    const byNumeric = await FacebookAuthDB.getAdAccount("999");
    expect(byNumeric).not.toBeNull();
    expect(byNumeric.id).toBe("act_999");
  });

  test("getAdAccount returns null when no match", async () => {
    expect(await FacebookAuthDB.getAdAccount("act_doesnotexist")).toBeNull();
  });

  test("upsertAdAccount is idempotent on id", async () => {
    await FacebookAuthDB.upsertAdAccount({
      id: "act_1", account_id: "1", business_manager_id: "bm_1", name: "Old",
    });
    await FacebookAuthDB.upsertAdAccount({
      id: "act_1", account_id: "1", business_manager_id: "bm_1", name: "New", status: "active",
    });
    const a = await FacebookAuthDB.getAdAccount("act_1");
    expect(a.name).toBe("New");
    expect(a.status).toBe("active");
  });

  test("listAdAccountsForBm returns rows for the given BM only", async () => {
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_2", name: "BM 2" });
    await FacebookAuthDB.upsertAdAccount({
      id: "act_1", account_id: "1", business_manager_id: "bm_1", name: "A",
    });
    await FacebookAuthDB.upsertAdAccount({
      id: "act_2", account_id: "2", business_manager_id: "bm_1", name: "B",
    });
    await FacebookAuthDB.upsertAdAccount({
      id: "act_3", account_id: "3", business_manager_id: "bm_2", name: "C",
    });
    const bm1 = await FacebookAuthDB.listAdAccountsForBm("bm_1");
    expect(bm1.map((a) => a.id).sort()).toEqual(["act_1", "act_2"]);
  });
});

describe("Foreign key cascade", () => {
  beforeEach(wipeNewTables);

  test("deleting a BM cascades to its system_users and ad_accounts", async () => {
    await FacebookAuthDB.upsertBusinessManager({ id: "bm_x", name: "X" });
    await FacebookAuthDB.upsertSystemUser({
      fb_user_id: "u1", business_manager_id: "bm_x", name: "Sys", access_token: "t",
    });
    await FacebookAuthDB.upsertAdAccount({
      id: "act_xx", account_id: "xx", business_manager_id: "bm_x", name: "Acct",
    });

    // Delete the BM via raw SQL (no public delete API yet).
    const d = openRawDb();
    await d.runAsync("PRAGMA foreign_keys = ON");
    await d.runAsync("DELETE FROM business_managers WHERE id = ?", ["bm_x"]);
    d.close();

    expect(await FacebookAuthDB.getBusinessManager("bm_x")).toBeNull();
    expect(await FacebookAuthDB.getSystemUserForBm("bm_x")).toBeNull();
    expect(await FacebookAuthDB.getAdAccount("act_xx")).toBeNull();
  });
});
