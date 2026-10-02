export const INGEST_QUEUE = "ingest-document";
export const CLEANUP_QUEUE = "cleanup-documents";

export type IngestJobData = { documentId: string };

/** Retries after the first attempt. The handler marks the document failed on the last one. */
export const INGEST_RETRY_LIMIT = 3;

export const ingestQueueOptions = {
  retryLimit: INGEST_RETRY_LIMIT,
  retryDelay: 30, // seconds, doubled each retry
  retryBackoff: true,
  expireInSeconds: 15 * 60,
} as const;
