// Measures retrieval quality on a small fixed corpus (eval/corpus) and question
// set (eval/questions.json), for vector search alone and for hybrid search.
//
//   pnpm eval
//
// It embeds with the real free model, but caches every vector in
// eval/.embedding-cache.json, so the first run uses 2 of the 50 free requests a
// day and every later run uses none. The model that writes answers is not used.
// It empties the test database first and last.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { chunkText } from "@/chunker";
import { DEFAULT_EMBEDDING_MODEL, createOpenRouterEmbedder, type Embedder } from "@/server/embeddings";
import { createDocument } from "@/server/documents";
import { extractText } from "@/server/extract";
import { ingestDocument } from "@/server/ingest";
import { getOrgScope } from "@/server/org-scope";
import { MIN_SIMILARITY } from "@/server/chat/prompt";
import { reserveStorage } from "@/server/quota";
import { createTestDb } from "@/test/db";
import { seedOrg } from "@/test/factories";

process.loadEnvFile(".env");
const CHUNK_SIZE = Number(process.env.EVAL_CHUNK_SIZE ?? 400);
const CHUNK_OVERLAP = Number(process.env.EVAL_CHUNK_OVERLAP ?? 60);
const CACHE_FILE = "eval/.embedding-cache.json";
const model = process.env.OPENROUTER_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;

type Question = { id: string; kind: string; question: string; expect: string | string[] | null };
const questions = JSON.parse(readFileSync("eval/questions.json", "utf8")) as Question[];
const files = readdirSync("eval/corpus").filter((f) => f.endsWith(".md")).sort();

function withCache(embed: Embedder): Embedder {
  const store: Record<string, number[]> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
  const key = (text: string) => `${model}:${createHash("sha256").update(text).digest("hex")}`;
  let requests = 0;
  const run: Embedder = async (texts) => {
    const missing = [...new Set(texts.filter((t) => !store[key(t)]))];
    for (let i = 0; i < missing.length; i += 100) {
      const batch = missing.slice(i, i + 100);
      const vectors = await embed(batch);
      batch.forEach((text, j) => (store[key(text)] = vectors[j]));
      requests += 1;
    }
    if (missing.length > 0) writeFileSync(CACHE_FILE, JSON.stringify(store));
    return texts.map((t) => store[key(t)]);
  };
  Object.defineProperty(run, "requests", { get: () => requests });
  return run;
}

const apiEmbed = createOpenRouterEmbedder({ apiKey: process.env.OPENROUTER_API_KEY, model });
const embed = withCache(apiEmbed);
const chunk = (text: string) => chunkText(text, { size: CHUNK_SIZE, overlap: CHUNK_OVERLAP });
const norm = (s: string) => s.replace(/\s+/g, " ");

// Embed every chunk and question in one go, so the first run costs two requests.
const documents = await Promise.all(files.map(async (name) => ({ name, data: readFileSync(`eval/corpus/${name}`) })));
const allChunks: string[] = [];
for (const d of documents) {
  const text = await extractText({ filename: d.name, data: d.data });
  allChunks.push(...chunk(text).map((c) => c.trim()).filter(Boolean));
}
await embed(allChunks);
await embed(questions.map((q) => q.question));

const { db, pool } = createTestDb();
await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
const { userId, org } = await seedOrg(db);
for (const d of documents) {
  const created = await createDocument(db, { reserveStorage, enqueue: async () => {} }, { orgId: org.id, userId, filename: d.name, data: d.data });
  if (!created.ok) throw new Error(created.message);
  await ingestDocument(db, { embed, chunk }, { documentId: created.document.id, isLastAttempt: true });
}
const scope = await getOrgScope(db, userId, org.id);
const chunkCount = (await db.execute(sql`SELECT count(*)::int AS n FROM chunks`)).rows[0] as { n: number };

type Method = "vector" | "hybrid-all" | "hybrid-ids";
const METHODS: Method[] = ["vector", "hybrid-all", "hybrid-ids"];
type Run = { rank: number | null; top: number };

async function search(method: Method, text: string, vector: number[], limit: number) {
  if (method === "vector") return scope.searchChunks(vector, { limit });
  return scope.searchHybrid(text, vector, { limit, keywords: method === "hybrid-all" ? "all" : "ids" });
}

