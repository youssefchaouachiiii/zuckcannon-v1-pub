// tests/facebook-cache-db.test.js
import { FacebookCacheDB } from "../backend/utils/facebook-cache-db.js";
import db from "../backend/utils/facebook-cache-db.js";

// Distinct test IDs so we can clean up only our own seeded rows.
const CAMP_ID = "camp_acctlookup_test";
const CAMP_ACCOUNT = "act_111222333";
const ADSET_ID = "adset_acctlookup_test";
const ADSET_ACCOUNT = "act_444555666";

beforeAll(async () => {
  // This branch's cache schema has cached_campaigns but does NOT create a
  // cached_adsets table. Create it here (test-only) so getAccountIdForAdset
  // has something to read, matching the column the getter selects.
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS cached_adsets (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT,
      data TEXT,
      last_fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.runAsync(
    `INSERT OR REPLACE INTO cached_campaigns (id, user_id, account_id, name, data) VALUES (?, 0, ?, ?, ?)`,
    [CAMP_ID, CAMP_ACCOUNT, "Lookup Test Campaign", JSON.stringify({ id: CAMP_ID })]
  );
  await db.runAsync(
    `INSERT OR REPLACE INTO cached_adsets (id, account_id, name, data) VALUES (?, ?, ?, ?)`,
    [ADSET_ID, ADSET_ACCOUNT, "Lookup Test Adset", JSON.stringify({ id: ADSET_ID })]
  );
});

afterAll(async () => {
  await db.runAsync(`DELETE FROM cached_campaigns WHERE id = ?`, [CAMP_ID]);
  // The no-table test may have dropped cached_adsets; DROP IF EXISTS is safe
  // whether the table is still present (seeded row goes with it) or already gone.
  await db.runAsync(`DROP TABLE IF EXISTS cached_adsets`);
});

describe("FacebookCacheDB.getAccountIdForCampaign", () => {
  test("returns the account_id for a seeded campaign", async () => {
    const accountId = await FacebookCacheDB.getAccountIdForCampaign(CAMP_ID);
    expect(accountId).toBe(CAMP_ACCOUNT);
  });

  test("returns null for an unknown campaign id", async () => {
    const accountId = await FacebookCacheDB.getAccountIdForCampaign("camp_does_not_exist");
    expect(accountId).toBeNull();
  });
});

describe("FacebookCacheDB.getAccountIdForAdset", () => {
  test("returns the account_id for a seeded adset", async () => {
    const accountId = await FacebookCacheDB.getAccountIdForAdset(ADSET_ID);
    expect(accountId).toBe(ADSET_ACCOUNT);
  });

  test("returns null for an unknown adset id", async () => {
    const accountId = await FacebookCacheDB.getAccountIdForAdset("adset_does_not_exist");
    expect(accountId).toBeNull();
  });

  // Run last: drops the test-only cached_adsets table so we exercise the
  // missing-table path. The getter must resolve to null, not throw
  // SQLITE_ERROR: no such table: cached_adsets.
  test("returns null (does not throw) when cached_adsets table does not exist", async () => {
    await db.runAsync(`DROP TABLE IF EXISTS cached_adsets`);
    await expect(FacebookCacheDB.getAccountIdForAdset("whatever")).resolves.toBeNull();
  });
});
