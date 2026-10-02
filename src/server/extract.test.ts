import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PermanentIngestionError } from "./errors";
import { detectKind, extractText } from "./extract";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url)));
const bytes = (s: string) => new TextEncoder().encode(s);

describe("detectKind", () => {
  it("decides by extension, ignoring case", () => {
    expect(detectKind("notes.TXT")).toBe("text");
    expect(detectKind("readme.md")).toBe("markdown");
    expect(detectKind("readme.markdown")).toBe("markdown");
    expect(detectKind("contract.PDF")).toBe("pdf");
  });

  it("returns null for other types and names without an extension", () => {
    expect(detectKind("photo.png")).toBeNull();
    expect(detectKind("README")).toBeNull();
  });
});

describe("extractText", () => {
  it("decodes text, drops a BOM and normalizes line endings", async () => {
    const data = bytes("﻿Line one\r\nLine two\r\n");
    await expect(extractText({ filename: "a.txt", data })).resolves.toBe("Line one\nLine two");
  });

  it("reads markdown as plain text", async () => {
    await expect(extractText({ filename: "a.md", data: bytes("# Title\n\nBody") })).resolves.toBe("# Title\n\nBody");
  });

  it("reads the text of a PDF", async () => {
    const text = await extractText({ filename: "hello.pdf", data: fixture("hello.pdf") });
    expect(text).toContain("Hello AskDocs");
  });

  it("does not reuse or detach the caller's buffer", async () => {
    const data = fixture("hello.pdf");
    await extractText({ filename: "hello.pdf", data });
    expect(data.byteLength).toBeGreaterThan(0);
  });

  it.each([
    ["an unsupported type", "photo.png", bytes("x"), /not supported/],
    ["an empty text file", "a.txt", bytes("  \n "), /empty/],
    ["binary data named .txt", "a.txt", new Uint8Array([72, 0, 105]), /does not look like text/],
    ["a PDF with no text", "scan.pdf", fixture("no-text.pdf"), /No text found/],
    ["bytes that are not a PDF", "bad.pdf", bytes("not a pdf"), /could not be read/],
  ])("rejects %s with a message for the user", async (_label, filename, data, message) => {
    const err = await extractText({ filename, data }).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentIngestionError);
    expect((err as Error).message).toMatch(message);
  });
});
