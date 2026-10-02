import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { PermanentIngestionError } from "./errors";

export type FileKind = "text" | "markdown" | "pdf";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const byExtension: Record<string, FileKind> = {
  ".txt": "text",
  ".md": "markdown",
  ".markdown": "markdown",
  ".pdf": "pdf",
};

/** Browsers report odd MIME types for .md files, so the extension decides. */
export function detectKind(filename: string): FileKind | null {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return null;
  return byExtension[filename.slice(dot).toLowerCase()] ?? null;
}

export async function extractText(input: { filename: string; data: Uint8Array }): Promise<string> {
  const kind = detectKind(input.filename);
  if (!kind) throw new PermanentIngestionError("This file type is not supported. Upload a txt, md or pdf file.");

  const text = kind === "pdf" ? await readPdf(input.data) : readPlainText(input.data);
  const cleaned = text.replace(/\r\n?/g, "\n").trim();
  if (!cleaned) {
    throw new PermanentIngestionError(
      kind === "pdf" ? "No text found in this file. Upload a text-based PDF." : "This file is empty.",
    );
  }
  return cleaned;
}

function readPlainText(data: Uint8Array): string {
  // A NUL byte means binary data renamed to .txt.
  if (data.includes(0)) throw new PermanentIngestionError("This file does not look like text. Upload a txt or md file.");
  return new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
}

async function readPdf(data: Uint8Array): Promise<string> {
  try {
    // unpdf transfers the buffer to its parser, so give it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  } catch {
    throw new PermanentIngestionError("This PDF could not be read. It may be damaged or password protected.");
  }
}
