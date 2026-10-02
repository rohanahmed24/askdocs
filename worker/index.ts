// The ingestion worker. Run it as its own process: `pnpm worker`.
// It must stay running, which is why it cannot live inside a Vercel function.
import { drizzle } from "drizzle-orm/node-postgres";
import { PgBoss } from "pg-boss";
import { Pool } from "pg";
import { chunkText } from "@/chunker";
import * as schema from "@/db/schema";
import { cleanupDocuments } from "@/server/cleanup";
import { createOpenRouterEmbedder } from "@/server/embeddings";
import { startHealthServer } from "@/server/health";
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

  // Answer HTTP first: a host that sleeps idle web services starts the worker on a request to /health.
  const health = await startHealthServer(Number(process.env.PORT ?? 8080));

  const pool = new Pool({ connectionString, max: 5 });
  const db = drizzle(pool, { schema });
  const embed = createOpenRouterEmbedder({ apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_EMBEDDING_MODEL });

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

  // The web app queues the cleanup once a day (Vercel Cron), which also wakes this worker.
  await boss.work(CLEANUP_QUEUE, async () => {
    const enqueue = async (documentId: string) => {
      await boss.send(INGEST_QUEUE, { documentId } satisfies IngestJobData, ingestQueueOptions);
    };
    console.log("cleanup", await cleanupDocuments(db, { enqueue }));
  });

  console.log("worker ready");

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return; // a second signal must not start a second stop
    shuttingDown = true;
    console.log(`${signal} received, finishing active jobs`);
    await boss.stop({ graceful: true });
    health.close();
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
