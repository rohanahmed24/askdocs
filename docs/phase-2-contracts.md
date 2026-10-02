# The three hand-written pieces

These are written by the project owner, not generated. The rest of the app is already built around them, so each piece can be written and tested on its own. Placeholders that throw "Not implemented" sit where each piece goes.

| # | Piece | File | Status |
| --- | --- | --- | --- |
| 1 | Org-scope helper | `src/server/org-scope.ts` | not started (todo tests in `org-scope.test.ts`) |
| 2 | Storage quota reservation | `src/server/quota.ts` | placeholder |
| 3 | Text chunker | `src/chunker/index.ts` | placeholder |

## 1. Org-scope helper

Every query on a tenant table (`documents`, `chunks`, `messages`, `memberships`) goes through one helper, so "forgot the `WHERE org_id = ...`" cannot happen in a route.

What it must do:

- Take a user id and an organization id, and prove the user is a member of that organization.
- If the user is not a member, fail in a way the caller can turn into a 403 (a dedicated error type is a good fit).
- Hand back something whose queries are already limited to that organization. A plain `orgId` plus the user's role is the minimum. Query helpers on top (for example, "documents of this org") are what routes should call instead of writing their own `where`.
- Tell owners and members apart (`role`), so owner-only actions can check it.

Tests to write (start from the `it.todo` list in `org-scope.test.ts`):

- Returns only the rows that belong to the caller's organization.
- A user in org A cannot read org B's documents, even with a valid document id from org B.
- A user who is not a member is rejected.
- Owners and members are told apart.

`requireOrg()` in `src/server/current-org.ts` picks the organization for the signed-in user. Once this helper exists, routes should call it right after `requireOrg()`.

## 2. Storage quota reservation (raw SQL)

Signature (`ReserveStorage` in `src/server/contracts.ts`):

```ts
(tx: Tx, orgId: string, bytes: number) => Promise<void>
```

What it must do, inside the transaction `createDocument` passes in:

1. Lock the organization row with `SELECT ... FOR UPDATE`.
2. If `storage_used_bytes + bytes` is over `storage_limit_bytes`, throw `QuotaExceededError(limitBytes, usedBytes)` and change nothing.
3. Otherwise add `bytes` to `storage_used_bytes`.

Why the lock matters: without it, two uploads read the same "used" value at the same time, both pass the check, and the organization ends up over its limit.

Tests to write:

- An upload that fits increases `storage_used_bytes` by its size.
- An upload that would exceed the limit throws `QuotaExceededError` and leaves the counter unchanged.
- Two concurrent uploads that cannot both fit: exactly one succeeds. (Run both in parallel with `Promise.allSettled` against the test database.)
- An upload that exactly fills the limit is allowed.

Already covered elsewhere: `createDocument` keeps no document row and queues no job when this throws, and rolls the reservation back if storing the file fails. The nightly cleanup releases bytes when it deletes old failed documents.

## 3. Text chunker

Signature:

```ts
chunkText(text: string, options?: { size?: number; overlap?: number }): string[]
```

It lives in `src/chunker/` with its own tests and no imports from the app, because it will be published to npm.

What it must do:

- Split plain text into chunks of about `size` characters (pick a default, for example 1000), where each chunk starts `overlap` characters before the previous one ended (for example 150).
- Return chunks in reading order, and cover all the text.
- Prefer to break at paragraph, then sentence, then word boundaries, instead of in the middle of a word.
- Handle edge cases without throwing: empty text, text shorter than one chunk, one very long word, `overlap >= size` (reject with a clear error, or clamp).

Tests to write:

- Text shorter than `size` gives one chunk equal to the text.
- Chunks overlap by roughly `overlap` characters.
- Joining the non-overlapping parts rebuilds the original text (nothing lost, nothing duplicated beyond the overlap).
- No chunk is empty, and no chunk is much longer than `size`.
- Breaks happen at boundaries when a boundary is available.
- A single word longer than `size` is still split.
- Multi-byte characters (Bengali, emoji) are not cut in half.

The ingestion worker calls it as `chunkText(text)` and trims and drops empty chunks, so it does not need to do that.
