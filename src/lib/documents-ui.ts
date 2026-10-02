// Pieces of the documents screen that do not need React, so they can be tested.
// This file is imported by client components: it must not import server code.
import { formatBytes } from "./format";

export type DocumentStatus = "queued" | "processing" | "ready" | "failed";

/** A document as the API sends it and the screen shows it. */
export type DocumentDto = {
  id: string;
  filename: string;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  sizeBytes: number;
  createdAt: string;
};

export function toDocumentDto(row: {
  id: string;
  filename: string;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  sizeBytes: number;
  createdAt: Date;
}): DocumentDto {
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    error: row.error,
    chunkCount: row.chunkCount,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Same limit as the server (`MAX_UPLOAD_BYTES` in src/server/extract.ts). A test keeps the two equal. */
export const CLIENT_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The sentence shown when a file is over the limit. */
export const TOO_LARGE_MESSAGE = `Each file can be up to ${formatBytes(CLIENT_MAX_UPLOAD_BYTES)}. Compress the file or split it.`;

export const ACCEPTED_EXTENSIONS = [".txt", ".md", ".markdown", ".pdf"] as const;

/** "PDF", "MD" or "TXT", for the small badge next to a file name. */
export function fileTypeLabel(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "pdf") return "PDF";
  if (ext === "md" || ext === "markdown") return "MD";
  if (ext === "txt") return "TXT";
  return "FILE";
}

/** A document still waiting for or going through indexing. */
export function isWorking(status: DocumentStatus): boolean {
  return status === "queued" || status === "processing";
}

/** The list is polled only while something is still being indexed. */
export function needsPolling(docs: DocumentDto[]): boolean {
  return docs.some((d) => isWorking(d.status));
}

/** A message for a file that cannot be uploaded, or null. Checked before the upload starts. */
export function checkFileBeforeUpload(file: { name: string; size: number }): string | null {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "Upload a txt, md or pdf file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > CLIENT_MAX_UPLOAD_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2 Oct". Always in UTC, so the server and the browser print the same text. */
export function formatAdded(iso: string): string {
  return dayMonth.format(new Date(iso));
}

export const statusLabels: Record<DocumentStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};
