import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { getSession } from "@/lib/session";
import { enqueueIngestion } from "@/server/jobs";
import { wakeWorker } from "@/server/wake";
import { seedDocument, seedOrg } from "@/test/factories";
import { POST } from "./route";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/server/jobs", () => ({ enqueueIngestion: vi.fn(async () => {}) }));
vi.mock("@/server/wake", () => ({ wakeWorker: vi.fn(async () => true) }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => void callback() }));
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});

const signedInAs = (id: string | null) => vi.mocked(getSession).mockResolvedValue(id ? ({ user: { id } } as never) : null);
const call = (id: string) => POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id }) } as never);

describe.skipIf(!process.env.TEST_DATABASE_URL)("POST /api/documents/[id]/retry (database)", () => {
  beforeEach(async () => {
    vi.mocked(enqueueIngestion).mockClear();
    vi.mocked(wakeWorker).mockClear();
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("refuses a visitor who is not signed in", async () => {
    signedInAs(null);
    expect((await call("00000000-0000-0000-0000-000000000000")).status).toBe(401);
  });

  it("queues a failed document, sends the job and wakes the worker", async () => {
    const a = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "failed" });
    signedInAs(a.userId);

    const response = await call(doc.id);

    expect(response.status).toBe(202);
    expect(enqueueIngestion).toHaveBeenCalledWith(doc.id);
    expect(wakeWorker).toHaveBeenCalledTimes(1);
  });

  it("answers 409 for a document that has not failed and sends no job", async () => {
    const a = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "ready" });
    signedInAs(a.userId);

    expect((await call(doc.id)).status).toBe(409);
    expect(enqueueIngestion).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's document", async () => {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);
    const theirs = await seedDocument(db, { orgId: b.org.id, userId: b.userId, status: "failed" });
    signedInAs(a.userId);

    expect((await call(theirs.id)).status).toBe(404);
    expect(enqueueIngestion).not.toHaveBeenCalled();
  });

  it("still answers 202 when sending the job fails, because the cleanup queues it again", async () => {
    const a = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "failed" });
    signedInAs(a.userId);
    vi.mocked(enqueueIngestion).mockRejectedValueOnce(new Error("queue down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await call(doc.id)).status).toBe(202);
    spy.mockRestore();
  });
});
