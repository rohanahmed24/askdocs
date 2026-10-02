# Design decisions

Short notes on choices that are easy to forget or hard to reverse. Newest at the bottom.

## 1. Stack

Next.js (App Router, TypeScript), Postgres with pgvector, Drizzle ORM, pnpm.
Better Auth, pg-boss, the Vercel AI SDK with Gemini, and Playwright come in later phases.

Drizzle keeps the SQL visible. The schema is plain TypeScript, migrations are plain SQL files in `drizzle/`, and queries that matter (the quota lock, vector search) are written as SQL rather than hidden behind an abstraction.

## 2. Embeddings are 768-dimensional

pgvector indexes (HNSW and IVFFlat) support at most 2000 dimensions, and many embedding models default to more than that. The model is asked for 768-dimensional vectors, and `EMBEDDING_DIMENSIONS` in `src/db/schema.ts` is used for both the model call and the column, so the two cannot drift. A schema test enforces the 2000 limit.

Similarity is cosine distance, indexed with HNSW (`vector_cosine_ops`).

## 3. Every tenant table carries `org_id`

`memberships`, `documents`, `chunks` and `messages` all have a non-null `org_id`. `chunks.org_id` is copied from the document on purpose, so a vector query can filter by organization without a join. A schema test fails if a tenant table loses its `org_id`.

Every query goes through one org-scope helper (Phase 2), and a test proves a user in org A cannot read org B.

## 4. Idempotent ingestion

`chunks` has a unique index on `(document_id, ordinal)`. Running the same ingestion job twice inserts the same rows with `ON CONFLICT DO NOTHING`, so a retry leaves no duplicates.

## 5. Quota counters live on the organization row

`organizations.storage_used_bytes` and `storage_limit_bytes` are updated in a transaction that first locks the row with `SELECT ... FOR UPDATE`. Two concurrent uploads then queue up instead of both passing the check. The concurrency test for this lands with the upload endpoint.

## 6. The queue worker is a separate service

pg-boss needs a process that stays running. Vercel functions do not, so the worker will be its own small Node service (Fly.io, Railway or Render), sharing this repo. The fallback if hosting it costs too much time is a Vercel Cron route that drains the queue in small batches.

## 7. Neon: two connection strings

- `DATABASE_URL`: the pooled string, used by the web app.
- `DATABASE_URL_DIRECT`: the direct string, used by migrations and the worker. The pooler (pgbouncer) breaks advisory locks and LISTEN/NOTIFY, which pg-boss relies on.

Locally both are the same Docker database, and `DATABASE_URL_DIRECT` stays empty.

## 8. Vector search first, hybrid later

The first version retrieves with vectors only. Postgres full-text search is merged in during the hardening phase, after an evaluation script exists, so the README can show the hit rate before and after.

## 9. Auth tables are hand-copied for now

`src/db/auth-schema.ts` follows the Better Auth Drizzle adapter. When auth is wired up, regenerate with the Better Auth CLI and diff against it.
