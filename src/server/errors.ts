/**
 * An ingestion failure that retrying cannot fix (empty file, unreadable PDF).
 * The message is shown to the user, so write it as a sentence that says what to do.
 */
export class PermanentIngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentIngestionError";
  }
}
