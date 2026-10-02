# Design decisions

Short notes on choices that are easy to forget or hard to reverse. Newest at the bottom.

## 1. Stack

Next.js (App Router, TypeScript), Postgres with pgvector, Drizzle ORM, pnpm.
Better Auth, pg-boss, the Vercel AI SDK with Gemini, and Playwright come in later phases.

Drizzle keeps the SQL visible. The schema is plain TypeScript, migrations are plain SQL files in `drizzle/`, and queries that matter (the quota lock, vector search) are written as SQL rather than hidden behind an abstraction.

## 2. Embeddings are 768-dimensional (superseded by #21)

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

`document_files` holds the bytes (`bytea`), one row per document, with its own `org_id`. The web app and the worker run on different hosts, and this lets them share files with no object storage to set up. It is fine at 4 MB per file and a 50 MB quota per organization. If volumes grow, move the bytes to object storage and keep only a key in this table.

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

## 15. Upload limit is 4 MB, because of Vercel

Vercel rejects a function request body over about 4.5 MB (error 413 `FUNCTION_PAYLOAD_TOO_LARGE`, checked in its docs on 2 Oct 2026), and the upload goes through a route handler. The limit was 10 MB; it is now 4 MB (`MAX_UPLOAD_BYTES`, with the same value in `CLIENT_MAX_UPLOAD_BYTES` and a test that keeps them equal), which leaves room for the multipart envelope. The 50 MB quota per organization is unchanged.

The alternatives were all more work for a demo: sending the file in 4 MB pieces and joining them on the server, uploading straight to the worker host (which has no body limit but no login either), or Vercel Blob with signed uploads (an extra service and token). If real users need larger files, chunked upload is the next step. The client checks the size before sending and says so in a sentence; a 413 from Vercel itself is shown with the same sentence.

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

## 21. Embeddings are 2048-dimensional halfvec, from nemotron-3-embed-1b

Probe results (2 Oct 2026, one request per model, cost 0 each). Cosine similarity of the same sentence in English and Bengali, against an unrelated sentence:

| Free model | Size | EN vs BN, same meaning | EN vs unrelated |
| --- | --- | --- | --- |
| `nvidia/nemotron-3-embed-1b:free` | 2048 | 0.717 | 0.069 |
| `liquid/lfm-2.5-embedding-350m:free` | 1024 | 0.123 | 0.065 |
| `nvidia/llama-nemotron-embed-vl-1b-v2:free` | 2048 | 0.300 | 0.062 |

Nemotron 3 Embed is the only one that places Bengali and English close together, so it is the default. Its vectors have 2048 numbers, above the 2000 limit of an indexed `vector` column, so `chunks.embedding` is now `halfvec(2048)` (16-bit numbers; pgvector 0.8 indexes halfvec up to 4000 dimensions) with an HNSW `halfvec_cosine_ops` index. Half precision loses a little accuracy, which does not matter for ranking passages. A batch of 100 chunks works in one request (about 3 seconds).

Migration `0004` deletes existing chunks and queues `ready` documents again, because vectors of another size cannot be converted. It ran on the local, test and Neon databases, none of which held real data.

End to end check with the real model (`pnpm smoke:embeddings`): an English question finds the English payment-terms passage, a Bengali question finds the Bengali passage first and the English one second, and an unrelated question finds the outage-policy passage.

## 22. The documents screen polls; it does not stream

