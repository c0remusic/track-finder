import * as cheerio from "cheerio";
import { isRelevantMatch } from "./relevance";
import { fetchHtmlViaBrowser } from "./browser-fetch";

const GOOGLE_SEARCH_URL = "https://www.google.com/search";
const RESULTS_PER_PAGE = 10;
// Was 2 pages — now that each page is a real browser launch (see
// fetchResultsPage) instead of a cheap HTTP fetch, a second page would push
// the worst case (own-search launch + 2 Google launches + product-page
// launch) too close to the orchestrator's per-provider timeout budget. One
// page covers the common case; a real result rarely sits past position 10
// for an exact-phrase site-restricted query.
const MAX_PAGES = 1;

type Candidate = { url: string; title: string };

// Extract the domain from siteFilter (e.g., "beatport.com" from
// "beatport.com/track") and check if the candidate URL's hostname matches
// it (exact match or subdomain). Prevents domain hijacking where a malicious
// or unrelated domain could pass `isPlausibleUrl` if that predicate only
// checks the path.
function hostMatches(url: string, siteFilter: string): boolean {
  try {
    const domain = siteFilter.split("/")[0]; // Extract domain before first /
    const u = new URL(url);
    // Accept exact match or subdomain (e.g., www.beatport.com for beatport.com)
    return u.hostname === domain || u.hostname.endsWith("." + domain);
  } catch {
    return false;
  }
}

// Google appends tracking params (e.g. `?srsltid=...`) to result links —
// strip them so the returned URL is the canonical product page, not a
// tracked redirect variant.
function stripQueryString(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

// Google's own result markup, not ours — verified live (2026-07-10):
// each result is an <a> wrapping an <h3> inside #search. No results at
// all (0 matches for the exact-phrase query) means #search has zero
// `a h3` elements; this structural check works regardless of Google's
// UI locale/wording, unlike parsing a "no results" text string.
function extractCandidates(html: string): Candidate[] {
  const $ = cheerio.load(html);
  const candidates: Candidate[] = [];
  $("#search a h3").each((_, el) => {
    const h3 = $(el);
    const link = h3.closest("a");
    const href = link.attr("href");
    const title = h3.text().trim();
    if (href && title) candidates.push({ url: stripQueryString(href), title });
  });
  return candidates;
}

// `hl=en` pins the results page to English so extractCandidates never has
// to branch on Google's UI locale. One fetch = one page; the caller drives
// pagination via `page` (0-indexed, `start=page*10`).
//
// A plain `fetch` gets served Google's "enablejs" bot-challenge page (empty
// #search, no real results) even with a browser User-Agent — verified live
// (2026-07-10), same class of bot detection as Cloudflare/Akamai on
// Beatport/Traxsource/Amazon Music. Goes through the same real-browser
// bypass (lib/browser-fetch.ts) for the same reason.
//
// The query is deliberately NOT wrapped in quotes. Quoting forces Google to
// require a literal exact-substring match on the page, which is stricter
// than the isRelevantMatch check below and can reject a genuinely correct
// result over a trivial spelling difference (confirmed real case,
// 2026-07-10: "Ticon - Mona Bone" on Bandcamp is actually titled "Monda
// Bone" on the page itself — a quoted search finds zero results even
// though the unquoted search ranks that exact page first). Relevance is
// enforced downstream by isRelevantMatch's 50%-token-overlap check instead.
async function fetchResultsPage(
  query: string,
  siteFilter: string,
  page: number
): Promise<string | null> {
  const params = new URLSearchParams({
    q: `site:${siteFilter} ${query}`,
    hl: "en",
  });
  if (page > 0) params.set("start", String(page * RESULTS_PER_PAGE));

  return fetchHtmlViaBrowser(`${GOOGLE_SEARCH_URL}?${params.toString()}`);
}

/**
 * Second-recourse discovery when a provider's own site search returns
 * nothing: search Google restricted to `siteFilter` for `query` (unquoted,
 * so Google's normal relevance ranking applies instead of literal
 * exact-substring matching), page 1 then page 2, and return the first
 * result URL that is both plausible (`isPlausibleUrl`), relevant (`isRelevantMatch`
 * against the result title), and on the correct domain (`hostMatches`).
 * Never throws — any failure (network, no candidates) resolves to `null`,
 * which callers must treat as `not_found`, never `error`.
 */
export async function findViaGoogle(
  query: string,
  siteFilter: string,
  isPlausibleUrl: (url: string) => boolean
): Promise<string | null> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await fetchResultsPage(query, siteFilter, page);
    if (!html) return null;

    const match = extractCandidates(html).find(
      (c) =>
        hostMatches(c.url, siteFilter) &&
        isPlausibleUrl(c.url) &&
        isRelevantMatch(query, c.title)
    );
    if (match) return match.url;
  }
  return null;
}
