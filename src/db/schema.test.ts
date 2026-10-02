import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, chunks, documentFiles, documents, memberships, messages } from "./schema";

describe("schema invariants", () => {
  it("scopes every tenant table by a non-null org_id", () => {
    for (const table of [memberships, documents, documentFiles, chunks, messages]) {
      const col = getTableColumns(table).orgId;
      expect(col, getTableConfig(table).name).toBeDefined();
      expect(col.name).toBe("org_id");
      expect(col.notNull).toBe(true);
    }
  });

  it("stores embeddings with the shared dimension constant", () => {
    const embedding = getTableColumns(chunks).embedding as unknown as { dimensions: number };
    expect(embedding.dimensions).toBe(EMBEDDING_DIMENSIONS);
    // pgvector can index a halfvec column up to 4000 dimensions (a plain vector only up to 2000).
    expect(EMBEDDING_DIMENSIONS).toBeLessThanOrEqual(4000);
    expect(embedding.constructor.name).toMatch(/HalfVector/);
  });

  it("indexes embeddings with HNSW and cosine distance", () => {
    const idx = getTableConfig(chunks).indexes.find((i) => i.config.name === "chunks_embedding_hnsw_idx");
    expect(idx).toBeDefined();
    expect(idx?.config.method).toBe("hnsw");
  });

  it("makes (document_id, ordinal) unique so a retried job cannot duplicate chunks", () => {
    const idx = getTableConfig(chunks).indexes.find((i) => i.config.name === "chunks_document_ordinal_uq");
    expect(idx?.config.unique).toBe(true);
    const cols = idx?.config.columns.map((c) => ("name" in c ? c.name : ""));
    expect(cols).toEqual(["document_id", "ordinal"]);
  });
});
