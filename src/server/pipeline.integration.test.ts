import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { chunkText } from "@/chunker";
import { chunks, documents, organizations } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { fakeEmbed, seedOrg } from "@/test/factories";
import { createDocument } from "./documents";
import { ingestDocument } from "./ingest";
import { getOrgScope } from "./org-scope";
import { reserveStorage } from "./quota";

// The real quota, chunker and org scope together, with a fake embedder.
describe.skipIf(!process.env.TEST_DATABASE_URL)("upload to ready (database)", () => {
  const { db, pool } = createTestDb();

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("reserves quota, chunks with the real chunker and shows the document only to its organization", async () => {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);
    const text = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} talks about invoices.`).join(" ");
    const data = new TextEncoder().encode(text);

    const created = await createDocument(db, { reserveStorage, enqueue: async () => {} }, { orgId: a.org.id, userId: a.userId, filename: "invoices.txt", data });
    if (!created.ok) throw new Error(created.message);

    await ingestDocument(db, { embed: fakeEmbed, chunk: (t) => chunkText(t) }, { documentId: created.document.id, isLastAttempt: false });

    const [doc] = await db.select().from(documents).where(eq(documents.id, created.document.id));
    expect(doc.status).toBe("ready");
    expect(doc.chunkCount).toBeGreaterThan(3);
    expect(await db.select().from(chunks).where(eq(chunks.documentId, doc.id))).toHaveLength(doc.chunkCount);

    const [org] = await db.select().from(organizations).where(eq(organizations.id, a.org.id));
    expect(org.storageUsedBytes).toBe(data.byteLength);

    const scopeA = await getOrgScope(db, a.userId, a.org.id);
    const scopeB = await getOrgScope(db, b.userId, b.org.id);
    expect((await scopeA.getDocument(doc.id))?.status).toBe("ready");
    expect(await scopeB.getDocument(doc.id)).toBeNull();
    expect(await scopeB.listDocuments()).toEqual([]);
  });

  it("refuses an upload over the quota and keeps no document", async () => {
    const a = await seedOrg(db);
    await db.update(organizations).set({ storageLimitBytes: 10 }).where(eq(organizations.id, a.org.id));

    const result = await createDocument(db, { reserveStorage, enqueue: async () => {} }, { orgId: a.org.id, userId: a.userId, filename: "big.txt", data: new TextEncoder().encode("twenty bytes of text") });

    expect(result).toMatchObject({ ok: false, reason: "quota" });
    expect(await db.select().from(documents)).toEqual([]);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, a.org.id));
    expect(org.storageUsedBytes).toBe(0);
  });
});
