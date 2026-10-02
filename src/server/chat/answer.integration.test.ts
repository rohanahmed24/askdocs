import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, chunks } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedDocument, seedOrg } from "@/test/factories";
import { getOrgScope } from "../org-scope";
import { answerQuestion, checkQuestionLimit, questionHash, type ChatEvent } from "./answer";
import { ChatServiceError, type ChatStreamer } from "./llm";
import { NO_ANSWER } from "./prompt";

function unit(degrees: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = Math.cos((degrees * Math.PI) / 180);
  v[1] = Math.sin((degrees * Math.PI) / 180);
  return v;
}

const streamOf = (...pieces: string[]): ChatStreamer =>
  vi.fn(async function* () {
    for (const p of pieces) yield p;
  });

describe.skipIf(!process.env.TEST_DATABASE_URL)("answerQuestion (database)", () => {
  const { db, pool } = createTestDb();

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function setup() {
    const a = await seedOrg(db, 1);
    const b = await seedOrg(db, 2);
    const mine = await seedDocument(db, { orgId: a.org.id, userId: a.userId, filename: "terms.txt", status: "ready" });
    const theirs = await seedDocument(db, { orgId: b.org.id, userId: b.userId, filename: "secret.txt", status: "ready" });
    await db.insert(chunks).values([
      { orgId: a.org.id, documentId: mine.id, ordinal: 0, content: "The customer must pay each invoice within thirty days.", embedding: unit(10) },
      { orgId: b.org.id, documentId: theirs.id, ordinal: 0, content: "TOP SECRET plan of organization B", embedding: unit(0) },
    ]);
    const scope = await getOrgScope(db, a.userId, a.org.id);
    return { a, b, mine, scope };
  }

  const run = async (deps: Parameters<typeof answerQuestion>[0], question = "When must I pay?") => {
    const events: ChatEvent[] = [];
    for await (const e of answerQuestion(deps, question)) events.push(e);
    return events;
  };
  const embedAt = (degrees: number) => vi.fn(async (texts: string[]) => texts.map(() => unit(degrees)));

  it("finds the passage, streams the answer and saves both messages with the citation", async () => {
    const { scope, mine } = await setup();
    const chat = streamOf("The invoice is due ", "in thirty days [1].");

    const events = await run({ scope, embed: embedAt(0), embedModel: "m", chat });

    expect(events.map((e) => e.type)).toEqual(["sources", "delta", "delta", "done"]);
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.answer).toBe("The invoice is due in thirty days [1].");
    expect(done.citations).toHaveLength(1);
    expect(done.citations[0]).toMatchObject({ n: 1, documentId: mine.id, filename: "terms.txt", text: expect.stringContaining("thirty days") });
    expect(done.remaining).toBe(19);

    const saved = await scope.listMessages();
    expect(saved.map((m) => [m.role, m.content])).toEqual([["user", "When must I pay?"], ["assistant", "The invoice is due in thirty days [1]."]]);
    expect(saved[1].citations[0].filename).toBe("terms.txt");
  });

  it("never gives the model another organization's passages", async () => {
    const { scope } = await setup();
    const chat = streamOf("Due in thirty days [1].");

    await run({ scope, embed: embedAt(0), embedModel: "m", chat });

    const sent = JSON.stringify(vi.mocked(chat).mock.calls[0][0].messages);
    expect(sent).toContain("thirty days");
    expect(sent).not.toContain("TOP SECRET");
    expect(sent).not.toContain("secret.txt");
  });

  it("does not call the model when no passage is close enough", async () => {
    const { scope } = await setup();
    const chat = streamOf("should not be used");

    const events = await run({ scope, embed: embedAt(200), embedModel: "m", chat });

    expect(chat).not.toHaveBeenCalled();
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.answer).toBe(NO_ANSWER);
    expect(done.citations).toEqual([]);
    expect((await scope.listMessages()).at(-1)?.content).toBe(NO_ANSWER);
  });

  it("replaces an answer that cites nothing with the no-answer sentence", async () => {
    const { scope } = await setup();
    const events = await run({ scope, embed: embedAt(0), embedModel: "m", chat: streamOf("Probably thirty days, I think.") });
    expect((events.at(-1) as Extract<ChatEvent, { type: "done" }>).answer).toBe(NO_ANSWER);
  });

  it("ignores a citation of a passage that does not exist", async () => {
    const { scope } = await setup();
    const events = await run({ scope, embed: embedAt(0), embedModel: "m", chat: streamOf("Due in thirty days [7].") });
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.citations).toEqual([]);
    expect(done.answer).toBe(NO_ANSWER);
  });

  it("shows no citations when the model itself says it found nothing", async () => {
    const { scope } = await setup();
    const events = await run({ scope, embed: embedAt(0), embedModel: "m", chat: streamOf(NO_ANSWER) });
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.citations).toEqual([]);
  });

  it("reports a failing model, keeps the question and saves no answer", async () => {
    const { scope } = await setup();
    const chat: ChatStreamer = async function* () {
      throw new ChatServiceError("The free AI models are busy.", "rate_limited");
    };

    const events = await run({ scope, embed: embedAt(0), embedModel: "m", chat });

    expect(events.at(-1)).toMatchObject({ type: "error", message: "The free AI models are busy.", remaining: 19 });
    expect((await scope.listMessages()).map((m) => m.role)).toEqual(["user"]);
  });

  it("reports a failing search service without calling the model", async () => {
    const { scope } = await setup();
    const chat = streamOf("x");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const events = await run({ scope, embed: vi.fn(async () => { throw new Error("429"); }), embedModel: "m", chat });

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(chat).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("embeds a repeated question only once, ignoring case and spacing", async () => {
    const { scope } = await setup();
    const embed = embedAt(0);

    await run({ scope, embed, embedModel: "m", chat: streamOf("Due [1].") }, "When must I pay?");
    await run({ scope, embed, embedModel: "m", chat: streamOf("Due [1].") }, "  when must   I PAY? ");

    expect(embed).toHaveBeenCalledTimes(1);
    expect(questionHash("When must I pay?")).toBe(questionHash("  when must   I PAY? "));
  });

  it("saves nothing and sends no error when the user stops the answer", async () => {
    const { scope } = await setup();
    const controller = new AbortController();
    const chat: ChatStreamer = async function* () {
      controller.abort();
      throw new Error("aborted");
    };

    const events = await run({ scope, embed: embedAt(0), embedModel: "m", chat, signal: controller.signal });

    expect(events.map((e) => e.type)).toEqual(["sources"]);
    expect((await scope.listMessages()).map((m) => m.role)).toEqual(["user"]);
  });

  it("counts questions against the hourly limit, including ones that failed", async () => {
    const { scope } = await setup();
    const embed = embedAt(200);
    for (let i = 0; i < 20; i++) await run({ scope, embed, embedModel: "m", chat: streamOf("x") }, `question ${i}`);

    const limit = await checkQuestionLimit(scope);

    expect(limit.remaining).toBe(0);
    expect(limit.message).toMatch(/20 questions per hour.*next question is available in \d+ minutes?/);
  });

  it("gives follow-up questions the earlier turns as history", async () => {
    const { scope } = await setup();
    await run({ scope, embed: embedAt(0), embedModel: "m", chat: streamOf("Due in thirty days [1].") }, "When must I pay?");
    const chat = streamOf("Two percent [1].");

    await run({ scope, embed: embedAt(0), embedModel: "m", chat }, "And if I am late?");

    const sent = vi.mocked(chat).mock.calls[0][0].messages.map((m) => m.content);
    expect(sent).toContain("When must I pay?");
    expect(sent).toContain("Due in thirty days."); // the old answer, without its [1]
  });

  it("finds a passage by its id when the question contains one, and leaves plain questions to meaning", async () => {
    const a = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, filename: "runbook.txt", status: "ready" });
    await db.insert(chunks).values([
      { orgId: a.org.id, documentId: doc.id, ordinal: 0, content: "Quarterly planning notes.", embedding: unit(20) },
      { orgId: a.org.id, documentId: doc.id, ordinal: 1, content: "Error E-4021 means the payment gateway timed out.", embedding: unit(60) },
    ]);
    const scope = await getOrgScope(db, a.userId, a.org.id);
    const chat = streamOf("The gateway timed out [1].");

    await run({ scope, embed: embedAt(0), embedModel: "m", chat, retrieval: "hybrid" }, "What does error E-4021 mean?");
    const withId = JSON.stringify(vi.mocked(chat).mock.calls[0][0].messages.at(-1));
    expect(withId.indexOf("E-4021")).toBeGreaterThan(-1);
    expect(withId.indexOf("E-4021")).toBeLessThan(withId.indexOf("Quarterly")); // the id match is passage 1

    const plain = streamOf("Quarterly [1].");
    await run({ scope, embed: embedAt(0), embedModel: "m", chat: plain, retrieval: "hybrid" }, "What are the plans for the quarter?");
    const withoutId = JSON.stringify(vi.mocked(plain).mock.calls[0][0].messages.at(-1));
    expect(withoutId.indexOf("Quarterly")).toBeLessThan(withoutId.indexOf("E-4021")); // meaning decides
  });

  it("can be switched to meaning alone", async () => {
    const a = await seedOrg(db);
    const doc = await seedDocument(db, { orgId: a.org.id, userId: a.userId, status: "ready" });
    await db.insert(chunks).values([
      { orgId: a.org.id, documentId: doc.id, ordinal: 0, content: "Quarterly planning notes.", embedding: unit(20) },
      { orgId: a.org.id, documentId: doc.id, ordinal: 1, content: "Error E-4021 means the payment gateway timed out.", embedding: unit(60) },
    ]);
    const scope = await getOrgScope(db, a.userId, a.org.id);
    const chat = streamOf("x [1].");

    await run({ scope, embed: embedAt(0), embedModel: "m", chat, retrieval: "vector" }, "What does error E-4021 mean?");

    const sent = JSON.stringify(vi.mocked(chat).mock.calls[0][0].messages.at(-1));
    expect(sent.indexOf("Quarterly")).toBeLessThan(sent.indexOf("E-4021"));
  });
});
