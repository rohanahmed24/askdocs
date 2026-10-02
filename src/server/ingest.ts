import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { chunks, documentFiles, documents } from "@/db/schema";
import type { Chunker } from "./contracts";
import type { Embedder } from "./embeddings";
import { PermanentIngestionError } from "./errors";
import { extractText } from "./extract";

export const EMBED_BATCH_SIZE = 100;
const INSERT_BATCH_SIZE = 200;

export type IngestDeps = { embed: Embedder; chunk: Chunker };

/**
 * Turns an uploaded file into searchable chunks.
 *
 * Safe to run twice: a document that is already `ready` is skipped, and chunk
 * inserts ignore (document_id, ordinal) conflicts.
 *
 * Failure handling:
 * - A permanent error (empty file, unreadable PDF) marks the document `failed`
 *   with a message for the user and returns, so the queue does not retry.
 * - Any other error puts the document back to `queued` and rethrows, so the
 *   queue retries with backoff. On the last attempt the document is marked
 *   `failed` and the error is rethrown.
 */
export async function ingestDocument(
  db: Db,
  deps: IngestDeps,
  input: { documentId: string; isLastAttempt: boolean },
): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, input.documentId));
  if (!doc || doc.status === "ready") return;

  await db.update(documents).set({ status: "processing", error: null }).where(eq(documents.id, doc.id));

  try {
    const [file] = await db.select().from(documentFiles).where(eq(documentFiles.documentId, doc.id));
    if (!file) throw new PermanentIngestionError("The uploaded file is missing. Upload it again.");

    const text = await extractText({ filename: doc.filename, data: file.data });
    const pieces = deps.chunk(text)
      .map((p) => p.trim())
      .filter(Boolean);
    if (pieces.length === 0) throw new PermanentIngestionError("No text found in this file.");

    const vectors: number[][] = [];
    for (let i = 0; i < pieces.length; i += EMBED_BATCH_SIZE) {
      vectors.push(...(await deps.embed(pieces.slice(i, i + EMBED_BATCH_SIZE))));
    }
    if (vectors.length !== pieces.length) throw new Error("Embedder returned the wrong number of vectors");

    // All chunks and the status change commit together.
    await db.transaction(async (tx) => {
      for (let i = 0; i < pieces.length; i += INSERT_BATCH_SIZE) {
        await tx
          .insert(chunks)
          .values(
            pieces.slice(i, i + INSERT_BATCH_SIZE).map((content, j) => ({
              orgId: doc.orgId,
              documentId: doc.id,
              ordinal: i + j,
              content,
              embedding: vectors[i + j],
            })),
          )
          .onConflictDoNothing({ target: [chunks.documentId, chunks.ordinal] });
      }
      await tx.update(documents).set({ status: "ready", error: null, chunkCount: pieces.length }).where(eq(documents.id, doc.id));
    });
  } catch (err) {
    if (err instanceof PermanentIngestionError) {
      await markFailed(db, doc.id, err.message);
      return;
    }
    if (input.isLastAttempt) {
      await markFailed(db, doc.id, "Indexing failed. Try again later.");
    } else {
      await db.update(documents).set({ status: "queued" }).where(eq(documents.id, doc.id));
    }
    throw err;
  }
}

async function markFailed(db: Db, documentId: string, message: string) {
  await db.update(documents).set({ status: "failed", error: message }).where(eq(documents.id, documentId));
}
