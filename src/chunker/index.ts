export type ChunkOptions = {
  /** Target chunk size in characters. */
  size?: number;
  /** Characters repeated from the end of one chunk at the start of the next. */
  overlap?: number;
};

/**
 * HAND-WRITTEN PIECE #3: you write this, with its own tests in this folder.
 * It is meant to be published to npm, so it must not import anything from the app.
 * Contract and test cases: docs/phase-2-contracts.md
 *
 * Placeholder so the rest of the app compiles. Ingestion fails until you replace the body.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function chunkText(_text: string, _options: ChunkOptions = {}): string[] {
  throw new Error("Not implemented: write chunkText (see docs/phase-2-contracts.md)");
}
