import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, chunks, documents, messages } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedDocument, seedOrg } from "@/test/factories";
import { getOrgScope } from "./org-scope";

/** A vector whose cosine similarity with `unit(0)` is cos(degrees). */
function unit(degrees: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = Math.cos((degrees * Math.PI) / 180);
  v[1] = Math.sin((degrees * Math.PI) / 180);
  return v;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("org scope: search, messages and embedding cache (database)", () => {
  const { db, pool } = createTestDb();

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function addChunk(orgId: string, documentId: string, ordinal: number, content: string, degrees: number) {
    await db.insert(chunks).values({ orgId, documentId, ordinal, content, embedding: unit(degrees) });
  }

  describe("searchChunks", () => {
    it("returns the closest passages first, with the document name and a similarity", async () => {
      const a = await seedOrg(db);
      const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, filename: "terms.txt", status: "ready" });
      await addChunk(a.org.id, doc.id, 0, "far", 80);
      await addChunk(a.org.id, doc.id, 1, "near", 10);
      await addChunk(a.org.id, doc.id, 2, "middle", 45);
      const scope = await getOrgScope(db, a.userId, a.org.id);

      const hits = await scope.searchChunks(unit(0), { limit: 2 });

      expect(hits.map((h) => h.content)).toEqual(["near", "middle"]);
      expect(hits[0]).toMatchObject({ filename: "terms.txt", ordinal: 1, documentId: doc.id });
      expect(hits[0].similarity).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 2);
    });

    it("never returns another organization's passages, even when they are closer", async () => {
      const a = await seedOrg(db, 1);
      const b = await seedOrg(db, 2);
      const mine = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "ready" });
      const theirs = await seedDocument(db, { orgId: b.org.id, userId: b.userId, status: "ready" });
      await addChunk(a.org.id, mine.id, 0, "mine", 60);
      await addChunk(b.org.id, theirs.id, 0, "secret of org B", 0);
      const scope = await getOrgScope(db, a.userId, a.org.id);

      const hits = await scope.searchChunks(unit(0));

      expect(hits.map((h) => h.content)).toEqual(["mine"]);
    });

    it("still finds this organization's passages when another organization has many closer ones", async () => {
      const a = await seedOrg(db, 1);
      const b = await seedOrg(db, 2);
      const mine = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "ready" });
      const theirs = await seedDocument(db, { orgId: b.org.id, userId: b.userId, status: "ready" });
      await addChunk(a.org.id, mine.id, 0, "mine 1", 50);
      await addChunk(a.org.id, mine.id, 1, "mine 2", 55);
      // More closer neighbours than the index looks at in one pass (ef_search).
      await db.insert(chunks).values(Array.from({ length: 250 }, (_, i) => ({ orgId: b.org.id, documentId: theirs.id, ordinal: i, content: `theirs ${i}`, embedding: unit(i / 100) })));
      const scope = await getOrgScope(db, a.userId, a.org.id);

      const hits = await scope.searchChunks(unit(0), { limit: 2 });

      expect(hits.map((h) => h.content)).toEqual(["mine 1", "mine 2"]);
    });

    it("skips documents that are not ready", async () => {
      const a = await seedOrg(db);
      const ready = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "ready" });
      const failed = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "failed" });
      await addChunk(a.org.id, ready.id, 0, "ready one", 30);
      await addChunk(a.org.id, failed.id, 0, "failed one", 5);
      const scope = await getOrgScope(db, a.userId, a.org.id);

      expect((await scope.searchChunks(unit(0))).map((h) => h.content)).toEqual(["ready one"]);
    });

    it("drops passages below the minimum similarity, and returns nothing when none is close", async () => {
      const a = await seedOrg(db);
      const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "ready" });
      await addChunk(a.org.id, doc.id, 0, "close", 20);
      await addChunk(a.org.id, doc.id, 1, "unrelated", 85);
      const scope = await getOrgScope(db, a.userId, a.org.id);

      expect((await scope.searchChunks(unit(0), { minSimilarity: 0.5 })).map((h) => h.content)).toEqual(["close"]);
      expect(await scope.searchChunks(unit(200), { minSimilarity: 0.5 })).toEqual([]);
    });

    it("returns an empty list for an organization with no documents", async () => {
      const a = await seedOrg(db);
      expect(await (await getOrgScope(db, a.userId, a.org.id)).searchChunks(unit(0))).toEqual([]);
    });
  });

  describe("messages", () => {
    it("keeps each user's conversation separate and returns the latest ones oldest first", async () => {
      const a = await seedOrg(db, 1);
      const b = await seedOrg(db, 2);
      const scopeA = await getOrgScope(db, a.userId, a.org.id);
      const scopeB = await getOrgScope(db, b.userId, b.org.id);

      await scopeA.addMessage({ role: "user", content: "first" });
      await scopeA.addMessage({ role: "assistant", content: "answer", citations: [{ n: 1, documentId: "d", chunkId: "c", filename: "f.txt", ordinal: 0, text: "passage" }] });
      await scopeA.addMessage({ role: "user", content: "second" });
      await scopeB.addMessage({ role: "user", content: "someone else" });

      const listed = await scopeA.listMessages();
      expect(listed.map((m) => m.content)).toEqual(["first", "answer", "second"]);
      expect(listed[1].citations[0]).toMatchObject({ n: 1, filename: "f.txt", text: "passage" });
      expect((await scopeA.listMessages(2)).map((m) => m.content)).toEqual(["answer", "second"]);
      expect((await scopeB.listMessages()).map((m) => m.content)).toEqual(["someone else"]);
    });

    it("lists only the user's own questions since a time", async () => {
      const a = await seedOrg(db);
      const scope = await getOrgScope(db, a.userId, a.org.id);
      await scope.addMessage({ role: "user", content: "old" });
      await scope.addMessage({ role: "assistant", content: "reply" });
      await scope.addMessage({ role: "user", content: "new" });
      const [old] = await db.select().from(messages).where(eq(messages.content, "old"));
      await db.update(messages).set({ createdAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(messages.id, old.id));

      const times = await scope.questionTimesSince(new Date(Date.now() - 3600_000));

      expect(times).toHaveLength(1);
    });
  });

  describe("embedding cache", () => {
    it("misses, then returns what was saved, per model and organization", async () => {
      const a = await seedOrg(db, 1);
      const b = await seedOrg(db, 2);
      const scopeA = await getOrgScope(db, a.userId, a.org.id);
      const scopeB = await getOrgScope(db, b.userId, b.org.id);

      expect(await scopeA.getCachedEmbedding("model-x", "hash-1")).toBeNull();
      await scopeA.cacheEmbedding("model-x", "hash-1", unit(30));

      const saved = await scopeA.getCachedEmbedding("model-x", "hash-1");
      expect(saved).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(saved?.[0]).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 2);
      expect(await scopeA.getCachedEmbedding("model-y", "hash-1")).toBeNull();
      expect(await scopeB.getCachedEmbedding("model-x", "hash-1")).toBeNull();
    });

    it("keeps the first saved value when the same question is saved twice", async () => {
      const a = await seedOrg(db);
      const scope = await getOrgScope(db, a.userId, a.org.id);
      await scope.cacheEmbedding("m", "h", unit(10));
      await expect(scope.cacheEmbedding("m", "h", unit(80))).resolves.toBeUndefined();
      expect((await scope.getCachedEmbedding("m", "h"))?.[0]).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 2);
    });
  });

  it("deleting a document removes its passages from search", async () => {
    const a = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "ready" });
    await addChunk(a.org.id, doc.id, 0, "soon gone", 10);
    const scope = await getOrgScope(db, a.userId, a.org.id);

    await scope.deleteDocument(doc.id);

    expect(await scope.searchChunks(unit(0))).toEqual([]);
    expect(await db.select().from(documents).where(eq(documents.id, doc.id))).toEqual([]);
  });
});
