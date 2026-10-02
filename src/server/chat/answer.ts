import { createHash } from "node:crypto";
import type { Citation } from "@/db/schema";
import type { Embedder } from "../embeddings";
import type { OrgScope } from "../org-scope";
import { ChatServiceError, type ChatStreamer } from "./llm";
import { QUESTIONS_PER_HOUR, limitMessage, questionBudget } from "./limit";
import { MIN_SIMILARITY, NO_ANSWER, PASSAGE_LIMIT, buildMessages, citationsFor, isNoAnswer, toPassages } from "./prompt";

export type ChatEvent =
  /** The passages found for the question, numbered. The answer may cite some of them. */
  | { type: "sources"; sources: Citation[] }
  /** A piece of the answer text. */
  | { type: "delta"; text: string }
  /** The finished answer, with the passages it cites. `answer` replaces the streamed text. */
  | { type: "done"; answer: string; citations: Citation[]; remaining: number }
  | { type: "error"; message: string; remaining: number };

export type AnswerDeps = {
  scope: OrgScope;
  embed: Embedder;
  /** Names the embedding model in the cache key, so a model change never reuses old vectors. */
  embedModel: string;
  chat: ChatStreamer;
  signal?: AbortSignal;
  now?: () => Date;
};

/** Looks the user up against the hourly limit. Call it before `answerQuestion`. */
export async function checkQuestionLimit(scope: OrgScope, now: Date = new Date()) {
  const times = await scope.questionTimesSince(new Date(now.getTime() - 3_600_000));
  const budget = questionBudget(times, now);
  return { ...budget, message: budget.retryAfterSeconds ? limitMessage(budget.retryAfterSeconds) : null };
}

/** Same question, same hash: ignores case and extra spaces. */
export function questionHash(question: string): string {
  return createHash("sha256").update(question.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

/**
 * Answers one question from the organization's documents:
 * embed the question (reusing a saved vector when it was asked before), find the
 * closest passages, and have the model answer from them with citations. When no
 * passage is close enough the model is not called at all, which also saves one
 * of the few free requests per day.
 *
 * The question is saved first, so it counts against the hourly limit even when
 * the answer fails. The answer is saved only when it is complete.
 */
export async function* answerQuestion(deps: AnswerDeps, question: string): AsyncGenerator<ChatEvent> {
  const { scope, embed, embedModel, chat, signal } = deps;
  const now = deps.now?.() ?? new Date();
  const before = questionBudget(await scope.questionTimesSince(new Date(now.getTime() - 3_600_000)), now);
  const remaining = Math.max(0, before.remaining - 1);
  const history = (await scope.listMessages(4)).map((m) => ({ role: m.role, content: m.content }));
  await scope.addMessage({ role: "user", content: question });

  let queryVector: number[];
  try {
    const hash = questionHash(question);
    const cached = await scope.getCachedEmbedding(embedModel, hash);
    if (cached) {
      queryVector = cached;
    } else {
      [queryVector] = await embed([question]);
      await scope.cacheEmbedding(embedModel, hash, queryVector);
    }
  } catch (err) {
    console.error("Could not embed the question", err);
    yield { type: "error", message: "The search service is busy or has reached its daily limit. Try again in a few minutes.", remaining };
    return;
  }

  const passages = toPassages(await scope.searchChunks(queryVector, { limit: PASSAGE_LIMIT, minSimilarity: MIN_SIMILARITY }));
  yield { type: "sources", sources: passages };

  if (passages.length === 0) {
    yield { type: "delta", text: NO_ANSWER };
    await scope.addMessage({ role: "assistant", content: NO_ANSWER });
    yield { type: "done", answer: NO_ANSWER, citations: [], remaining };
    return;
  }

  let text = "";
  try {
    for await (const piece of chat({ messages: buildMessages({ question, passages, history }), signal })) {
      text += piece;
      yield { type: "delta", text: piece };
    }
  } catch (err) {
    if (signal?.aborted) return; // the user pressed stop: nothing to save
    const message = err instanceof ChatServiceError ? err.message : "The answer could not be written. Try again.";
    if (!(err instanceof ChatServiceError)) console.error("Chat failed", err);
    yield { type: "error", message, remaining };
    return;
  }

  text = text.trim();
  // An answer without a citation to a real passage is not grounded, so it is not shown as an answer.
  const citations = isNoAnswer(text) ? [] : citationsFor(text, passages);
  const answer = citations.length > 0 ? text : NO_ANSWER;
  await scope.addMessage({ role: "assistant", content: answer, citations });
  yield { type: "done", answer, citations, remaining };
}

export { QUESTIONS_PER_HOUR };
