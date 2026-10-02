# Walkthrough: org scope, storage quota, chunker

Why each of the three pieces is built the way it is, and how it can fail.

## 1. Org scope (`src/server/org-scope.ts`)

**Problem.** Every table with an `org_id` belongs to one customer. If one query forgets `WHERE org_id = ...`, one customer reads another's documents. With many routes, someone will forget.

**Design.** Routes do not write that filter. They call `getOrgScope(db, userId, orgId)` and read through the returned object (`listDocuments`, `getDocument`, `inOrg(table, ...)`). The filter lives in one place.

**The check.** `getOrgScope` looks the membership up in the database. It never trusts that the org id from the request belongs to the user. No membership row means `OrgAccessError("not_member")`, which a route turns into a 403.

**Attack cases and what happens**

| Attack | Result |
| --- | --- |
| Signed-in user of org A sends org B's id as the organization | `getOrgScope` throws `not_member` |
| User of org A asks for a document id that belongs to org B | `getDocument` returns `null`, the same answer as an id that does not exist, so a client cannot tell that the document exists |
| Malformed id in the URL (`/documents/abc`) | `null`, not a Postgres error |
| A member calls an owner-only action | `requireOwner()` throws `not_owner` |

**Limits.** The scope covers queries that go through it. A route that imports `db` and writes its own query is not protected. AGENTS.md rule 3a says to use the scope. A stronger version is Postgres row-level security, which the database itself enforces. That is a possible next step.

## 2. Storage quota (`src/server/quota.ts`)

**Problem.** An organization has a 50 MB limit. The check is "used + new size <= limit", then add the size. With two uploads at once, both read `used = 0`, both pass, and the organization ends at 1200 of 1000.

**Design.** Inside the upload transaction, `SELECT ... FOR UPDATE` locks the organization row. The second upload waits at that line until the first transaction commits or rolls back, then reads the updated counter and is refused.

**Why a transaction.** The reservation, the document row and the file row commit together. If storing the file fails, the rollback gives the reserved bytes back. No quota leaks.

**Why a lock and not something else.** An atomic `UPDATE ... WHERE used + $1 <= limit` would also work for this one check. The `SELECT ... FOR UPDATE` is easier to read, returns the numbers needed for the error message ("used X of Y"), and is the usual pattern when more checks are added later.

**Test.** One transaction reserves and stays open. A second upload starts and must not finish for 250 ms. Then the first commits and the second is refused. A plain `Promise.allSettled` test of two uploads passed even without the lock, because the queries finish before they overlap, so it proves nothing.

## 3. Chunker (`src/chunker/index.ts`)

**Problem.** An embedding of a whole document is too vague to search. A chunk that is too small loses context.

**Design.** About 1000 characters per chunk, 150 characters of overlap. Overlap means a sentence cut by a boundary appears whole in one of the two chunks.

**Where it breaks, in order.** The last paragraph break that fits, else the last sentence end (`. ! ? …` and the Bengali `।`), else the last space. Only if none exists, as with one very long word, it cuts in the middle.

**Never inside a character.** JavaScript strings are UTF-16: an emoji is two units, and a Bengali letter with a vowel sign is several code points. Cutting between them stores broken text. Cuts are moved to a boundary found with `Intl.Segmenter`.

**Always moves forward.** A chunk must reach past the overlap (`minLength = max(overlap + 1, size / 2)`), so the next start is always after the current one and the loop ends.

**Limits.** Size is in characters, not tokens. It does not know about headings, tables or PDF pages.
