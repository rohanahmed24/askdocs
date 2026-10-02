import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "@/db/schema";
import { getSession } from "@/lib/session";
import { seedDocument, seedOrg } from "@/test/factories";
import { wakeWorker } from "@/server/wake";
import { db, pool } from "@/db";
import { GET } from "./route";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  // `after` only works inside a real request; run the callback straight away.
  after: (callback: () => unknown) => void callback(),
}));
vi.mock("@/server/wake", async (original) => ({ ...(await original<typeof import("@/server/wake")>()), wakeWorker: vi.fn(async () => true) }));
// Point the route at the test database.
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});

const signedInAs = (id: string | null) => vi.mocked(getSession).mockResolvedValue(id ? ({ user: { id } } as never) : null);

// Runs against a real Postgres. Skipped when TEST_DATABASE_URL is not set.
describe.skipIf(!process.env.TEST_DATABASE_URL)("GET /api/documents (database)", () => {
  beforeEach(async () => {
    vi.mocked(wakeWorker).mockClear();
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("refuses a visitor who is not signed in", async () => {
    signedInAs(null);
    expect((await GET()).status).toBe(401);
  });

  it("refuses a user who has no organization yet", async () => {
    await db.insert(user).values({ id: "lonely", name: "Lonely", email: "lonely@example.com" });
    signedInAs("lonely");
    expect((await GET()).status).toBe(403);
  });

  it("lists only the caller's documents, without file contents", async () => {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);
    const mine = await seedDocument(db, { orgId: a.org.id, userId: a.userId, filename: "mine.txt", status: "ready" });
    await seedDocument(db, { orgId: b.org.id, userId: b.userId, filename: "theirs.txt", status: "ready" });
    signedInAs(a.userId);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({ id: mine.id, filename: "mine.txt", status: "ready", chunkCount: 0 });
    expect(Object.keys(body.documents[0]).sort()).toEqual(["chunkCount", "createdAt", "error", "filename", "id", "sizeBytes", "status"]);
    expect(wakeWorker).not.toHaveBeenCalled();
  });

  it("wakes the worker when a document has waited too long in the queue", async () => {
    const a = await seedOrg(db);
    await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "queued", updatedAt: new Date(Date.now() - 5 * 60_000) });
    signedInAs(a.userId);

    await GET();

    expect(wakeWorker).toHaveBeenCalledTimes(1);
  });

  it("does not wake the worker for a document that was just queued", async () => {
    const a = await seedOrg(db);
    await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "queued" });
    signedInAs(a.userId);

    await GET();

    expect(wakeWorker).not.toHaveBeenCalled();
  });
});
