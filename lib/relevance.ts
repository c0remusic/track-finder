const STOPWORDS = new Set([
  "the",
  "and",
  "feat",
  "featuring",
  "with",
  "vs",
  "mix",
]);

function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    // \p{L} (any letter, any script) / \p{N} (any number) instead of a-z0-9,
    // so non-Latin queries (Japanese/Korean/Cyrillic/Arabic artist or track
    // names) don't get stripped down to zero tokens and silently bypass the
    // check entirely (that bypass was a real gap: an all-non-Latin query
    // hit the `queryTokens.length === 0` early-return below and let the
    // original false-positive bug straight back in for those users).
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

/**
 * Guards against providers whose search returns a loosely-related or
 * outright unrelated "best effort" result instead of no match at all
 * (confirmed real case: Bandcamp's fuzzy autocomplete matched "sven dose
 * all in" to "Coffee Breath — All Consultants Go To Heaven"). Requires at
 * least half of the query's significant words to appear in the candidate
 * text (matched artist + title combined) before trusting a "found" result.
 */
export function isRelevantMatch(query: string, candidateText: string): boolean {
  const queryTokens = significantTokens(query);
  if (queryTokens.length === 0) return true;

  // Exact-token membership, not substring containment: a joined-string
  // `.includes()` check would let a short query token match inside an
  // unrelated longer word in the candidate (e.g. query token "hood" would
  // wrongly match inside a candidate word like "brotherhood"), reintroducing
  // the exact false-positive-match bug this function exists to prevent.
  const candidateTokens = new Set(significantTokens(candidateText));
  const matchCount = queryTokens.filter((token) => candidateTokens.has(token)).length;

  return matchCount / queryTokens.length >= 0.5;
}
