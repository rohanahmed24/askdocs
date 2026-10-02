// The ingestion worker. Run it as its own process: `pnpm worker`.
// It must stay running, which is why it cannot live inside a Vercel function.
import { drizzle } from "drizzle-orm/node-postgres";
import { PgBoss } from "pg-boss";
import { Pool } from "pg";
import { chunkText } from "@/chunker";
import * as schema from "@/db/schema";
import { cleanupDocuments } from "@/server/cleanup";
import { createGeminiEmbedder } from "@/server/embeddings";
import { ingestDocument } from "@/server/ingest";
import {
  CLEANUP_QUEUE,
  INGEST_QUEUE,
  INGEST_RETRY_LIMIT,
  ingestQueueOptions,
  type IngestJobData,
} from "@/server/queues";

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: use the real environment (production).
  }

  // The worker needs the direct connection: a pooler breaks pg-boss locks.
  const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Set DATABASE_URL or DATABASE_URL_DIRECT");

  const pool = new Pool({ connectionString, max: 5 });
  const db = drizzle(pool, { schema });
  const embed = createGeminiEmbedder({ apiKey: process.env.GEMINI_API_KEY });

  const boss = new PgBoss(connectionString);
  boss.on("error", (err) => console.error("pg-boss error", err));
  await boss.start();

  async function ensureQueue(name: string, options?: Parameters<PgBoss["createQueue"]>[1]) {
    if (!(await boss.getQueue(name))) await boss.createQueue(name, options);
  }
  await ensureQueue(INGEST_QUEUE, ingestQueueOptions);
  await ensureQueue(CLEANUP_QUEUE);

  await boss.work<IngestJobData>(INGEST_QUEUE, { localConcurrency: 2 }, async ([job]) => {
    const started = Date.now();
    await ingestDocument(
      db,
      { embed, chunk: (text) => chunkText(text) },
      { documentId: job.data.documentId, isLastAttempt: job.retryCount >= INGEST_RETRY_LIMIT },
    );
    console.log(`ingested ${job.data.documentId} in ${Date.now() - started} ms (attempt ${job.retryCount + 1})`);
  });

  // Every night at 03:00 UTC.
  await boss.schedule(CLEANUP_QUEUE, "0 3 * * *");
  await boss.work(CLEANUP_QUEUE, async () => {
    const enqueue = async (documentId: string) => {
      await boss.send(INGEST_QUEUE, { documentId } satisfies IngestJobData, ingestQueueOptions);
    };
    console.log("cleanup", await cleanupDocuments(db, { enqueue }));
  });

  console.log("worker ready");

  async function shutdown(signal: string) {
    console.log(`${signal} received, finishing active jobs`);
    await boss.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
