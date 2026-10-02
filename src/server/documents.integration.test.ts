import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { documentFiles, documents, organizations } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedOrg } from "@/test/factories";
import { QuotaExceededError, type ReserveStorage } from "./contracts";
import { createDocument, sanitizeFilename } from "./documents";
import { MAX_UPLOAD_BYTES } from "./extract";

const encode = (s: string) => new TextEncoder().encode(s);

describe("sanitizeFilename", () => {
  it("keeps only the file name", () => {
    expect(sanitizeFilename("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFilename("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });

  it("removes control characters and falls back when nothing is left", () => {
    expect(sanitizeFilename("a\u0000b\nc.txt")).toBe("abc.txt");
    expect(sanitizeFilename("   ")).toBe("untitled");
    expect(sanitizeFilename("folder/")).toBe("untitled");
  });
});

// Runs against a real Postgres. Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!process.env.TEST_DATABASE_URL)("createDocument (database)", () => {
  const { db, pool } = createTestDb();

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  // A stand-in for the hand-written reserveStorage: a plain, unlocked update.
  const reserve: ReserveStorage = async (tx, orgId, bytes) => {
    await tx
      .update(organizations)
      .set({ storageUsedBytes: sql`${organizations.storageUsedBytes} + ${bytes}` })
      .where(eq(organizations.id, orgId));
  };

  it("stores the file, queues the document, reserves quota and queues the job", async () => {
    const { userId, org } = await seedOrg(db);
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await createDocument(db, { reserveStorage: reserve, enqueue }, { orgId: org.id, userId, filename: "../notes.md", data: encode("# Hi") });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toMatchObject({ filename: "notes.md", contentType: "text/markdown", sizeBytes: 4, status: "queued", orgId: org.id });
    const [file] = await db.select().from(documentFiles).where(eq(documentFiles.documentId, result.document.id));
    expect(Buffer.from(file.data).toString()).toBe("# Hi");
    const [after] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    expect(after.storageUsedBytes).toBe(4);
    expect(enqueue).toHaveBeenCalledWith(result.document.id);
  });

  it.each([
    ["an unsupported type", "photo.png", encode("x"), "unsupported_type"],
    ["an empty file", "empty.txt", new Uint8Array(), "empty"],
    ["a file over the size limit", "big.txt", new Uint8Array(MAX_UPLOAD_BYTES + 1), "too_large"],
  ] as const)("rejects %s before touching quota", async (_label, filename, data, reason) => {
    const { userId, org } = await seedOrg(db);
    const reserveStorage = vi.fn(reserve);
    const enqueue = vi.fn();

    const result = await createDocument(db, { reserveStorage, enqueue }, { orgId: org.id, userId, filename, data });

    expect(result).toMatchObject({ ok: false, reason });
    expect(reserveStorage).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await db.select().from(documents)).toHaveLength(0);
  });

  it("keeps nothing and queues nothing when the quota is exceeded", async () => {
    const { userId, org } = await seedOrg(db);
    const reserveStorage: ReserveStorage = async () => {
      throw new QuotaExceededError(50 * 1024 * 1024, 50 * 1024 * 1024);
    };
    const enqueue = vi.fn();

    const result = await createDocument(db, { reserveStorage, enqueue }, { orgId: org.id, userId, filename: "a.txt", data: encode("hello") });

    expect(result).toMatchObject({ ok: false, reason: "quota" });
    expect(result.ok ? "" : result.message).toContain("50 MB of 50 MB");
    expect(await db.select().from(documents)).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("releases the reserved quota if storing the file fails", async () => {
    const { org } = await seedOrg(db);
    const enqueue = vi.fn();
    // A user id that does not exist breaks the uploaded_by foreign key after the quota was reserved.
    await expect(
      createDocument(db, { reserveStorage: reserve, enqueue }, { orgId: org.id, userId: "ghost", filename: "a.txt", data: encode("hello") }),
    ).rejects.toThrow();

    const [after] = await db.select().from(organizations).where(eq(organizations.id, org.id));
    expect(after.storageUsedBytes).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still succeeds when queueing the job fails, leaving the document queued", async () => {
    const { userId, org } = await seedOrg(db);
    const enqueue = vi.fn().mockRejectedValue(new Error("queue down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createDocument(db, { reserveStorage: reserve, enqueue }, { orgId: org.id, userId, filename: "a.txt", data: encode("hello") });

    expect(result.ok).toBe(true);
    expect((await db.select().from(documents))[0].status).toBe("queued");
    spy.mockRestore();
  });
});
