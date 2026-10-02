import { describe, expect, it } from "vitest";
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE, chunkText } from "./index";

/**
 * Finds where each chunk sits in the text. Chunks are exact slices, so each one
 * must be found at or after the previous start. Returns [start, end) pairs.
 */
function locate(text: string, chunks: string[]): [number, number][] {
  const spans: [number, number][] = [];
  let from = 0;
  for (const chunk of chunks) {
    const start = text.indexOf(chunk, from);
    expect(start, `chunk not found in order: ${JSON.stringify(chunk.slice(0, 40))}`).toBeGreaterThanOrEqual(0);
    spans.push([start, start + chunk.length]);
    from = start + 1;
  }
  return spans;
}

/** Joins chunks back into the text, dropping each chunk's overlap with the previous one. */
function rebuild(text: string, chunks: string[]): string {
  const spans = locate(text, chunks);
  let out = chunks[0];
  for (let i = 1; i < chunks.length; i++) {
    const [start, end] = spans[i];
    const covered = spans[i - 1][1];
    expect(start, "gap between chunks").toBeLessThanOrEqual(covered);
    out += chunks[i].slice(covered - start);
    expect(end).toBeGreaterThan(covered);
  }
  return out;
}

/** Deterministic pseudo-random picks from `pool`, so every part of the text is unique. */
function randomRun(pool: string[], n: number): string {
  let seed = 12345;
  let out = "";
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    // The low bits of this generator repeat quickly, so use the high bits.
    out += pool[Math.floor(seed / 65536) % pool.length];
  }
  return out;
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const sentences = (n: number) => Array.from({ length: n }, (_, i) => `This is sentence number ${i}.`).join(" ");

