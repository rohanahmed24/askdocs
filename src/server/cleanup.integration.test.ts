import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documentFiles, documents, organizations } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedDocument, seedOrg } from "@/test/factories";
import { cleanupDocuments } from "./cleanup";

const DAY = 24 * 60 * 60 * 1000;

// Runs against a real Postgres. Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!process.env.TEST_DATABASE_URL)("cleanupDocuments (database)", () => {
  const { db, pool } = createTestDb();
  const now = new Date("2026-10-10T03:00:00Z");

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("deletes documents that failed more than 7 days ago, with their files, and releases their bytes", async () => {
    const { userId, org } = await seedOrg(db);
    const old = await seedDocument(db, { orgId: org.id, userId, status: "failed", updatedAt: new Date(now.getTime() - 8 * DAY) });
    const recent = await seedDocument(db, { orgId: org.id, userId, status: "failed", updatedAt: new Date(now.getTime() - 2 * DAY) });
    await db.update(organizations).set({ storageUsedBytes: old.sizeBytes + recent.sizeBytes }).where(eq(organizations.id, org.id));

    const result = await cleanupDocuments(db, { enqueue: vi.fn(), now });

    expect(result.deleted).toBe(1);
    const left = await db.select({ id: documents.id }).from(documents);
    expect(left.map((d) => d.id)).toEqual([recent.id]);
    expect(await db.select().from(documentFiles).where(eq(documentFiles.documentId, old.id))).toHaveLength(0);
    const [after] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    expect(after.storageUsedBytes).toBe(recent.sizeBytes);
  });

  it("never lets the storage counter go below zero", async () => {
    const { userId, org } = await seedOrg(db);
    await seedDocument(db, { orgId: org.id, userId, status: "failed", updatedAt: new Date(now.getTime() - 9 * DAY) });
    // The counter was never incremented, so releasing would go negative without the floor.
    await cleanupDocuments(db, { enqueue: vi.fn(), now });
    const [after] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    expect(after.storageUsedBytes).toBe(0);
  });

  it("queues documents stuck in queued for more than 10 minutes, and only those", async () => {
    const { userId, org } = await seedOrg(db);
    const stuck = await seedDocument(db, { orgId: org.id, userId, status: "queued", updatedAt: new Date(now.getTime() - 30 * 60_000) });
    await seedDocument(db, { orgId: org.id, userId, status: "queued", updatedAt: new Date(now.getTime() - 2 * 60_000) });
    await seedDocument(db, { orgId: org.id, userId, status: "ready", updatedAt: new Date(now.getTime() - 3 * DAY) });
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await cleanupDocuments(db, { enqueue, now });

    expect(result.requeued).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(stuck.id);
  });
});
