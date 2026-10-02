import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  halfvec,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

/**
 * Embedding size. It must equal what the embedding model returns: the free
 * OpenRouter models cannot shrink their output. `nvidia/nemotron-3-embed-1b:free`
 * returns 2048 numbers. A plain `vector` column can only be indexed up to 2000
 * dimensions, so the column is a `halfvec` (16-bit numbers), which pgvector can
 * index up to 4000. Change this value, the model and a migration together.
 */
export const EMBEDDING_DIMENSIONS = 2048;

/** Default per-organization upload quota: 50 MB. */
export const DEFAULT_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

export const memberRole = pgEnum("member_role", ["owner", "member"]);
export const documentStatus = pgEnum("document_status", ["queued", "processing", "ready", "failed"]);
export const messageRole = pgEnum("message_role", ["user", "assistant"]);

/** One cited passage of an answer. `text` is a copy of the passage, so it stays readable if the document is deleted. */
export type Citation = {
  /** The number the answer uses for it, as in "[2]". */
  n: number;
  documentId: string;
  chunkId: string;
  filename: string;
  ordinal: number;
  text: string;
  page?: number;
};

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Quota counters. The upload path updates storage_used_bytes inside a
  // transaction that first locks this row (SELECT ... FOR UPDATE).
  storageLimitBytes: bigint("storage_limit_bytes", { mode: "number" }).notNull().default(DEFAULT_STORAGE_LIMIT_BYTES),
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: documentStatus("status").notNull().default("queued"),
    error: text("error"),
    chunkCount: integer("chunk_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("documents_org_created_idx").on(t.orgId, t.createdAt), index("documents_org_status_idx").on(t.orgId, t.status)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * The uploaded bytes, one row per document. Kept out of `documents` so listing
 * documents never reads file contents. Stored in Postgres so the web app and
 * the worker (separate hosts) share files without extra infrastructure.
 */
export const documentFiles = pgTable(
  "document_files",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    data: bytea("data").notNull(),
  },
  (t) => [index("document_files_org_idx").on(t.orgId)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized from documents so every vector query can filter by org
    // without a join.
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    embedding: halfvec("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // One chunk per (document, position): a retried ingestion job cannot insert duplicates.
    uniqueIndex("chunks_document_ordinal_uq").on(t.documentId, t.ordinal),
    index("chunks_org_document_idx").on(t.orgId, t.documentId),
    index("chunks_embedding_hnsw_idx").using("hnsw", t.embedding.op("halfvec_cosine_ops")),
    // Keyword search for hybrid retrieval. `simple` keeps every word as it is, so it works for Bengali as well as
    // English; hyphens and underscores count as spaces, so "E-4021" is found by "4021". The same expression is
    // used by `OrgScope.searchHybrid`, which is what lets Postgres use this index.
    index("chunks_content_fts_idx").using("gin", sql`to_tsvector('simple', translate(${t.content}, '-_', '  '))`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("messages_org_user_created_idx").on(t.orgId, t.userId, t.createdAt)],
);

/**
 * Embeddings of questions already asked, so asking the same question again does
 * not use another request of the free embedding model's small daily allowance.
 * Per organization, like everything else.
 */
export const queryEmbeddings = pgTable(
  "query_embeddings",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    textHash: text("text_hash").notNull(),
    embedding: halfvec("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.model, t.textHash] })],
);
