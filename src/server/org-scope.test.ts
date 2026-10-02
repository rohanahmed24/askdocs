import { describe, it } from "vitest";

// Phase 2, hand-written part: the org-scope helper that every tenant query goes
// through, and the tests that prove it. These are the cases to cover.
describe("org scope", () => {
  it.todo("returns only rows that belong to the caller's organization");
  it.todo("a user in org A cannot read org B's documents");
  it.todo("a user who is not a member of the organization is rejected");
  it.todo("owners and members are told apart");
});
