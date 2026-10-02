// Turns a question into a keyword query for Postgres full-text search.

const STOPWORDS = new Set(
  [
    // English
    "a an and are as at be but by can could do does did for from has have how i if in is it its me my of on or our so that the their there they this to was we were what when where which who whom why will with would you your",
    // Bengali question words and very common words
    "কী কি কখন কোথায় কোথা কে কেন কীভাবে কত কোন কোনটা এবং ও আমি আমরা তুমি আপনি হয় হবে আছে এই সেই তার তাদের জন্য থেকে",
  ]
    .join(" ")
    .split(" "),
);

/** The distinct words of a text worth searching for, lower-cased. Letters, marks (Bengali vowel signs) and digits only. */
export function keywordTokens(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 2 && !STOPWORDS.has(w)))];
}

/** The words that contain a digit: ids, codes, numbers and years (`SEC-17` gives `17`). */
export function identifierTokens(text: string): string[] {
  return keywordTokens(text).filter((t) => /\p{N}/u.test(t));
}

/**
 * A `to_tsquery` string for the keyword half of hybrid search, or null when
 * there is nothing to search for. Every word holds only letters, marks and
 * digits, so quoting it is enough to make the string safe for `to_tsquery`.
 *
 * - `"ids"` (the default): only the question's identifiers and numbers, all of
 *   which must be in the passage, such as `'4021'`. Postgres full-text ranking
 *   has no notion of how rare a word is, so ordinary words let the passages that
 *   repeat them most win, which is worse than leaving those questions to the
 *   embedding model. A number is rare and exact, which is when words help.
 * - `"all"`: any of the question's words, such as `'invoice' | 'late' | 'fee'`.
 *   Kept for the evaluation script, which compares the two.
 */
export function toTsQuery(text: string, mode: "ids" | "all" = "ids"): string | null {
  if (mode === "all") {
    const tokens = keywordTokens(text);
    return tokens.length > 0 ? tokens.map((t) => `'${t}'`).join(" | ") : null;
  }
  const ids = identifierTokens(text);
  return ids.length > 0 ? ids.map((t) => `'${t}'`).join(" & ") : null;
}
