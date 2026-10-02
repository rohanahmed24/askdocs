// Splits plain text into overlapping chunks for embedding.
// This folder imports nothing from the app, so it can be published on its own.

export type ChunkOptions = {
  /** Target chunk size in characters (UTF-16 code units). Default 1000. */
  size?: number;
  /** Characters repeated from the end of one chunk at the start of the next. Default 15% of `size`, at most 150. */
  overlap?: number;
};

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 150;

// Sentence end: . ! ? … or the Bengali/Devanagari danda, optional closing quotes or brackets, then whitespace.
const PARAGRAPH_BREAK = /\r?\n[ \t]*\r?\n/g;
const SENTENCE_BREAK = /[.!?…।॥]["'”’)\]]*\s/g;
const WORD_BREAK = /\s/g;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Splits `text` into chunks of at most about `size` characters, in reading order.
 * Each chunk starts about `overlap` characters before the previous one ended,
 * so a sentence cut by a boundary still appears whole in one of the two chunks.
 *
 * Breaks are placed at the last paragraph break that fits, else the last
 * sentence end, else the last space. A word longer than `size` is cut anyway.
 * A cut never splits a character in half (emoji, combining marks, Bengali conjuncts).
 *
 * Chunks are exact slices of the input. Whitespace-only text gives no chunks.
 * Throws `RangeError` when `size` or `overlap` is invalid.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const size = options.size ?? DEFAULT_CHUNK_SIZE;
  // A small `size` alone must not fail because of the default overlap.
  const overlap = options.overlap ?? Math.min(DEFAULT_CHUNK_OVERLAP, Math.floor(size * 0.15));
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  if (!Number.isInteger(overlap) || overlap < 0) throw new RangeError(`chunk overlap must be a non-negative integer, got ${overlap}`);
  if (overlap >= size) throw new RangeError(`chunk overlap (${overlap}) must be smaller than chunk size (${size})`);

  if (text.trim() === "") return [];
  if (text.length <= size) return [text];

  // A chunk must reach past the overlap, or the next chunk would start where this one did.
  // Aiming for at least half the size also keeps chunks from shrinking when a break is early.
  const minLength = Math.max(overlap + 1, Math.ceil(size / 2));

  const chunks: string[] = [];
  let start = 0;
  while (true) {
    if (text.length - start <= size) {
      chunks.push(text.slice(start));
      return chunks;
    }

    const limit = start + size;
    const end = findBreak(text, start + minLength, limit) ?? snapToGrapheme(text, limit, start + overlap + 1);
    chunks.push(text.slice(start, end));
    start = nextStart(text, end, end - overlap);
  }
}

/** The end of the last paragraph, sentence or word break inside [from, to], or null. */
function findBreak(text: string, from: number, to: number): number | null {
  const window = text.slice(from, to);
  for (const pattern of [PARAGRAPH_BREAK, SENTENCE_BREAK, WORD_BREAK]) {
    let last: RegExpExecArray | undefined;
    for (const match of window.matchAll(pattern)) last = match;
    if (last) return from + last.index + last[0].length;
  }
  return null;
}

/**
 * Where the next chunk starts: `wanted` (the end minus the overlap), moved
 * forward to a whole character and, when it falls inside a word, to the start
 * of the next word, so chunks do not begin mid-word. Never moves past `end`.
 */
function nextStart(text: string, end: number, wanted: number): number {
  let pos = wanted;
  while (pos < end && !isGraphemeBoundary(text, pos)) pos++;
  if (pos > 0 && pos < end && !/\s/.test(text[pos - 1]) && !/\s/.test(text[pos])) {
    const space = text.slice(pos, end).search(/\s/);
    if (space !== -1) pos += space + 1;
  }
  return pos;
}

/** Moves `pos` back to a whole-character boundary (not below `min`), else forward to the next one. */
function snapToGrapheme(text: string, pos: number, min: number): number {
  let back = pos;
  while (back > min && !isGraphemeBoundary(text, back)) back--;
  if (isGraphemeBoundary(text, back)) return back;
  let forward = pos;
  while (forward < text.length && !isGraphemeBoundary(text, forward)) forward++;
  return forward;
}

/** True when `pos` does not fall inside a user-perceived character. Looks at a small window only. */
function isGraphemeBoundary(text: string, pos: number): boolean {
  if (pos <= 0 || pos >= text.length) return true;
  const from = Math.max(0, pos - 64);
  const to = Math.min(text.length, pos + 64);
  for (const { index } of graphemes.segment(text.slice(from, to))) {
    if (from + index === pos) return true;
    if (from + index > pos) return false;
  }
  return false;
}
