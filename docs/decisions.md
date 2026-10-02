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

## 9. Auth: Better Auth with email and password

Better Auth stores users, sessions and accounts in Postgres through its Drizzle adapter, so sessions are database-backed and can be revoked. The tables live in `src/db/auth-schema.ts`.

`src/proxy.ts` only checks that a session cookie exists and redirects to sign-in if not. That is a fast first gate, not a security check. Every protected page re-checks the session on the server (`requireOrg` in `src/server/current-org.ts`), because a cookie can be present and expired or forged.

## 10. One organization per account, for now

Sign-up leads to an onboarding step that creates an organization. The organization and the owner membership are inserted in one transaction, so an organization never exists without an owner (a test forces the second insert to fail and checks nothing is left behind). Slugs are made unique with a short random suffix when the name is taken.

The data model already supports many organizations per user. Only the UI is limited, until an organization switcher is built.

## 11. Uploaded files are stored in Postgres

`document_files` holds the bytes (`bytea`), one row per document, with its own `org_id`. The web app and the worker run on different hosts, and this lets them share files with no object storage to set up. It is fine at 10 MB per file and a 50 MB quota per organization. If volumes grow, move the bytes to object storage and keep only a key in this table.

## 12. How ingestion fails and retries

- The web app saves the file and the document (`queued`), then sends a job. If sending fails, the document stays `queued` and the nightly cleanup queues it again.
- The worker marks the document `processing`, extracts text, chunks it, embeds in batches of 100, and writes all chunks plus the `ready` status in one transaction. Nothing is kept if any step fails.
- A permanent problem (empty file, unreadable PDF) marks the document `failed` with a message for the user and is not retried.
- Anything else (for example the embedding API being down) puts the document back to `queued` and lets pg-boss retry: 3 retries, 30 seconds, doubling each time. After the last retry the document is `failed`.
- Running the same job twice is harmless: a `ready` document is skipped and chunk inserts ignore duplicates.

## 13. Failed documents keep their quota for a week

A failed upload counts against the organization's storage until it is deleted by the user or by the nightly cleanup (7 days). That keeps the quota arithmetic simple: the counter changes only when a document is added or deleted.

## 14. The web app only sends jobs

The web app uses a send-only pg-boss client (no maintenance, no scheduling, no schema changes). The worker owns the schema and creates the queues, so it must have started once before the first upload.

## 15. Upload size on Vercel (decide before deploying)

The upload limit is 10 MB, but Vercel limits a function request body to about 4.5 MB. Before the first deploy, either lower the limit to 4 MB or upload through a different path (for example, direct to the worker host or to object storage with a signed URL).

## 16. Who wrote the org scope, quota and chunker

The plan was for the project owner to write these three pieces by hand and for Claude only to review them. The owner changed that and asked Claude to write them. They are covered by tests that were checked by breaking the code on purpose (removing `FOR UPDATE`, removing the grapheme check). The README's "How I used AI" section should say so plainly.

## 17. Chunker: split at boundaries, never inside a character

Chunks are about 1000 characters with 150 overlap, split at a paragraph, then a sentence, then a word. A split in the middle of a character (an emoji, or a Bengali consonant with its vowel sign) would store a broken string and embed garbage, so cuts are moved to a grapheme boundary. Sizes are counted in UTF-16 code units, not bytes or tokens: simple, and close enough for an embedding model with a large input window.

## 18. Hosting: Neon in Singapore, web on Vercel, worker on Render

- **Database:** one Neon project (`askdocs`, Postgres 17, AWS Singapore). Singapore is the closest region to Bangladesh and has a Render region next to it, so the worker and the database share a region. The web app uses the pooled connection string (`DATABASE_URL`); migrations and the worker use the direct one (`DATABASE_URL_DIRECT`), because pg-boss needs advisory locks that a pooler breaks. Connection strings live in the gitignored `.env.neon`.
- **Migrations** ran against Neon with `pnpm db:migrate`, including the `vector` extension and the HNSW index.
- **Worker host:** a Render free web service that sleeps when idle. See #19.

## 19. The worker sleeps and the web app wakes it

Render has no free always-on background worker, and a free web service sleeps after 15 minutes without inbound traffic and takes about a minute to start. Instead of paying, the worker is a web service that also runs the queue consumer, and the web app wakes it:

- The worker answers `GET /health` (`src/server/health.ts`). A request to it starts a sleeping host.
- After an upload, the upload route pings the worker (`after(() => wakeWorker())`). Jobs are stored in Postgres, so nothing is lost while the worker starts; it takes the job when it is up.
- `GET /api/documents` (the status polling endpoint) pings the worker again if a document has been `queued` or `processing` for over a minute. That covers a ping that did not work, and retries that were due while the worker slept.
- Vercel Hobby only allows a cron once a day, so one daily cron (`/api/cron/daily`, secured with `CRON_SECRET`) queues the nightly cleanup and wakes the worker. The worker no longer has its own `boss.schedule`, because a sleeping process cannot run one.
- Pings from one web instance are at least a minute apart.

Trade-offs: the first document after an idle period waits about a minute in `queued`; the 750 free instance hours are shared with every other free service in the Render workspace (checked on 2 Oct 2026: 0 of 750 used this month, the only existing service is an idle n8n, and no card is on file, so Render cannot bill anything); the cleanup depends on Vercel Cron. If the project outgrows this, run the same worker on an always-on instance. Nothing in the code has to change except removing the ping.

## 20. Embeddings come from free OpenRouter models only

The owner's account balance is low, so the app must never spend money. Embeddings go through OpenRouter's `/embeddings` endpoint with a plain `fetch` (no SDK), and replace the earlier plan to use Gemini.

- **Free only, enforced in code.** The model id must end in `:free`; `createOpenRouterEmbedder` refuses anything else when it starts, and also stops if a response reports a cost above zero. The key should also be created with a credit limit of a cent or two on openrouter.ai, as a second guard.
- **Limits of free models** (OpenRouter docs): 20 requests a minute, and 50 a day on accounts with under 10 credits purchased (1000 a day above that). A balance below zero blocks even free models. One request embeds a whole batch of up to 100 chunks, so ingestion uses few requests, but chat will spend from the same 50: each question needs one embedding call and one chat call, so about 25 questions a day. Plan the evaluation script and demos around that, and cache query embeddings.
- **Vector size is the model's, not ours.** The free embedding models list no supported parameters, so a `dimensions` setting cannot shrink the vector. `EMBEDDING_DIMENSIONS` (and the `chunks.embedding` column) must equal what the chosen model returns. The embedder checks this on every call. `scripts/probe-embeddings.mts` tries the free models once and prints their sizes and whether English and Bengali sentences of the same meaning end up close. pgvector's HNSW index stops at 2000 dimensions.
- **Privacy.** OpenRouter says requests to some free models may be retained and used for training. Use demo documents only, never real client files. The README should say so.