While any document is `queued` or `processing`, the page asks `GET /api/documents` every 3 seconds (not while the tab is hidden), and stops when everything is `ready` or `failed`. The API route is also what wakes a sleeping worker (#19). A push channel (server-sent events or WebSockets) would need a long-lived connection, which serverless functions on a free plan handle badly, and polling a small list is cheap. When a document finishes, a screen reader announcement says so.

Other choices on that screen: the table layout of the design needs about 900 px of content width, so it is shown from the `xl` breakpoint (1280 px); below that the list is cards, which also match the phone design. Deleting asks for confirmation inline instead of with a browser dialog. Members can delete only their own uploads; owners can delete any (`OrgScope.deleteDocument`). A failed document has a retry button (`POST /api/documents/[id]/retry`, `OrgScope.retryDocument`), which matters because free embedding models allow only 50 requests a day: a document that failed on a rate limit can be tried again later without uploading it again.

## 23. How chat answers a question

1. **Rate limit first.** 20 questions per user per hour, counted from the saved questions (so a question that failed still counts, which protects the free request allowance). The sentence says how many minutes are left.
2. **Embed the question**, reusing a saved vector when the same question (ignoring case and spacing) was asked before in this organization (`query_embeddings`). Each question otherwise costs one free request, and the model call costs another.
3. **Search only this organization.** `OrgScope.searchChunks` puts the organization filter inside the query and sets pgvector's `hnsw.iterative_scan`, so a small organization still gets its passages when another one has many closer ones (a test with 250 closer foreign chunks covers it). Only `ready` documents are searched. The six best passages above a cosine similarity of 0.25 are used; the threshold comes from the probe numbers (related text 0.46 to 0.63, unrelated about 0.06) and will be tuned by the evaluation script.
4. **No close passage means no model call.** The answer is the fixed sentence "I could not find that in your documents." and one free request is saved.
5. **The model answers from numbered passages only**, in the language of the question, citing `[n]`. Passage text is neutralized (it cannot close its own tag), the system prompt says passages are untrusted, and the probe showed an injected instruction inside a passage being ignored. History is the last two turns, without their old citation numbers.
6. **An answer must cite a real passage.** Citations are read from the answer text; numbers with no passage are ignored. An answer with none is replaced by the no-answer sentence, because an uncited answer is not grounded.
7. **Free models only, with fallback.** `OPENROUTER_CHAT_MODELS` (default: Nemotron 3 Super, Gemma 4 31B, Qwen 3.8 27B, all `:free`; OpenRouter accepts at most 3). Free models are often rate limited upstream (Gemma and Qwen returned 429 in the probe), so OpenRouter's `models` list tries the next one. Reasoning text is excluded and only `delta.content` is streamed. The code refuses a paid id and stops if a response reports a cost.
8. **Streaming** is newline-separated JSON events (`sources`, `delta`, `done`, `error`) from a route handler; the client reads them with a stream reader and the stop button aborts the request.

Checked in a browser with the real models on 2 Oct 2026: an English question and a Bengali question each got an answer with a citation to the right passage, and an unrelated question got the no-answer sentence.

## 24. Hybrid search for ids and numbers only

Search by meaning (the embedding model) is the main path. Full-text search is added only for questions that contain an identifier or a number (a word with a digit, such as `E-4021` or `SEC-17`), which must all appear in the passage. The two ranked lists are merged with reciprocal rank fusion (k = 60). A question in plain words has no keyword list.

Why: Postgres full-text ranking does not know how rare a word is, so it favours passages that repeat common words. Searching on every word made results worse in the evaluation (`hybrid-all`, 12 of 14 first-place hits against 13 for meaning alone) and broke a cross-language question. Restricting keywords to numbers and identifiers, which are rare and exact, gave 14 of 14. The numbers, the small size of the set and the way the change was chosen are in `docs/evaluation.md`.

The keyword index is a GIN index on `to_tsvector('simple', translate(content, '-_', '  '))`: `simple` keeps words as they are, so it works for Bengali too, and hyphens count as spaces so `E-4021` is found by `4021`. `RETRIEVAL_MODE=vector` switches the chat back to meaning alone.

## 25. End-to-end tests use a stand-in AI service

`pnpm test:e2e` runs four Playwright tests in a real browser against the built app and the real worker, on a separate database (`askdocs_e2e`): sign up, upload and indexing without a reload, an answer with a citation, the no-answer sentence without a model call, a second organization that sees nothing and gets nothing, and delete.

The AI service is `e2e/fake-openrouter.mjs`, a small local server that speaks the two OpenRouter endpoints the app uses. Its embeddings hash the words of a text, so texts that share words are close; its answers quote the best matching passage and cite it. The app is pointed at it with `OPENROUTER_BASE_URL`, with a fake key, so the tests cost none of the 50 free requests a day, give the same result every time, and a real key in `.env` can never reach the real service from a test. The stand-in counts its calls, which lets a test prove that the model was not called (no close passage, and another organization's question).

The tenant isolation test was checked by removing the organization filter from the search on purpose: the test failed, as it should. What these tests do not check is the quality of real answers; the retrieval evaluation (`docs/evaluation.md`) and manual checks with the real models cover that.

The browser is Playwright's Chromium. Locally it is reused if already installed; CI installs it.

## 26. Deployment layout and its limits

Vercel Hobby runs the web app (region `sin1`, close to Dhaka and to the database), Neon runs Postgres, Render's free plan runs the worker. All three are free and none needs a card.

- Vercel limits a request body to 4.5 MB, so uploads are limited to 4 MB (`MAX_UPLOAD_BYTES`), checked in the browser and again on the server.
- Serverless functions open many short-lived connections, so the web app uses Neon's pooled address and a small pool (`DB_POOL_MAX=3`). The worker and the pg-boss sender use the direct address, because pg-boss needs session-level features that a transaction pooler does not give.
- `scripts/prepare-deploy-env.sh` builds the variable lists for both dashboards from local files and prints only names. The values are pasted by hand into the dashboards; no tool or script sends them anywhere.
- Render's Node image has a read-only `/usr/bin`, so `corepack enable` fails there. The build command runs pnpm through `npx -y pnpm@11.19.0` instead.

