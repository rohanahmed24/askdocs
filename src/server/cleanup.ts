import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { documents, organizations } from "@/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export const FAILED_RETENTION_DAYS = 7;
export const STALE_QUEUED_MINUTES = 10;

/**
 * Nightly housekeeping.
 *
 * 1. Deletes documents that have been `failed` for more than 7 days. Their
 *    files and chunks go with them (foreign keys cascade), and their bytes are
 *    released from the organization's storage counter.
 * 2. Re-queues documents stuck in `queued` for more than 10 minutes, which
 *    means the job was lost (for example, the upload committed but sending the
 *    job failed). Ingestion is idempotent, so a duplicate job is harmless.
 */
export async function cleanupDocuments(
  db: Db,
  deps: { enqueue: (documentId: string) => Promise<void>; now?: Date },
): Promise<{ deleted: number; requeued: number }> {
  const now = deps.now ?? new Date();

  const deletedRows = await db.transaction(async (tx) => {
    const gone = await tx
      .delete(documents)
      .where(and(eq(documents.status, "failed"), lt(documents.updatedAt, new Date(now.getTime() - FAILED_RETENTION_DAYS * DAY_MS))))
      .returning({ orgId: documents.orgId, sizeBytes: documents.sizeBytes });

    const releasedByOrg = new Map<string, number>();
    for (const row of gone) releasedByOrg.set(row.orgId, (releasedByOrg.get(row.orgId) ?? 0) + row.sizeBytes);
    for (const [orgId, bytes] of releasedByOrg) {
      await tx
        .update(organizations)
        .set({ storageUsedBytes: sql`GREATEST(0, ${organizations.storageUsedBytes} - ${bytes})` })
        .where(eq(organizations.id, orgId));
    }
    return gone;
  });

  const stale = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(inArray(documents.status, ["queued"]), lt(documents.updatedAt, new Date(now.getTime() - STALE_QUEUED_MINUTES * 60_000))))
    .limit(100);
  for (const { id } of stale) await deps.enqueue(id);

  return { deleted: deletedRows.length, requeued: stale.length };
}
