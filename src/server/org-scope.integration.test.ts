import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, chunks, documentFiles, documents, memberships, organizations } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedDocument, seedOrg } from "@/test/factories";
import { OrgAccessError, getOrgScope } from "./org-scope";

// Runs against a real Postgres. Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!process.env.TEST_DATABASE_URL)("org scope (database)", () => {
  const { db, pool } = createTestDb();

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("returns only rows that belong to the caller's organization", async () => {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);
    const docA = await seedDocument(db, { orgId: a.org.id, userId: a.userId, filename: "a.txt" });
    await seedDocument(db, { orgId: b.org.id, userId: b.userId, filename: "b.txt" });

    const scope = await getOrgScope(db, a.userId, a.org.id);
    const list = await scope.listDocuments();

    expect(list.map((d) => d.id)).toEqual([docA.id]);
  });

  it("lists newest documents first", async () => {
    const a = await seedOrg(db);
    const first = await seedDocument(db, { orgId: a.org.id, userId: a.userId, filename: "first.txt" });
    const second = await seedDocument(db, { orgId: a.org.id, userId: a.userId, filename: "second.txt" });

    const scope = await getOrgScope(db, a.userId, a.org.id);

    expect((await scope.listDocuments()).map((d) => d.id)).toEqual([second.id, first.id]);
  });

  it("a user in org A cannot read org B's documents, even with a valid id", async () => {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);
    const docB = await seedDocument(db, { orgId: b.org.id, userId: b.userId });
    const docA = await seedDocument(db, { orgId: a.org.id, userId: a.userId });

    const scope = await getOrgScope(db, a.userId, a.org.id);

    expect(await scope.getDocument(docB.id)).toBeNull();
    expect((await scope.getDocument(docA.id))?.id).toBe(docA.id);
  });

  it("treats a malformed or unknown document id as not found", async () => {
    const a = await seedOrg(db);
    const scope = await getOrgScope(db, a.userId, a.org.id);

    expect(await scope.getDocument("not-a-uuid")).toBeNull();
    expect(await scope.getDocument("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("a user who is not a member of the organization is rejected", async () => {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);

    const attempt = getOrgScope(db, b.userId, a.org.id);

    await expect(attempt).rejects.toBeInstanceOf(OrgAccessError);
    await expect(attempt).rejects.toMatchObject({ reason: "not_member", orgId: a.org.id });
  });

  it("rejects a user id that does not exist", async () => {
    const a = await seedOrg(db);
    await expect(getOrgScope(db, "nobody", a.org.id)).rejects.toBeInstanceOf(OrgAccessError);
  });

  it("owners and members are told apart", async () => {
    const a = await seedOrg(db, 1);
    const other = await seedOrg(db, 2);
    // User 2 also joins org 1, as a plain member.
    await db.insert(memberships).values({ orgId: a.org.id, userId: other.userId, role: "member" });

    const owner = await getOrgScope(db, a.userId, a.org.id);
    const member = await getOrgScope(db, other.userId, a.org.id);

    expect(owner.role).toBe("owner");
    expect(owner.isOwner).toBe(true);
    expect(() => owner.requireOwner()).not.toThrow();

    expect(member.role).toBe("member");
    expect(member.isOwner).toBe(false);
    expect(() => member.requireOwner()).toThrow(OrgAccessError);
    expect(() => member.requireOwner()).toThrow(expect.objectContaining({ reason: "not_owner" }));
  });

  it("inOrg limits a query on any tenant table to the organization", async () => {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);
    const docA = await seedDocument(db, { orgId: a.org.id, userId: a.userId });
    const docB = await seedDocument(db, { orgId: b.org.id, userId: b.userId });
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    await db.insert(chunks).values([
      { orgId: a.org.id, documentId: docA.id, ordinal: 0, content: "a", embedding: vector },
      { orgId: b.org.id, documentId: docB.id, ordinal: 0, content: "b", embedding: vector },
    ]);

    const scope = await getOrgScope(db, a.userId, a.org.id);
    const rows = await db.select().from(chunks).where(scope.inOrg(chunks));
    const asking = await db.select().from(documents).where(scope.inOrg(documents, eq(documents.id, docB.id)));

    expect(rows.map((r) => r.content)).toEqual(["a"]);
    expect(asking).toEqual([]);
  });

  describe("deleteDocument", () => {
    async function orgWithUsedBytes(n: number, used: number) {
      const seeded = await seedOrg(db, n);
      await db.update(organizations).set({ storageUsedBytes: used }).where(eq(organizations.id, seeded.org.id));
      return seeded;
    }
    const usedBytes = async (orgId: string) => (await db.select().from(organizations).where(eq(organizations.id, orgId)))[0].storageUsedBytes;

    it("removes the document, its file and its chunks, and releases its size", async () => {
      const a = await orgWithUsedBytes(1, 1000);
      const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, data: new Uint8Array(400) });
      await db.insert(chunks).values({ orgId: a.org.id, documentId: doc.id, ordinal: 0, content: "x", embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1) });
      const scope = await getOrgScope(db, a.userId, a.org.id);

      expect(await scope.deleteDocument(doc.id)).toBe(true);

      expect(await db.select().from(documents)).toEqual([]);
      expect(await db.select().from(documentFiles)).toEqual([]);
      expect(await db.select().from(chunks)).toEqual([]);
      expect(await usedBytes(a.org.id)).toBe(600);
    });

    it("cannot delete a document of another organization, and releases nothing", async () => {
      const a = await orgWithUsedBytes(1, 500);
      const b = await orgWithUsedBytes(2, 500);
      const theirs = await seedDocument(db, { orgId: b.org.id, userId: b.userId, data: new Uint8Array(100) });
      const scope = await getOrgScope(db, a.userId, a.org.id);

      expect(await scope.deleteDocument(theirs.id)).toBe(false);

      expect(await db.select().from(documents)).toHaveLength(1);
      expect(await usedBytes(b.org.id)).toBe(500);
      expect(await usedBytes(a.org.id)).toBe(500);
    });

    it("returns false for an unknown or malformed id", async () => {
      const a = await seedOrg(db);
      const scope = await getOrgScope(db, a.userId, a.org.id);
      expect(await scope.deleteDocument("00000000-0000-0000-0000-000000000000")).toBe(false);
      expect(await scope.deleteDocument("nope")).toBe(false);
    });

    it("lets a member delete their own upload but not someone else's", async () => {
      const a = await orgWithUsedBytes(1, 300);
      const member = await seedOrg(db, 2);
      await db.insert(memberships).values({ orgId: a.org.id, userId: member.userId, role: "member" });
      const ownerDoc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, data: new Uint8Array(100) });
      const memberDoc = await seedDocument(db, { orgId: a.org.id, userId: member.userId, data: new Uint8Array(100) });
      const scope = await getOrgScope(db, member.userId, a.org.id);

      await expect(scope.deleteDocument(ownerDoc.id)).rejects.toMatchObject({ reason: "not_owner" });
      expect(await scope.deleteDocument(memberDoc.id)).toBe(true);
      expect(await db.select().from(documents)).toHaveLength(1);
      expect(await usedBytes(a.org.id)).toBe(200);
    });

    it("lets an owner delete a document a member uploaded", async () => {
      const a = await orgWithUsedBytes(1, 300);
      const member = await seedOrg(db, 2);
      await db.insert(memberships).values({ orgId: a.org.id, userId: member.userId, role: "member" });
      const memberDoc = await seedDocument(db, { orgId: a.org.id, userId: member.userId, data: new Uint8Array(100) });
      const owner = await getOrgScope(db, a.userId, a.org.id);

      expect(await owner.deleteDocument(memberDoc.id)).toBe(true);
    });

    it("releases the size only once when two deletes race", async () => {
      const a = await orgWithUsedBytes(1, 500);
      const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, data: new Uint8Array(200) });
      const scope = await getOrgScope(db, a.userId, a.org.id);

      const results = await Promise.all([scope.deleteDocument(doc.id), scope.deleteDocument(doc.id)]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await usedBytes(a.org.id)).toBe(300);
    });
  });
});
