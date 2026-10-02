import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { getSession } from "@/lib/session";
import { seedDocument, seedOrg } from "@/test/factories";
import { DELETE } from "./route";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});

const signedInAs = (id: string | null) => vi.mocked(getSession).mockResolvedValue(id ? ({ user: { id } } as never) : null);
const call = (id: string) => DELETE(new Request("http://localhost/api/documents/" + id, { method: "DELETE" }), { params: Promise.resolve({ id }) } as never);

describe.skipIf(!process.env.TEST_DATABASE_URL)("DELETE /api/documents/[id] (database)", () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("refuses a visitor who is not signed in", async () => {
    signedInAs(null);
    expect((await call("00000000-0000-0000-0000-000000000000")).status).toBe(401);
  });

  it("deletes the caller's document", async () => {
    const a = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId });
    signedInAs(a.userId);

    expect((await call(doc.id)).status).toBe(204);
  });

  it("answers 404 for another organization's document, as for one that does not exist", async () => {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);
    const theirs = await seedDocument(db, { orgId: b.org.id, userId: b.userId });
    signedInAs(a.userId);

    expect((await call(theirs.id)).status).toBe(404);
    expect((await call("00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});
