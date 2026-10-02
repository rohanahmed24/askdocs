# AskDocs

Multi-tenant document Q&A. Upload txt, md or pdf files to an organization, then ask questions and get answers with a citation to the exact passage each claim came from.

Work in progress. The full write-up (architecture diagram, trade-offs) lands with the first deploy.

## How I used AI

I built this with Claude Code (Anthropic's coding agent), and I want to be exact about who did what.

- **Claude wrote the code, the tests and the docs.** That includes the three pieces that matter most for correctness: the organization scope (`src/server/org-scope.ts`), the storage quota with its row lock (`src/server/quota.ts`) and the text chunker (`src/chunker`). I first planned to write those three by hand, then asked Claude to write them. `docs/decisions.md` #16 records that change.
- **I set the goal, the scope and the design direction**, and approved each step: a multi-tenant document Q&A app for a full-stack role, the Rohan.A design system for the UI, the order of work (auth, ingestion, then chat), and what to cut.
- **How the code is checked:** tests run against a real Postgres, and the risky ones were checked by breaking the code on purpose. Removing `FOR UPDATE` from the quota makes the lock test fail. Removing the grapheme check from the chunker makes the emoji and Bengali tests fail. `docs/walkthrough.md` explains why each of the three pieces is built the way it is.
- **Verified with the real embedding model:** upload text, chunk, embed with a free OpenRouter model, store, and find the right passage for an English and a Bengali question (`pnpm smoke:embeddings`).
- **Not verified yet:** CI on GitHub (blocked by an account billing issue) and the deployed worker.

## Stack

- Next.js (App Router) and TypeScript
- Postgres with pgvector, Drizzle ORM
- Docker Compose for local development, GitHub Actions for CI
- Better Auth (email and password), Zod
- pg-boss queue with a separate worker, free OpenRouter embedding models, unpdf for PDF text
- Chat: vector search in the user's organization, answers from free OpenRouter models with `[n]` citations, streamed
- Planned: evaluation script, hybrid search, Playwright

## Run it locally

Requires Node 24, pnpm and Docker.

```bash
pnpm install
cp .env.example .env   # then set BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm db:up        # Postgres + pgvector on localhost:5433
pnpm db:migrate   # apply migrations
pnpm dev
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the Next.js dev server |
| `pnpm check` | Lint, typecheck and test in one go |
| `pnpm test` | Run the Vitest suite |
| `pnpm db:up` / `pnpm db:down` | Start or stop the local database |
| `pnpm db:generate` | Create a migration from changes in `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm smoke:embeddings` | Try the real embedding model on a small document (2 free requests) |
| `pnpm ci:local` | Run the CI steps on a clean clone and a fresh database (needs Docker) |
| `pnpm worker` | Run the ingestion worker (needs `OPENROUTER_API_KEY`). Also serves `GET /health` on `PORT` (default 8080) |

## Continuous integration

`.github/workflows/ci.yml` runs lint, typecheck, migrations, tests and build on every push. GitHub Actions is currently blocked for this account (jobs end in 3 seconds with "account is locked due to a billing issue", support ticket open), so the same steps run two other ways:

- `pnpm ci:local` clones the committed code, starts a fresh `pgvector/pgvector:pg17` database in Docker and runs every CI step. It passes for the current commit.
- A `pre-push` hook (in `.githooks`, enabled by `pnpm install`) runs `pnpm check` and cancels a push that fails.

## Hosting

Web app on Vercel, Postgres on Neon, worker on a Render free web service. The worker sleeps when idle; the web app pings its `/health` after an upload, while a document waits, and once a day from Vercel Cron. Set `WORKER_URL` and `CRON_SECRET` on the web app (see `.env.example`). Details and trade-offs: `docs/decisions.md` #18 and #19.

## Where things are

- `src/db/schema.ts`: tables, enums, indexes
- `drizzle/`: generated SQL migrations
- `worker/`: the ingestion worker (its own process)
- `src/server/`: upload, ingestion, queue and cleanup logic
- `docs/decisions.md`: why things are the way they are
- `docs/phase-2-contracts.md`: contracts and test lists for org scope, storage quota and the chunker
