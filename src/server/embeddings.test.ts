import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { createGeminiEmbedder } from "./embeddings";

const vec = (n = EMBEDDING_DIMENSIONS) => Array.from({ length: n }, () => 0.5);
// The AI SDK function is generic, so tests pass a minimal stand-in.
const fakeEmbedMany = (impl: (args: Record<string, unknown>) => Promise<{ embeddings: number[][] }>) =>
  vi.fn(impl) as unknown as NonNullable<Parameters<typeof createGeminiEmbedder>[0]["embedManyFn"]>;

describe("createGeminiEmbedder", () => {
  it("refuses to start without an API key", () => {
    expect(() => createGeminiEmbedder({ apiKey: undefined })).toThrow(/GEMINI_API_KEY/);
  });

  it("asks for 768-dimensional document embeddings with retries", async () => {
    const run = fakeEmbedMany(async () => ({ embeddings: [vec(), vec()] }));
    const embed = createGeminiEmbedder({ apiKey: "test-key", embedManyFn: run });

    const out = await embed(["a", "b"]);

    expect(out).toHaveLength(2);
    const args = (run as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.values).toEqual(["a", "b"]);
    expect(args.maxRetries).toBeGreaterThanOrEqual(3);
    expect(args.providerOptions).toEqual({
      google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: "RETRIEVAL_DOCUMENT" },
    });
  });

  it("does not call the API for an empty list", async () => {
    const run = fakeEmbedMany(async () => ({ embeddings: [] }));
    const embed = createGeminiEmbedder({ apiKey: "test-key", embedManyFn: run });
    await expect(embed([])).resolves.toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails loudly when the model returns the wrong number of vectors", async () => {
    const embed = createGeminiEmbedder({ apiKey: "k", embedManyFn: fakeEmbedMany(async () => ({ embeddings: [vec()] })) });
    await expect(embed(["a", "b"])).rejects.toThrow(/count mismatch/);
  });

  it("fails loudly when vectors have the wrong size", async () => {
    const embed = createGeminiEmbedder({ apiKey: "k", embedManyFn: fakeEmbedMany(async () => ({ embeddings: [vec(3072)] })) });
    await expect(embed(["a"])).rejects.toThrow(/768-dimensional/);
  });
});
