# AskDocs

Multi-tenant document Q&A. Upload txt, md or pdf files to an organization, then ask questions and get answers with a citation to the exact passage each claim came from.

Work in progress. The full write-up (architecture diagram, trade-offs, how AI was used) lands with the first deploy.

## Stack

- Next.js (App Router) and TypeScript
- Postgres with pgvector, Drizzle ORM
- Docker Compose for local development, GitHub Actions for CI
- Better Auth (email and password), Zod
- Planned: pg-boss worker, Gemini embeddings and chat, Playwright

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

## Where things are

- `src/db/schema.ts`: tables, enums, indexes
- `drizzle/`: generated SQL migrations
- `docs/decisions.md`: why things are the way they are
