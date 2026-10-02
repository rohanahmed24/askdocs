import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, chunks, documents } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { fakeEmbed, paragraphChunker, seedDocument, seedOrg } from "@/test/factories";
import { ingestDocument } from "./ingest";

const encode = (s: string) => new TextEncoder().encode(s);

// Runs against a real Postgres. Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!process.env.TEST_DATABASE_URL)("ingestDocument (database)", () => {
  const { db, pool } = createTestDb();
  const deps = { embed: fakeEmbed, chunk: paragraphChunker };

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function setup(data?: Uint8Array, filename?: string) {
    const { userId, org } = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: org.id, userId, data, filename });
    return { org, doc };
  }

  it("turns a document into ordered chunks and marks it ready", async () => {
    const { org, doc } = await setup();
    await ingestDocument(db, deps, { documentId: doc.id, isLastAttempt: false });

    const rows = await db.select().from(chunks).where(eq(chunks.documentId, doc.id)).orderBy(chunks.ordinal);
    expect(rows.map((r) => r.content)).toEqual(["First paragraph.", "Second paragraph.", "Third paragraph."]);
    expect(rows.map((r) => r.ordinal)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.orgId === org.id)).toBe(true);
    expect(rows[0].embedding).toHaveLength(EMBEDDING_DIMENSIONS);

    const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(after).toMatchObject({ status: "ready", error: null, chunkCount: 3 });
  });

  it("indexes a PDF", async () => {
    const pdf = new Uint8Array(readFileSync(new URL("../test/fixtures/hello.pdf", import.meta.url)));
    const { doc } = await setup(pdf, "hello.pdf");
    await ingestDocument(db, deps, { documentId: doc.id, isLastAttempt: false });

    const rows = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
    expect(rows.map((r) => r.content).join(" ")).toContain("Hello AskDocs");
  });

  it("leaves no duplicates when the job runs twice", async () => {
    const { doc } = await setup();
    await ingestDocument(db, deps, { documentId: doc.id, isLastAttempt: false });
    // Simulate a duplicate delivery of a job that already finished once.
    await db.update(documents).set({ status: "queued" }).where(eq(documents.id, doc.id));
    await ingestDocument(db, deps, { documentId: doc.id, isLastAttempt: false });

    const rows = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
    expect(rows).toHaveLength(3);
  });

  it("skips a document that is already ready without calling the embedder", async () => {
    const { doc } = await setup();
    await db.update(documents).set({ status: "ready" }).where(eq(documents.id, doc.id));
    const embed = vi.fn(fakeEmbed);
    await ingestDocument(db, { ...deps, embed }, { documentId: doc.id, isLastAttempt: false });
    expect(embed).not.toHaveBeenCalled();
  });

  it("does nothing for a document that no longer exists", async () => {
    await expect(
      ingestDocument(db, deps, { documentId: "00000000-0000-4000-8000-000000000000", isLastAttempt: false }),
    ).resolves.toBeUndefined();
  });

  it("marks an empty file failed with a message and does not retry", async () => {
    const { doc } = await setup(encode("   "));
    await expect(ingestDocument(db, deps, { documentId: doc.id, isLastAttempt: false })).resolves.toBeUndefined();

    const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(after).toMatchObject({ status: "failed", error: "This file is empty." });
  });

  it("puts the document back in the queue and rethrows on a temporary failure", async () => {
    const { doc } = await setup();
    const embed = vi.fn().mockRejectedValue(new Error("Embedding service is down"));
    await expect(ingestDocument(db, { ...deps, embed }, { documentId: doc.id, isLastAttempt: false })).rejects.toThrow("Embedding service is down");

    const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(after.status).toBe("queued");
    expect(await db.select().from(chunks)).toHaveLength(0);
  });

  it("marks the document failed on the last attempt and still rethrows", async () => {
    const { doc } = await setup();
    const embed = vi.fn().mockRejectedValue(new Error("Embedding service is down"));
    await expect(ingestDocument(db, { ...deps, embed }, { documentId: doc.id, isLastAttempt: true })).rejects.toThrow("Embedding service is down");

    const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(after).toMatchObject({ status: "failed", error: "Indexing failed. Try again later." });
  });

  it("keeps nothing if embedding fails halfway through a large document", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `Paragraph ${i}`).join("\n\n");
    const { doc } = await setup(encode(many));
    let calls = 0;
    const embed = vi.fn(async (texts: string[]) => {
      if (++calls === 2) throw new Error("rate limited");
      return fakeEmbed(texts);
    });
    await expect(ingestDocument(db, { ...deps, embed }, { documentId: doc.id, isLastAttempt: false })).rejects.toThrow("rate limited");
    expect(await db.select().from(chunks)).toHaveLength(0);
  });

  it("embeds large documents in batches", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `Paragraph ${i}`).join("\n\n");
    const { doc } = await setup(encode(many));
    const embed = vi.fn(fakeEmbed);
    await ingestDocument(db, { ...deps, embed }, { documentId: doc.id, isLastAttempt: false });

    expect(embed.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
    const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(after.chunkCount).toBe(250);
  });
});
