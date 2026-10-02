import { EMBEDDING_DIMENSIONS } from "@/db/schema";

/** Turns texts into vectors. Same order in, same order out. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

export const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

/** A free model: no cost per token. Check the current list at https://openrouter.ai/api/v1/embeddings/models */
export const DEFAULT_EMBEDDING_MODEL = "nvidia/nemotron-3-embed-1b:free";

/**
 * OpenRouter marks its free models with a `:free` suffix. This app only ever
 * uses those, so a typo in the model setting can never cost money.
 */
export function assertFreeModel(model: string): void {
  if (!model.endsWith(":free")) {
    throw new Error(`Refusing to use "${model}": only free models (ids ending in ":free") are allowed.`);
  }
}

export type OpenRouterEmbedderOptions = {
  apiKey: string | undefined;
  model?: string;
  fetch?: typeof fetch;
  /** Vector size the database column holds. */
  dimensions?: number;
  timeoutMs?: number;
};

type EmbeddingsResponse = {
  data?: { index?: number; embedding?: number[] }[];
  usage?: { cost?: number | null };
};

/**
 * Embeddings from a free OpenRouter model. Free models ignore a `dimensions`
 * setting, so each one returns vectors of its own fixed size; this checks that
 * size against the database column and fails loudly on a mismatch.
 *
 * Failures are thrown as plain errors, so the job retries with backoff. The
 * free tier allows 20 requests a minute, and 50 a day on accounts that have
 * bought less than 10 credits. One call embeds a whole batch of chunks.
 */
export function createOpenRouterEmbedder(options: OpenRouterEmbedderOptions): Embedder {
  if (!options.apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = options.model || DEFAULT_EMBEDDING_MODEL;
  assertFreeModel(model);
  const doFetch = options.fetch ?? fetch;
  const expectedDimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return async (texts) => {
    if (texts.length === 0) return [];

    const response = await doFetch(OPENROUTER_EMBEDDINGS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", "x-title": "AskDocs" },
      body: JSON.stringify({ model, input: texts, encoding_format: "float" }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) throw new Error(await describeFailure(response));

    const body = (await response.json()) as EmbeddingsResponse;
    // A free model must not cost anything. If a charge ever shows up, stop instead of continuing to spend.
    if (typeof body.usage?.cost === "number" && body.usage.cost > 0) {
      throw new Error(`OpenRouter reported a charge of ${body.usage.cost} credits for "${model}". Stopping: this app is meant to use free models only.`);
    }

    const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== texts.length) {
      throw new Error(`Embedding count mismatch: sent ${texts.length}, got ${rows.length}`);
    }
    return rows.map((row) => {
      const vector = row.embedding;
      if (!vector || vector.length !== expectedDimensions) {
        throw new Error(
          `"${model}" returned ${vector?.length ?? 0}-dimensional vectors but the database column holds ${expectedDimensions}. Change EMBEDDING_DIMENSIONS and migrate, or pick another free model.`,
        );
      }
      return vector;
    });
  };
}

async function describeFailure(response: Response): Promise<string> {
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  if (response.status === 402) {
    return "OpenRouter answered 402 Payment Required. A balance below zero blocks even free models: add a little credit or wait for the balance to recover.";
  }
  if (response.status === 429) {
    return "OpenRouter answered 429 Too Many Requests. Free models allow 20 requests a minute, and 50 a day on accounts with under 10 credits purchased.";
  }
  return `OpenRouter answered ${response.status}: ${detail}`;
}
