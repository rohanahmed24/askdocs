import { DEFAULT_EMBEDDING_MODEL, createOpenRouterEmbedder, type Embedder } from "../embeddings";
import { createOpenRouterChat, parseChatModels, type ChatStreamer } from "./llm";

export type ChatDeps = { embed: Embedder; embedModel: string; chat: ChatStreamer; retrieval: "hybrid" | "vector" };

let deps: ChatDeps | null = null;

/**
 * The embedding and chat clients, built from the environment on first use.
 * Throws when `OPENROUTER_API_KEY` is missing, or when a configured model is not free.
 */
export function getChatDeps(): ChatDeps {
  if (!deps) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const embedModel = process.env.OPENROUTER_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
    deps = {
      embed: createOpenRouterEmbedder({ apiKey, model: embedModel }),
      embedModel,
      chat: createOpenRouterChat({ apiKey, models: parseChatModels(process.env.OPENROUTER_CHAT_MODELS) }),
      retrieval: process.env.RETRIEVAL_MODE === "vector" ? "vector" : "hybrid",
    };
  }
  return deps;
}
