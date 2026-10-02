import { assertFreeModel } from "../embeddings";
import type { ChatMessage } from "./prompt";

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Free chat models, best first. They are tried in this order for each request
 * (OpenRouter's `models` fallback), because free models are often rate limited
 * upstream. Nemotron 3 Super answered a Bengali question with correct citations
 * and ignored an injected instruction in the probe of 2 Oct 2026.
 */
export const DEFAULT_CHAT_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen3.8-27b:free",
];

/** OpenRouter accepts at most this many models in one fallback list (it answers 400 otherwise). */
export const MAX_FALLBACK_MODELS = 3;

function assertModelList(models: string[]): void {
  if (models.length > MAX_FALLBACK_MODELS) {
    throw new Error(`At most ${MAX_FALLBACK_MODELS} chat models can be listed, got ${models.length}.`);
  }
  for (const model of models) assertFreeModel(model);
}

/** Reads `OPENROUTER_CHAT_MODELS` (comma separated). Every model must be a free one. */
export function parseChatModels(raw: string | undefined): string[] {
  const models = (raw ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const list = models.length > 0 ? models : DEFAULT_CHAT_MODELS;
  assertModelList(list);
  return list;
}

export type ChatFailure = "rate_limited" | "payment" | "unavailable" | "other";

/** A failure of the chat model, with a sentence that can be shown to the user. */
export class ChatServiceError extends Error {
  constructor(
    message: string,
    readonly kind: ChatFailure,
  ) {
    super(message);
    this.name = "ChatServiceError";
  }
}

/** Streams the text of an answer, piece by piece. */
export type ChatStreamer = (args: { messages: ChatMessage[]; signal?: AbortSignal }) => AsyncIterable<string>;

export type OpenRouterChatOptions = {
  apiKey: string | undefined;
  models?: string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type StreamChunk = {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { cost?: number | null };
  error?: { message?: string; code?: number | string };
};

export function createOpenRouterChat(options: OpenRouterChatOptions): ChatStreamer {
  if (!options.apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const models = options.models ?? DEFAULT_CHAT_MODELS;
  assertModelList(models);
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 90_000;

  return async function* stream({ messages, signal }) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await doFetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", "x-title": "AskDocs" },
      body: JSON.stringify({
        models,
        messages,
        stream: true,
        temperature: 0.1,
        max_tokens: 1500, // reasoning models spend part of this before the answer
        reasoning: { exclude: true },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).catch((err: unknown) => {
      if (signal?.aborted) throw err;
      throw new ChatServiceError("The answer service did not respond. Try again in a moment.", "unavailable");
    });

    if (!response.ok) throw failureFor(response.status, await errorDetail(response));
    if (!response.body) throw new ChatServiceError("The answer service sent an empty reply. Try again.", "unavailable");

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          const text = readLine(line);
          if (text === DONE) return;
          if (text) yield text;
        }
      }
      const rest = readLine(buffer.trim());
      if (rest && rest !== DONE) yield rest;
    } finally {
      reader.cancel().catch(() => {});
    }
  };
}

const DONE = Symbol("done");

/** Returns the text of one server-sent-events line, DONE for the end marker, or null for anything else. */
function readLine(line: string): string | typeof DONE | null {
  if (!line.startsWith("data:")) return null; // blank lines and ": OPENROUTER PROCESSING" comments
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") return DONE;

  let chunk: StreamChunk;
  try {
    chunk = JSON.parse(payload) as StreamChunk;
  } catch {
    return null;
  }
  if (chunk.error) throw failureFor(Number(chunk.error.code) || 500, chunk.error.message);
  // A free model must not cost anything. If a charge shows up, stop instead of continuing to spend.
  if (typeof chunk.usage?.cost === "number" && chunk.usage.cost > 0) {
    throw new ChatServiceError("The answer service reported a charge, so it was stopped. This app only uses free models.", "payment");
  }
  const text = chunk.choices?.[0]?.delta?.content;
  return typeof text === "string" && text.length > 0 ? text : null;
}

/** The provider's own error message from a failed response, if it sent one. */
async function errorDetail(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  try {
    const message = (JSON.parse(text) as { error?: { message?: string } }).error?.message;
    return message ?? undefined;
  } catch {
    return text.slice(0, 160) || undefined;
  }
}

function failureFor(status: number, detail?: string): ChatServiceError {
  if (status === 429) {
    return new ChatServiceError("The free AI models are busy or have reached their daily limit. Try again in a few minutes.", "rate_limited");
  }
  if (status === 402) {
    return new ChatServiceError("The AI account balance is below zero, which blocks even free models. Add a little credit or wait for it to recover.", "payment");
  }
  if (status >= 500) return new ChatServiceError("The answer service is having trouble. Try again in a moment.", "unavailable");
  return new ChatServiceError(`The answer service refused the request (${status}).${detail ? ` ${detail.slice(0, 120)}` : ""}`, "other");
}
