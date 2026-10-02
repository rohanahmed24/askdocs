import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/server/extract";
import { CLIENT_MAX_UPLOAD_BYTES, checkFileBeforeUpload, fileTypeLabel, formatAdded, needsPolling, toDocumentDto, type DocumentDto } from "./documents-ui";

const doc = (status: DocumentDto["status"]): DocumentDto => ({ id: "1", filename: "a.txt", status, error: null, chunkCount: 0, sizeBytes: 1, createdAt: "2026-10-02T09:00:00.000Z" });

describe("documents screen helpers", () => {
  it("uses the same upload limit as the server", () => {
    expect(CLIENT_MAX_UPLOAD_BYTES).toBe(MAX_UPLOAD_BYTES);
  });

  it("labels file types", () => {
    expect(fileTypeLabel("Report.PDF")).toBe("PDF");
    expect(fileTypeLabel("notes.md")).toBe("MD");
    expect(fileTypeLabel("notes.markdown")).toBe("MD");
    expect(fileTypeLabel("a.b.txt")).toBe("TXT");
    expect(fileTypeLabel("noextension")).toBe("FILE");
  });

  it("polls only while a document is queued or processing", () => {
    expect(needsPolling([doc("ready"), doc("failed")])).toBe(false);
    expect(needsPolling([doc("ready"), doc("queued")])).toBe(true);
    expect(needsPolling([doc("processing")])).toBe(true);
    expect(needsPolling([])).toBe(false);
  });

  it("checks a file before uploading it", () => {
    expect(checkFileBeforeUpload({ name: "a.pdf", size: 100 })).toBeNull();
    expect(checkFileBeforeUpload({ name: "a.PDF", size: 100 })).toBeNull();
    expect(checkFileBeforeUpload({ name: "a.docx", size: 100 })).toMatch(/txt, md or pdf/);
    expect(checkFileBeforeUpload({ name: "a.txt", size: 0 })).toMatch(/empty/);
    expect(checkFileBeforeUpload({ name: "a.txt", size: CLIENT_MAX_UPLOAD_BYTES + 1 })).toMatch(/up to 4 MB/);
    expect(checkFileBeforeUpload({ name: "a.txt", size: CLIENT_MAX_UPLOAD_BYTES })).toBeNull();
  });

  it("prints the added date in UTC", () => {
    expect(formatAdded("2026-10-02T23:30:00.000Z")).toBe("2 Oct");
  });

  it("turns a database row into a plain object with an ISO date", () => {
    const dto = toDocumentDto({ ...doc("ready"), createdAt: new Date("2026-10-02T09:00:00Z") });
    expect(dto.createdAt).toBe("2026-10-02T09:00:00.000Z");
    expect(Object.keys(dto).sort()).toEqual(["chunkCount", "createdAt", "error", "filename", "id", "sizeBytes", "status"]);
  });
});