describe("chunkText", () => {
  it("uses 1000 characters and 150 overlap by default", () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(1000);
    expect(DEFAULT_CHUNK_OVERLAP).toBe(150);
  });

  it("scales the default overlap down for a small size", () => {
    const text = words(300);
    const chunks = chunkText(text, { size: 100 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("returns one chunk equal to the text when it is shorter than size", () => {
    expect(chunkText("Hello world.", { size: 100 })).toEqual(["Hello world."]);
    const exact = "x".repeat(100);
    expect(chunkText(exact, { size: 100, overlap: 10 })).toEqual([exact]);
  });

  it("returns no chunks for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("  \n\n \t ")).toEqual([]);
    expect(chunkText(" ".repeat(5000))).toEqual([]);
  });

  it("covers all the text and loses nothing", () => {
    const text = words(600);
    const chunks = chunkText(text, { size: 200, overlap: 40 });

    expect(chunks.length).toBeGreaterThan(5);
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("starts each chunk about `overlap` characters before the previous one ended", () => {
    const text = words(600);
    const overlap = 40;
    const chunks = chunkText(text, { size: 200, overlap });
    const spans = locate(text, chunks);

    for (let i = 1; i < spans.length; i++) {
      const shared = spans[i - 1][1] - spans[i][0];
      expect(shared).toBeGreaterThan(0);
      // Starts are moved to a word boundary, so the overlap is a little under the request, never over.
      expect(shared).toBeLessThanOrEqual(overlap);
      expect(shared).toBeGreaterThan(overlap - 15);
    }
  });

  it("gives chunks that are never empty and not longer than size", () => {
    const text = sentences(300);
    for (const chunk of chunkText(text, { size: 300, overlap: 50 })) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length).toBeLessThanOrEqual(300);
    }
  });

  it("prefers a paragraph break over a sentence break", () => {
    const first = `${"a".repeat(150)}. ${"b".repeat(100)}.`;
    const text = `${first}\n\n${"c".repeat(150)}. ${"d".repeat(150)}.`;
    const [chunk] = chunkText(text, { size: 300, overlap: 20 });

    expect(chunk).toBe(`${first}\n\n`);
  });

  it("prefers a sentence end over a word break", () => {
    const text = `${"word ".repeat(30)}Done. ${"more ".repeat(60)}`;
    const [chunk] = chunkText(text, { size: 200, overlap: 20 });

    expect(chunk.endsWith("Done. ")).toBe(true);
  });

  it("breaks on the Bengali danda like a full stop", () => {
    const text = `${"আমি ভাত খাই ".repeat(12)}শেষ। ${"তুমি চা খাও ".repeat(30)}`;
    const [chunk] = chunkText(text, { size: 170, overlap: 20 });

    expect(chunk.endsWith("শেষ। ")).toBe(true);
  });

  it("breaks between words when there is no sentence end, and never inside a word", () => {
    const text = words(300);
    const chunks = chunkText(text, { size: 100, overlap: 20 });
    const vocabulary = new Set(text.split(" "));

    for (const chunk of chunks) {
      // The first and last word of a chunk may only be whole words from the text.
      const parts = chunk.trim().split(/\s+/);
      expect(vocabulary.has(parts[0])).toBe(true);
      expect(vocabulary.has(parts[parts.length - 1])).toBe(true);
    }
  });

  it("still splits a single word longer than size", () => {
    const text = randomRun([..."abcdefghijklmnopqrstuvwxyz"], 2500);
    const chunks = chunkText(text, { size: 1000, overlap: 100 });

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1000);
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("does not cut emoji in half", () => {
    // Every emoji is 2 UTF-16 units and there are no spaces, so every cut is a hard cut.
    const text = randomRun(["😀", "🎉", "🚀", "🌍", "🔥", "🍕", "🐍", "🎲"], 600);
    const chunks = chunkText(text, { size: 101, overlap: 11 });

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.toWellFormed());
      expect(chunk.length % 2).toBe(0);
    }
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("does not cut Bengali characters apart from their vowel signs and conjuncts", () => {
    // No spaces, so every cut is a hard cut. Each unit is several code points (consonant, virama, vowel sign).
    const units = ["ক্ষি", "স্তো", "ন্দ্র", "ব্যা", "র্ক", "ত্রী", "ঙ্গ", "ম্পু"];
    const text = randomRun(units, 300);
    const chunks = chunkText(text, { size: 99, overlap: 10 });
    const segment = new Intl.Segmenter("bn", { granularity: "grapheme" });
    const wholeUnits = new Set(units.flatMap((u) => [...segment.segment(u)].map((g) => g.segment)));

    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      // Every character in the chunk is a whole character from the text, never a lone mark.
      for (const { segment: g } of segment.segment(chunk)) expect(wholeUnits.has(g)).toBe(true);
    }
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("works on text with Windows line endings", () => {
    const text = `${sentences(10)}\r\n\r\n${sentences(10)}\r\n\r\n${sentences(10)}`;
    const chunks = chunkText(text, { size: 300, overlap: 30 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("works with zero overlap", () => {
    const text = words(300);
    const chunks = chunkText(text, { size: 100, overlap: 0 });
    const spans = locate(text, chunks);

    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBe(spans[i - 1][1]);
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("always makes progress, even with a tiny size", () => {
    const text = "abc def ghi jkl mno pqr";
    const chunks = chunkText(text, { size: 3, overlap: 2 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("is deterministic", () => {
    const text = sentences(200);
    expect(chunkText(text, { size: 250, overlap: 40 })).toEqual(chunkText(text, { size: 250, overlap: 40 }));
  });

  it("handles a long document quickly", () => {
    const text = sentences(40_000); // about 1 MB
    const started = performance.now();
    const chunks = chunkText(text);

    expect(performance.now() - started).toBeLessThan(2000);
    expect(rebuild(text, chunks)).toBe(text);
  });

  it("rejects overlap that is not smaller than size", () => {
    expect(() => chunkText("hello", { size: 100, overlap: 100 })).toThrow(RangeError);
    expect(() => chunkText("hello", { size: 100, overlap: 150 })).toThrow(/smaller than/);
  });

  it("rejects invalid size and overlap values, even for short text", () => {
    expect(() => chunkText("hello", { size: 0 })).toThrow(RangeError);
    expect(() => chunkText("hello", { size: 1.5 })).toThrow(RangeError);
    expect(() => chunkText("hello", { size: 100, overlap: -1 })).toThrow(RangeError);
    expect(() => chunkText("hello", { size: Number.NaN })).toThrow(RangeError);
  });
});
