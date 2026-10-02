import type { Db } from "@/db";
import { documentFiles, documents } from "@/db/schema";
import { formatBytes } from "@/lib/format";
import { QuotaExceededError, type ReserveStorage } from "./contracts";
import { MAX_UPLOAD_BYTES, detectKind, type FileKind } from "./extract";

export type CreateDocumentInput = { orgId: string; userId: string; filename: string; data: Uint8Array };

export type CreateDocumentDeps = {
  /** Hand-written piece #2. Called inside the transaction. */
  reserveStorage: ReserveStorage;
  /** Queues the indexing job. Called after the transaction commits. */
  enqueue: (documentId: string) => Promise<void>;
};

export type CreateDocumentResult =
  | { ok: true; document: typeof documents.$inferSelect }
  | { ok: false; reason: "unsupported_type" | "empty" | "too_large" | "quota"; message: string };

const contentTypes: Record<FileKind, string> = {
  text: "text/plain",
  markdown: "text/markdown",
  pdf: "application/pdf",
};

/** Keeps only the file name: no folders, no control characters, at most 255 characters. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(-255);
  return cleaned || "untitled";
}

/**
 * Validates an upload, reserves quota, stores the file and queues indexing.
 *
 * Quota reservation, the document row and the file row commit together: if any
 * of them fails, nothing is kept and no quota is used. The job is queued after
 * the commit. If queueing fails the document stays `queued` and the nightly
 * cleanup queues it again.
 *
 * The caller must already have checked that the user belongs to `orgId`.
 */
export async function createDocument(db: Db, deps: CreateDocumentDeps, input: CreateDocumentInput): Promise<CreateDocumentResult> {
  const filename = sanitizeFilename(input.filename);
  const kind = detectKind(filename);
  if (!kind) return { ok: false, reason: "unsupported_type", message: "Upload a txt, md or pdf file." };

  const size = input.data.byteLength;
  if (size === 0) return { ok: false, reason: "empty", message: "That file is empty." };
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "too_large", message: `Each file can be up to ${formatBytes(MAX_UPLOAD_BYTES)}. Compress the file or split it.` };
  }

  let document: typeof documents.$inferSelect;
  try {
    document = await db.transaction(async (tx) => {
      await deps.reserveStorage(tx, input.orgId, size);
      const [doc] = await tx
        .insert(documents)
        .values({ orgId: input.orgId, uploadedBy: input.userId, filename, contentType: contentTypes[kind], sizeBytes: size })
        .returning();
      await tx.insert(documentFiles).values({ documentId: doc.id, orgId: input.orgId, data: Buffer.from(input.data) });
      return doc;
    });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return {
        ok: false,
        reason: "quota",
        message: `You have used ${formatBytes(err.usedBytes)} of ${formatBytes(err.limitBytes)}. Delete a document, or ask an owner to raise the limit.`,
      };
    }
    throw err;
  }

  try {
    await deps.enqueue(document.id);
  } catch (err) {
    console.error("Could not queue indexing; the nightly cleanup will retry", err);
  }
  return { ok: true, document };
}
