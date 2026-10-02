import { describe, expect, it } from "vitest";
import { identifierTokens, keywordTokens, toTsQuery } from "./search-query";

describe("keywordTokens", () => {
  it("keeps the meaningful words and drops common ones", () => {
    expect(keywordTokens("What does error code E-4021 mean?")).toEqual(["error", "code", "4021", "mean"]);
  });

  it("splits ids on hyphens and underscores, like the index does", () => {
    expect(keywordTokens("policy SEC-12 and ticket_77")).toEqual(["policy", "sec", "12", "ticket", "77"]);
  });

  it("is case-insensitive and removes duplicates", () => {
    expect(keywordTokens("Pay PAY pay invoice")).toEqual(["pay", "invoice"]);
  });

  it("keeps whole Bengali words, with their vowel signs, and drops Bengali question words", () => {
    expect(keywordTokens("ল্যাপটপে কী ধরনের এনক্রিপশন লাগবে?")).toEqual(["ল্যাপটপে", "ধরনের", "এনক্রিপশন", "লাগবে"]);
  });

  it("returns nothing for a question of only common words or symbols", () => {
    expect(keywordTokens("What is the?")).toEqual([]);
    expect(keywordTokens("!!! ???")).toEqual([]);
  });
});

describe("identifierTokens", () => {
  it("keeps only words with a digit", () => {
    expect(identifierTokens("What does policy SEC-17 say about 2018?")).toEqual(["17", "2018"]);
    expect(identifierTokens("NW-7731 costs 45 dollars")).toEqual(["7731", "45"]);
    expect(identifierTokens("When is the new feature demo?")).toEqual([]);
  });

  it("counts Bengali digits", () => {
    expect(identifierTokens("২০ অক্টোবর কী হবে")).toEqual(["২০"]);
  });
});

describe("toTsQuery", () => {
  it("by default searches only identifiers and numbers, all of which must match", () => {
    expect(toTsQuery("What does error code E-4021 mean?")).toBe("'4021'");
    expect(toTsQuery("item NW-7731 and 2018")).toBe("'7731' & '2018'");
  });

  it("returns null for a question in plain words, so meaning alone decides", () => {
    expect(toTsQuery("How long do I have to pay an invoice?")).toBeNull();
    expect(toTsQuery("the and of")).toBeNull();
  });

  it("in all-words mode joins every word with OR", () => {
    expect(toTsQuery("late fee invoice", "all")).toBe("'late' | 'fee' | 'invoice'");
    expect(toTsQuery("the and of", "all")).toBeNull();
  });

  it("cannot carry a quote or an operator into the query", () => {
    expect(toTsQuery(`'; drop table chunks; -- & | ! ( ) :*`, "all")).toBe("'drop' | 'table' | 'chunks'");
    expect(toTsQuery("ab'cd", "all")).toBe("'ab' | 'cd'");
    expect(toTsQuery("x'; drop 12 | 99 & !7")).toBe("'12' & '99'");
  });
});