async function runMethod(method: Method, q: Question): Promise<Run> {
  const [vector] = await embed([q.question]);
  const hits = await search(method, q.question, vector, 10);
  const accepted = q.expect === null ? [] : [q.expect].flat().map(norm);
  const index = hits.findIndex((h) => accepted.some((a) => norm(h.content).includes(a)));
  // The best vector similarity among the passages: what the "found nothing" threshold looks at.
  const top = hits.reduce((max, h) => Math.max(max, h.similarity), -1);
  return { rank: index === -1 ? null : index + 1, top };
}

// EVAL_SHOW=<question id> prints the top passages of each method for that question.
if (process.env.EVAL_SHOW) {
  const q = questions.find((x) => x.id === process.env.EVAL_SHOW);
  if (q) {
    const [vector] = await embed([q.question]);
    for (const method of METHODS) {
      console.log(`\n${method} top 3 for "${q.question}":`);
      (await search(method, q.question, vector, 3)).forEach((h, i) =>
        console.log(`  ${i + 1}. [${h.filename} #${h.ordinal} sim ${h.similarity.toFixed(3)}] ${norm(h.content).slice(0, 110)}`),
      );
    }
  }
}

const answerable = questions.filter((q) => q.expect);
const unanswerable = questions.filter((q) => !q.expect);
const results = new Map<string, Record<Method, Run>>();
for (const q of questions) {
  results.set(q.id, { vector: await runMethod("vector", q), "hybrid-all": await runMethod("hybrid-all", q), "hybrid-ids": await runMethod("hybrid-ids", q) });
}

function summary(method: Method) {
  const ranks = answerable.map((q) => results.get(q.id)![method].rank);
  const at = (k: number) => ranks.filter((r) => r !== null && r <= k).length;
  const mrr = ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length;
  return { hit1: at(1), hit3: at(3), hit5: at(5), mrr };
}
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const rankText = (r: number | null) => (r === null ? "miss" : String(r));

console.log(`\nCorpus: ${files.length} documents, ${chunkCount.n} chunks (size ${CHUNK_SIZE}, overlap ${CHUNK_OVERLAP}). Model: ${model}`);
console.log(`Embedding requests used this run: ${(embed as unknown as { requests: number }).requests}\n`);
console.log(`${pad("question", 13)}${pad("kind", 16)}${pad("vector", 8)}${pad("hybrid-all", 12)}hybrid-ids   (rank of a passage holding the answer; miss = not in top 10)`);
for (const q of answerable) {
  const r = results.get(q.id)!;
  console.log(`${pad(q.id, 13)}${pad(q.kind, 16)}${pad(rankText(r.vector.rank), 8)}${pad(rankText(r["hybrid-all"].rank), 12)}${rankText(r["hybrid-ids"].rank)}`);
}
console.log(`\n${pad("", 12)}${pad("hit@1", 8)}${pad("hit@3", 8)}${pad("hit@5", 8)}MRR   (out of ${answerable.length})`);
for (const method of METHODS) {
  const s = summary(method);
  console.log(`${pad(method, 12)}${pad(s.hit1, 8)}${pad(s.hit3, 8)}${pad(s.hit5, 8)}${s.mrr.toFixed(3)}`);
}

console.log(`\nQuestions the documents cannot answer (a passage at or above similarity ${MIN_SIMILARITY} would make the model get called):`);
for (const q of unanswerable) {
  const r = results.get(q.id)!;
  console.log(`${pad(q.id, 13)}best similarity ${r.vector.top.toFixed(3)} ${r.vector.top >= MIN_SIMILARITY ? "-> would call the model" : "-> no model call"}`);
}
const lowestAnswerable = Math.min(...answerable.map((q) => results.get(q.id)!.vector.top));
const highestUnanswerable = Math.max(...unanswerable.map((q) => results.get(q.id)!.vector.top));
console.log(`\nLowest best-similarity of an answerable question: ${lowestAnswerable.toFixed(3)}. Highest for an unanswerable one: ${highestUnanswerable.toFixed(3)}.`);

await db.execute(sql`TRUNCATE TABLE organizations, "user" CASCADE`);
await pool.end();
