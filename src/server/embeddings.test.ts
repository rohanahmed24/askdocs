import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { DEFAULT_EMBEDDING_MODEL, OPENROUTER_EMBEDDINGS_URL, assertFreeModel, createOpenRouterEmbedder } from "./embeddings";

const vec = (n = EMBEDDING_DIMENSIONS) => Array.from({ length: n }, () => 0.5);
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const rows = (n: number, size = EMBEDDING_DIMENSIONS) => ({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: vec(size) })) });
const fakeFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => vi.fn<typeof fetch>((url, init) => impl(String(url), init ?? {}));

describe("assertFreeModel", () => {
  it("accepts ids ending in :free", () => {
    expect(() => assertFreeModel("nvidia/nemotron-3-embed-1b:free")).not.toThrow();
  });

  it("rejects paid models", () => {
    expect(() => assertFreeModel("openai/text-embedding-3-small")).toThrow(/only free models/);
    expect(() => assertFreeModel("nvidia/nemotron-3-embed-1b")).toThrow(/only free models/);
    expect(() => assertFreeModel("")).toThrow();
  });

  it("is checked when the embedder is created, so a typo cannot reach the API", () => {
    expect(() => createOpenRouterEmbedder({ apiKey: "k", model: "openai/text-embedding-3-large" })).toThrow(/only free models/);
  });
});

describe("createOpenRouterEmbedder", () => {
  it("refuses to start without an API key", () => {
    expect(() => createOpenRouterEmbedder({ apiKey: undefined })).toThrow(/OPENROUTER_API_KEY/);
  });

  it("uses a free model by default", () => {
    expect(DEFAULT_EMBEDDING_MODEL.endsWith(":free")).toBe(true);
  });

  it("sends the texts in one request and returns the vectors in order", async () => {
    const f = fakeFetch(() => reply({ data: [{ index: 1, embedding: vec().map(() => 2) }, { index: 0, embedding: vec().map(() => 1) }] }));
    const embed = createOpenRouterEmbedder({ apiKey: "secret-key", fetch: f });

    const out = await embed(["first", "second"]);

    expect(out[0][0]).toBe(1);
    expect(out[1][0]).toBe(2);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(OPENROUTER_EMBEDDINGS_URL);
    expect(JSON.parse(init?.body as string)).toEqual({ model: DEFAULT_EMBEDDING_MODEL, input: ["first", "second"], encoding_format: "float" });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
  });

  it("does not call the API for an empty list", async () => {
    const f = fakeFetch(() => reply(rows(0)));
    await expect(createOpenRouterEmbedder({ apiKey: "k", fetch: f })([])).resolves.toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("fails loudly when the model returns the wrong number of vectors", async () => {
    const embed = createOpenRouterEmbedder({ apiKey: "k", fetch: fakeFetch(() => reply(rows(1))) });
    await expect(embed(["a", "b"])).rejects.toThrow(/count mismatch/);
  });

  it("fails loudly when vectors do not match the database column", async () => {
    const embed = createOpenRouterEmbedder({ apiKey: "k", fetch: fakeFetch(() => reply(rows(1, 2048))) });
    await expect(embed(["a"])).rejects.toThrow(/2048-dimensional.*column holds 768/);
  });

  it("stops when OpenRouter reports a charge", async () => {
    const embed = createOpenRouterEmbedder({ apiKey: "k", fetch: fakeFetch(() => reply({ ...rows(1), usage: { cost: 0.002 } })) });
    await expect(embed(["a"])).rejects.toThrow(/free models only/);
  });

  it("accepts a zero cost", async () => {
    const embed = createOpenRouterEmbedder({ apiKey: "k", fetch: fakeFetch(() => reply({ ...rows(1), usage: { cost: 0 } })) });
    await expect(embed(["a"])).resolves.toHaveLength(1);
  });

  it("explains a 429 rate limit and a 402 empty balance", async () => {
    const limited = createOpenRouterEmbedder({ apiKey: "k", fetch: fakeFetch(() => reply({ error: "slow down" }, 429)) });
    await expect(limited(["a"])).rejects.toThrow(/20 requests a minute.*50 a day/);

    const broke = createOpenRouterEmbedder({ apiKey: "k", fetch: fakeFetch(() => reply({ error: "pay" }, 402)) });
    await expect(broke(["a"])).rejects.toThrow(/402.*below zero/);
  });

  it("never puts the API key in an error message", async () => {
    const embed = createOpenRouterEmbedder({ apiKey: "secret-key", fetch: fakeFetch(() => reply({ error: "bad" }, 500)) });
    await expect(embed(["a"])).rejects.toThrow(/500/);
    await embed(["a"]).catch((err: Error) => expect(err.message).not.toContain("secret-key"));
  });
});
