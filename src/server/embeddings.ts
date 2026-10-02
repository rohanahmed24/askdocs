import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany } from "ai";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";

/** Turns texts into vectors. Same order in, same order out. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

type EmbedMany = typeof embedMany;

/**
 * Gemini embeddings through the AI SDK. The model is asked for 768-dimensional
 * vectors so they fit a pgvector HNSW index (limit 2000). Vectors shorter than
 * the model's full size are not unit length, which does not matter here:
 * cosine distance ignores length.
 */
export function createGeminiEmbedder(options: { apiKey: string | undefined; embedManyFn?: EmbedMany }): Embedder {
  if (!options.apiKey) throw new Error("GEMINI_API_KEY is not set");
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey });
  const model = google.embedding("gemini-embedding-001");
  const run = options.embedManyFn ?? embedMany;

  return async (texts) => {
    if (texts.length === 0) return [];
    const { embeddings } = await run({
      model,
      values: texts,
      maxRetries: 4, // the SDK backs off on 429 and 5xx
      providerOptions: {
        google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: "RETRIEVAL_DOCUMENT" },
      },
    });
    if (embeddings.length !== texts.length) {
      throw new Error(`Embedding count mismatch: sent ${texts.length}, got ${embeddings.length}`);
    }
    for (const e of embeddings) {
      if (e.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-dimensional embeddings, got ${e.length}`);
      }
    }
    return embeddings;
  };
}
