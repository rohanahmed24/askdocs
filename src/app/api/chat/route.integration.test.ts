import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, chunks } from "@/db/schema";
import { db, pool } from "@/db";
import { getSession } from "@/lib/session";
import { getChatDeps } from "@/server/chat/config";
import { seedDocument, seedOrg } from "@/test/factories";
import { POST } from "./route";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
vi.mock("@/server/chat/config", () => ({ getChatDeps: vi.fn() }));
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});

const unit0 = () => Object.assign(new Array<number>(EMBEDDING_DIMENSIONS).fill(0), { 0: 1 });
const signedInAs = (id: string | null) => vi.mocked(getSession).mockResolvedValue(id ? ({ user: { id } } as never) : null);
const ask = (question: unknown) => POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ question }) }));
const events = async (response: Response) => (await response.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });

describe.skipIf(!process.env.TEST_DATABASE_URL)("POST /api/chat (database)", () => {
  beforeEach(async () => {
    vi.mocked(getChatDeps).mockReset();
    vi.mocked(getChatDeps).mockReturnValue({
      embed: async (texts) => texts.map(unit0),
      embedModel: "test-model",
      chat: async function* () {
        yield "Due in thirty days [1].";
      },
    });
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function orgWithDocument() {
    const a = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, filename: "terms.txt", status: "ready" });
    await db.insert(chunks).values({ orgId: a.org.id, documentId: doc.id, ordinal: 0, content: "Pay within thirty days.", embedding: unit0() });
    return a;
  }

  it("refuses a visitor who is not signed in", async () => {
    signedInAs(null);
    expect((await ask("hi")).status).toBe(401);
  });

  it("rejects an empty or very long question", async () => {
    const a = await orgWithDocument();
    signedInAs(a.userId);
    expect((await ask("   ")).status).toBe(400);
    expect((await ask("x".repeat(1001))).status).toBe(400);
    expect((await ask(42)).status).toBe(400);
  });

  it("streams the sources, the answer and the cited passages", async () => {
    const a = await orgWithDocument();
    signedInAs(a.userId);

    const response = await ask("When must I pay?");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const list = await events(response);
    expect(list.map((e) => e.type)).toEqual(["sources", "delta", "done"]);
    expect(list.at(-1)).toMatchObject({ type: "done", answer: "Due in thirty days [1].", remaining: 19 });
    expect((list.at(-1)!.citations as { filename: string }[])[0].filename).toBe("terms.txt");
  });

  it("answers 429 with the time left once the hourly limit is used", async () => {
    const a = await orgWithDocument();
    signedInAs(a.userId);
    for (let i = 0; i < 20; i++) await (await ask(`question ${i}`)).text();

    const response = await ask("one more");

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await response.json()).error).toMatch(/20 questions per hour/);
  });

  it("answers 503 when chat is not configured", async () => {
    const a = await orgWithDocument();
    signedInAs(a.userId);
    vi.mocked(getChatDeps).mockImplementation(() => {
      throw new Error("OPENROUTER_API_KEY is not set");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await ask("hi")).status).toBe(503);
    spy.mockRestore();
  });
});
