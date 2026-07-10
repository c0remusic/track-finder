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
    .replace(/[^a-z0-9\s]/g, " ")
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

  const candidate = significantTokens(candidateText).join(" ");
  const matchCount = queryTokens.filter((token) => candidate.includes(token)).length;

  return matchCount / queryTokens.length >= 0.5;
}
