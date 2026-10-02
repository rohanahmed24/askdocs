import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizations } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedOrg } from "@/test/factories";
import { QuotaExceededError } from "./contracts";
import { reserveStorage } from "./quota";

// Runs against a real Postgres. Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!process.env.TEST_DATABASE_URL)("reserveStorage (database)", () => {
  const { db, pool } = createTestDb();

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function orgWithLimit(limitBytes: number, usedBytes = 0) {
    const { org } = await seedOrg(db);
    await db.update(organizations).set({ storageLimitBytes: limitBytes, storageUsedBytes: usedBytes }).where(eq(organizations.id, org.id));
    return org.id;
  }

  async function used(orgId: string) {
    const [row] = await db.select({ used: organizations.storageUsedBytes }).from(organizations).where(eq(organizations.id, orgId));
    return row.used;
  }

  it("adds the size of an upload that fits", async () => {
    const orgId = await orgWithLimit(1000, 100);

    await db.transaction((tx) => reserveStorage(tx, orgId, 250));

    expect(await used(orgId)).toBe(350);
  });

  it("allows an upload that exactly fills the limit", async () => {
    const orgId = await orgWithLimit(1000, 600);

    await db.transaction((tx) => reserveStorage(tx, orgId, 400));

    expect(await used(orgId)).toBe(1000);
  });

  it("throws QuotaExceededError and changes nothing when the upload does not fit", async () => {
    const orgId = await orgWithLimit(1000, 600);

    const attempt = db.transaction((tx) => reserveStorage(tx, orgId, 401));

    await expect(attempt).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(attempt).rejects.toMatchObject({ limitBytes: 1000, usedBytes: 600 });
    expect(await used(orgId)).toBe(600);
  });

  it("lets exactly one of two concurrent uploads through when both cannot fit", async () => {
    const orgId = await orgWithLimit(1000, 0);

    const results = await Promise.allSettled([
      db.transaction((tx) => reserveStorage(tx, orgId, 600)),
      db.transaction((tx) => reserveStorage(tx, orgId, 600)),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(QuotaExceededError);
    expect(await used(orgId)).toBe(600);
  });

  it("makes a second upload wait for the first one's transaction (the row lock)", async () => {
    const orgId = await orgWithLimit(1000, 0);
    let commitFirst!: () => void;
    const gate = new Promise<void>((resolve) => (commitFirst = resolve));
    let firstHasReserved!: () => void;
    const reserved = new Promise<void>((resolve) => (firstHasReserved = resolve));

    // The first upload reserves, then keeps its transaction open.
    const first = db.transaction(async (tx) => {
      await reserveStorage(tx, orgId, 600);
      firstHasReserved();
      await gate;
    });
    await reserved;

    let secondDone = false;
    const second = db.transaction((tx) => reserveStorage(tx, orgId, 600)).finally(() => (secondDone = true));
    second.catch(() => {}); // checked below; avoids an unhandled rejection while waiting
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Without SELECT ... FOR UPDATE the second upload reads the old counter and finishes at once.
    expect(secondDone).toBe(false);

    commitFirst();
    await first;
    await expect(second).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await used(orgId)).toBe(600);
  });

  it("counts every upload when many run at once and all fit", async () => {
    const orgId = await orgWithLimit(10_000, 0);

    await Promise.all(Array.from({ length: 8 }, () => db.transaction((tx) => reserveStorage(tx, orgId, 100))));

    expect(await used(orgId)).toBe(800);
  });

  it("gives the reservation back when the surrounding transaction rolls back", async () => {
    const orgId = await orgWithLimit(1000, 0);

    await expect(
      db.transaction(async (tx) => {
        await reserveStorage(tx, orgId, 300);
        throw new Error("storing the file failed");
      }),
    ).rejects.toThrow("storing the file failed");

    expect(await used(orgId)).toBe(0);
  });

  it("rejects sizes that are not positive whole numbers", async () => {
    const orgId = await orgWithLimit(1000);

    for (const bytes of [0, -5, 1.5, Number.NaN]) {
      await expect(db.transaction((tx) => reserveStorage(tx, orgId, bytes))).rejects.toBeInstanceOf(RangeError);
    }
    expect(await used(orgId)).toBe(0);
  });

  it("fails for an organization that does not exist", async () => {
    await expect(db.transaction((tx) => reserveStorage(tx, "00000000-0000-0000-0000-000000000000", 10))).rejects.toThrow("does not exist");
  });
});
