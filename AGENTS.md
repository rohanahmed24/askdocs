# AskDocs: working rules

Rules for anyone changing this repo, human or AI agent.

1. Work in small commits. One feature at a time, each with tests. Run `pnpm check` (lint, typecheck, test) before committing.
2. Every tenant query is scoped to the caller's organization. Tables with an `org_id` column must never be queried without it.
3. Three pieces carry the security and correctness of the app and get extra scrutiny: the org-scope helper (`src/server/org-scope.ts`), the per-organization upload quota (`src/server/quota.ts`, raw SQL with `SELECT ... FOR UPDATE`) and the text chunker (`src/chunker`). Changes to them need tests that fail when the behavior is removed (for the quota lock, a test that holds one transaction open while a second one waits).
3a. Read tenant tables through the org scope (`getOrgScope`, then `scope.listDocuments()`, `scope.getDocument()` or `scope.inOrg(table, ...)`), never with a hand-written `where`. Writing a row for the signed-in user's own organization (found through `requireOrg`) is fine.
4. Ingestion runs as a background job in a separate worker process (never inside a Next.js route), with retries, and must be safe to run twice.
5. Embeddings are 768-dimensional. Use `EMBEDDING_DIMENSIONS` from `src/db/schema.ts`, never a literal.
6. Vector search first. Hybrid search comes after the evaluation script exists.
7. The package manager is pnpm.
8. Record non-obvious choices in `docs/decisions.md`.
9. UI follows the Rohan.A design tokens in `src/app/globals.css`: dark first, Anton for headlines, Geist for text, gold only as a fill with dark text, errors always with an icon and a sentence.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
