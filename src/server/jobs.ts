import { PgBoss } from "pg-boss";
import { INGEST_QUEUE, ingestQueueOptions, type IngestJobData } from "./queues";

// Send-only client for the web app. It does not run maintenance or scheduling
// and does not touch the schema: the worker (worker/index.ts) owns those and
// must have started once so the queues exist.
let bossPromise: Promise<PgBoss> | null = null;

function getBoss() {
  bossPromise ??= (async () => {
    const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    const boss = new PgBoss({ connectionString, max: 1, supervise: false, schedule: false, migrate: false });
    boss.on("error", (err) => console.error("pg-boss (web) error", err));
    await boss.start();
    return boss;
  })();
  return bossPromise;
}

/** Queue a document for indexing. Safe to call more than once for the same document. */
export async function enqueueIngestion(documentId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(INGEST_QUEUE, { documentId } satisfies IngestJobData, ingestQueueOptions);
}
