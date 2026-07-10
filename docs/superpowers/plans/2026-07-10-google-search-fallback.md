# Google Search Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Google search fallback (`site:` + exact phrase) for Beatport and Traxsource, used only when each provider's direct site scrape returns `not_found`, without ever downgrading `not_found` to `error`.

**Architecture:** A new site-agnostic module `lib/google-search.ts` fetches Google result pages (page 1, then page 2 if nothing plausible/relevant), filters candidates through the existing `isRelevantMatch`, and returns the first matching URL or `null`. Each provider fetches that URL and parses it with a **new, separate parser** for the product-page shape (distinct from the existing search-results-page parser), then re-validates relevance before returning `found`.

**Tech Stack:** TypeScript, cheerio (HTML parsing, already a dependency), vitest (existing test runner), real captured HTML/JSON fixtures under `test/fixtures/`.

## Global Constraints

- A provider's `search()` must never throw — every failure path returns `{ platform, status: "error" | "not_found" }` (see `CLAUDE.md`, section Méthode).
- `not_found` = search executed, nothing relevant; `error` = real technical failure. A failed Google fallback (no fetch, no plausible URL, unparsable product page) is always `not_found`, never `error` — Google is an optional second attempt, not a new failure surface.
- Every new field/selector used below was verified against real, live-captured pages during design (2026-07-10) — not guessed. Fixtures are trimmed real captures, following the existing convention in `test/fixtures/` (see `beatport-search.json`, `traxsource-search.html`).
- No Playwright/headless browser for Google — plain `fetch` + cheerio, matching the existing Beatport/Traxsource providers. If Google blocks this in production, the fallback fails closed to `not_found` (acceptable, not a regression — see design doc "Hors scope").
- Spec reference: `docs/superpowers/changes/2026-07-10-google-search-fallback/design.md`.

---

### Task 1: `lib/google-search.ts` — site-agnostic Google discovery

**Files:**
- Create: `lib/google-search.ts`
- Create: `test/lib/google-search.test.ts`
- Create (already done): `test/fixtures/google-search-relevant.html`, `test/fixtures/google-search-empty.html`

**Interfaces:**
- Produces: `findViaGoogle(query: string, siteFilter: string, isPlausibleUrl: (url: string) => boolean): Promise<string | null>` — used by Task 2 and Task 3.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/google-search.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findViaGoogle } from "../../lib/google-search";

const relevantHtml = readFileSync(
  join(__dirname, "../fixtures/google-search-relevant.html"),
  "utf-8"
);
const emptyHtml = readFileSync(
  join(__dirname, "../fixtures/google-search-empty.html"),
  "utf-8"
);
const isTrackUrl = (url: string) => /\/track\//.test(url);

describe("findViaGoogle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the first plausible+relevant URL from page 1, query string stripped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => relevantHtml })
    );

    const url = await findViaGoogle("Robert Hood Minus", "beatport.com/track", isTrackUrl);

    expect(url).toBe("https://www.beatport.com/track/minus/11595385");
  });

  it("requests page 2 (start=10) when page 1 has nothing plausible/relevant", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const isPage2 = url.includes("start=10");
      return Promise.resolve({
        ok: true,
        text: async () => (isPage2 ? relevantHtml : emptyHtml),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const url = await findViaGoogle("Robert Hood Minus", "beatport.com/track", isTrackUrl);

    expect(url).toBe("https://www.beatport.com/track/minus/11595385");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when nothing relevant after page 1 and page 2", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => emptyHtml })
    );

    const url = await findViaGoogle("asdkjaskdjaskdj", "beatport.com/track", isTrackUrl);

    expect(url).toBeNull();
  });

  it("returns null (never throws) when the fetch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));

    const url = await findViaGoogle("anything", "beatport.com/track", isTrackUrl);

    expect(url).toBeNull();
  });

  it("rejects a plausible-URL candidate whose title isn't relevant", async () => {
    // relevantHtml's 2 results are both Robert Hood tracks; a completely
    // different query must not match either, and must fall through to
    // page 2 (which returns empty) and then null.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => relevantHtml,
    });
    vi.stubGlobal("fetch", fetchMock);

    const url = await findViaGoogle("Sven Dose All In", "beatport.com/track", isTrackUrl);

    expect(url).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/lib/google-search.test.ts`
Expected: FAIL — `Cannot find module '../../lib/google-search'`

- [ ] **Step 3: Write the implementation**

Create `lib/google-search.ts`:

```ts
import * as cheerio from "cheerio";
import { isRelevantMatch } from "./relevance";

const GOOGLE_SEARCH_URL = "https://www.google.com/search";
const RESULTS_PER_PAGE = 10;
const MAX_PAGES = 2;

type Candidate = { url: string; title: string };

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
async function fetchResultsPage(
  query: string,
  siteFilter: string,
  page: number
): Promise<string | null> {
  const params = new URLSearchParams({
    q: `site:${siteFilter} "${query}"`,
    hl: "en",
  });
  if (page > 0) params.set("start", String(page * RESULTS_PER_PAGE));

  try {
    const response = await fetch(`${GOOGLE_SEARCH_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Second-recourse discovery when a provider's own site search returns
 * nothing: search Google restricted to `siteFilter` for the exact `query`
 * phrase, page 1 then page 2, and return the first result URL that is
 * both plausible (`isPlausibleUrl`) and relevant (`isRelevantMatch`
 * against the result title). Never throws — any failure (network, no
 * candidates) resolves to `null`, which callers must treat as `not_found`,
 * never `error`.
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
      (c) => isPlausibleUrl(c.url) && isRelevantMatch(query, c.title)
    );
    if (match) return match.url;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/lib/google-search.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/google-search.ts test/lib/google-search.test.ts test/fixtures/google-search-relevant.html test/fixtures/google-search-empty.html
git commit -m "feat: add site-agnostic Google search fallback discovery"
```

---

### Task 2: Beatport — product-page parser + fallback wiring

**Files:**
- Modify: `lib/providers/beatport.ts`
- Modify: `test/providers/beatport.test.ts`
- Create (already done): `test/fixtures/beatport-product.json`

**Interfaces:**
- Consumes: `findViaGoogle(query, siteFilter, isPlausibleUrl): Promise<string | null>` (Task 1).
- Produces: no new exports — `beatportProvider.search` behavior changes internally only.

- [ ] **Step 1: Write the failing tests**

Add to `test/providers/beatport.test.ts` (append inside the existing `describe` block, after the last `it`, before the closing `});`):

```ts
  it("falls back to Google when the direct search has zero tracks, and parses the product page", async () => {
    const productFixture = readFileSync(
      join(__dirname, "../fixtures/beatport-product.json"),
      "utf-8"
    );
    const productHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${productFixture}</script></body></html>`;
    const emptySearchHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[{"state":{"data":{"tracks":{"data":[]}}}}]}}}}</script></body></html>`;
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.beatport.com/track/minus/11595385?srsltid=abc"><h3>Robert Hood - Minus (Original Mix) [Tresor Records]</h3></a></div></body></html>`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("https://www.beatport.com/search")) {
        return Promise.resolve({ ok: true, text: async () => emptySearchHtml });
      }
      if (url.startsWith("https://www.google.com/search")) {
        return Promise.resolve({ ok: true, text: async () => googleResultsHtml });
      }
      if (url === "https://www.beatport.com/track/minus/11595385") {
        return Promise.resolve({ ok: true, text: async () => productHtml });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await beatportProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Beatport",
      status: "found",
      purchaseUrl: "https://www.beatport.com/track/minus/11595385",
      coverUrl:
        "https://geo-media.beatport.com/image_size/500x500/5210c009e66df5f21140e78c61b2b97c.jpg",
      matchedArtist: "Robert Hood",
      matchedTitle: "Minus",
      metadata: {
        bpm: 135,
        key: "G# Minor",
        genre: "Techno (Raw / Deep / Hypnotic)",
        label: "Tresor Records",
      },
    });
  });

  it("stays not_found (never error) when Google finds nothing either", async () => {
    const emptySearchHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[{"state":{"data":{"tracks":{"data":[]}}}}]}}}}</script></body></html>`;
    const emptyGoogleHtml = `<!DOCTYPE html><html><body><div id="search"></div></body></html>`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("https://www.beatport.com/search")) {
        return Promise.resolve({ ok: true, text: async () => emptySearchHtml });
      }
      return Promise.resolve({ ok: true, text: async () => emptyGoogleHtml });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await beatportProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Beatport", status: "not_found" });
  });

  it("stays not_found (never error) when the Google-found product page fails to fetch", async () => {
    const emptySearchHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[{"state":{"data":{"tracks":{"data":[]}}}}]}}}}</script></body></html>`;
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.beatport.com/track/minus/11595385?srsltid=abc"><h3>Robert Hood - Minus (Original Mix) [Tresor Records]</h3></a></div></body></html>`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("https://www.beatport.com/search")) {
        return Promise.resolve({ ok: true, text: async () => emptySearchHtml });
      }
      if (url.startsWith("https://www.google.com/search")) {
        return Promise.resolve({ ok: true, text: async () => googleResultsHtml });
      }
      return Promise.resolve({ ok: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await beatportProvider.search("Robert Hood Minus");

    expect(result).toEqual({ platform: "Beatport", status: "not_found" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/providers/beatport.test.ts`
Expected: FAIL — the 3 new tests fail (current code returns `not_found` immediately, without ever calling `google.com` or the product URL, so the mocked `fetch` assertions/results don't match).

- [ ] **Step 3: Write the implementation**

Modify `lib/providers/beatport.ts` — add the import and two new pieces (product-page type/parser + fetch helper), then change the `not_found` branch in `search()`:

Add to the imports at the top:

```ts
import { findViaGoogle } from "../google-search";
```

Add after `firstTrack` (before `slugify`):

```ts
type BeatportProductTrack = {
  id: number;
  name: string;
  mix_name?: string;
  artists?: { name: string }[];
  bpm?: number;
  key?: { name: string };
  genre?: { name: string };
  release?: { label?: { name: string } };
  image?: { uri?: string };
};

// A product page's __NEXT_DATA__ holds the track directly at
// queries[0].state.data — a different shape from the search-results page
// (queries[0].state.data.tracks.data[]), verified live (2026-07-10).
function productPageTrack(nextData: unknown): BeatportProductTrack | null {
  const data = nextData as {
    props?: {
      pageProps?: {
        dehydratedState?: {
          queries?: { state?: { data?: BeatportProductTrack } }[];
        };
      };
    };
  };
  return data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data ?? null;
}

async function fetchProductPage(url: string, query: string): Promise<ProviderResult> {
  let html: string;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
    });
    // A Google-found URL that's now unreachable is "no usable result", not
    // a Beatport-side technical failure — stays not_found, never error.
    if (!response.ok) return { platform: "Beatport", status: "not_found" };
    html = await response.text();
  } catch {
    return { platform: "Beatport", status: "not_found" };
  }

  const nextData = extractNextData(html);
  if (!nextData) return { platform: "Beatport", status: "not_found" };

  const track = productPageTrack(nextData);
  if (!track) return { platform: "Beatport", status: "not_found" };

  const title =
    track.mix_name && track.mix_name !== "Original Mix"
      ? `${track.name} (${track.mix_name})`
      : track.name;
  const artist = track.artists?.[0]?.name ?? "";

  if (!isRelevantMatch(query, `${artist} ${title}`)) {
    return { platform: "Beatport", status: "not_found" };
  }

  return {
    platform: "Beatport",
    status: "found",
    purchaseUrl: url,
    coverUrl: track.image?.uri,
    matchedArtist: artist || undefined,
    matchedTitle: title,
    metadata: {
      bpm: track.bpm,
      key: track.key?.name,
      genre: track.genre?.name,
      label: track.release?.label?.name,
    },
  };
}
```

Replace this line in `search()`:

```ts
    const track = firstTrack(nextData);
    if (!track) return { platform: "Beatport", status: "not_found" };
```

with:

```ts
    const track = firstTrack(nextData);
    if (!track) {
      const googleUrl = await findViaGoogle(
        query,
        "beatport.com/track",
        (u) => /\/track\//.test(u)
      );
      if (!googleUrl) return { platform: "Beatport", status: "not_found" };
      return fetchProductPage(googleUrl, query);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/providers/beatport.test.ts`
Expected: PASS (6 tests — 3 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add lib/providers/beatport.ts test/providers/beatport.test.ts test/fixtures/beatport-product.json
git commit -m "feat: Google search fallback for Beatport when direct search finds nothing"
```

---

### Task 3: Traxsource — product-page parser + fallback wiring

**Files:**
- Modify: `lib/providers/traxsource.ts`
- Modify: `test/providers/traxsource.test.ts`
- Create (already done): `test/fixtures/traxsource-product.html`

**Interfaces:**
- Consumes: `findViaGoogle(query, siteFilter, isPlausibleUrl): Promise<string | null>` (Task 1).
- Produces: no new exports — `traxsourceProvider.search` behavior changes internally only.

- [ ] **Step 1: Write the failing tests**

Add to `test/providers/traxsource.test.ts` (append inside the existing `describe` block, after the last `it`, before the closing `});`):

```ts
  it("falls back to Google when the direct search has zero rows, and parses the product page", async () => {
    const productFixture = readFileSync(
      join(__dirname, "../fixtures/traxsource-product.html"),
      "utf-8"
    );
    const emptySearchHtml = "<html><body><div class=\"search-list-cont\"></div></body></html>";
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.traxsource.com/track/1809532/minus?srsltid=abc"><h3>Robert Hood - Minus [Tresor Records]</h3></a></div></body></html>`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("https://www.traxsource.com/search")) {
        return Promise.resolve({ ok: true, text: async () => emptySearchHtml });
      }
      if (url.startsWith("https://www.google.com/search")) {
        return Promise.resolve({ ok: true, text: async () => googleResultsHtml });
      }
      if (url === "https://www.traxsource.com/track/1809532/minus") {
        return Promise.resolve({ ok: true, text: async () => productFixture });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await traxsourceProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Traxsource",
      status: "found",
      purchaseUrl: "https://www.traxsource.com/track/1809532/minus",
      coverUrl: "https://www.traxsource.com/files/images/5210c009e66df5f21140e78c61b2b97c.jpg",
      matchedArtist: "Robert Hood",
      matchedTitle: "Minus",
      metadata: {
        bpm: 135,
        key: "G#min",
        genre: "Techno",
        label: "Tresor Records",
      },
    });
  });

  it("stays not_found (never error) when Google finds nothing either", async () => {
    const emptySearchHtml = "<html><body><div class=\"search-list-cont\"></div></body></html>";
    const emptyGoogleHtml = `<!DOCTYPE html><html><body><div id="search"></div></body></html>`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("https://www.traxsource.com/search")) {
        return Promise.resolve({ ok: true, text: async () => emptySearchHtml });
      }
      return Promise.resolve({ ok: true, text: async () => emptyGoogleHtml });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await traxsourceProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });

  it("stays not_found (never error) when the Google-found product page fails to fetch", async () => {
    const emptySearchHtml = "<html><body><div class=\"search-list-cont\"></div></body></html>";
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.traxsource.com/track/1809532/minus?srsltid=abc"><h3>Robert Hood - Minus [Tresor Records]</h3></a></div></body></html>`;

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("https://www.traxsource.com/search")) {
        return Promise.resolve({ ok: true, text: async () => emptySearchHtml });
      }
      if (url.startsWith("https://www.google.com/search")) {
        return Promise.resolve({ ok: true, text: async () => googleResultsHtml });
      }
      return Promise.resolve({ ok: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await traxsourceProvider.search("Robert Hood Minus");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/providers/traxsource.test.ts`
Expected: FAIL — the 3 new tests fail (current code returns `not_found` immediately without calling Google or the product URL).

- [ ] **Step 3: Write the implementation**

Modify `lib/providers/traxsource.ts` — add the import, a product-page parser, a fetch helper, and change the `not_found` branch:

Add to the imports at the top:

```ts
import { findViaGoogle } from "../google-search";
```

Add after the imports, before `export const traxsourceProvider`:

```ts
type TraxsourceProductTrack = {
  title: string;
  artist: string;
  cover?: string;
  bpm?: number;
  key?: string;
  genre?: string;
  label?: string;
};

// A product page's markup is unrelated to the search-results row markup
// (.trk-row / .trk-cell): the track lives under .trkp-hdr, and BPM/key/
// genre/label sit in a table whose columns are matched by header text
// (not by a stable per-cell class) — verified live (2026-07-10).
function parseProductPage(html: string): TraxsourceProductTrack | null {
  const $ = cheerio.load(html);
  const header = $(".trkp-hdr");

  const title = header.find(".page-head h1.title").first().text().trim();
  if (!title) return null;

  const version = header.find(".page-head h1.version").first().text().trim();
  const artist = header.find(".page-head a.com-artists").first().text().trim();
  const cover = header.find(".tr-image img").attr("src");

  const rows = header.find(".tr-det-tbl tr");
  const headerCells = rows
    .eq(0)
    .find("td")
    .map((_, el) => $(el).text().trim().replace(/:$/, "").toLowerCase())
    .get();
  const dataCells = rows
    .eq(1)
    .find("td")
    .map((_, el) => $(el).text().trim())
    .get();

  const cellFor = (name: string): string | undefined => {
    const idx = headerCells.indexOf(name);
    return idx === -1 ? undefined : dataCells[idx];
  };

  const bpmRaw = cellFor("bpm");
  const bpm = bpmRaw ? Number(bpmRaw) : undefined;

  return {
    title: version ? `${title} (${version})` : title,
    artist,
    cover,
    bpm: bpm !== undefined && Number.isFinite(bpm) ? bpm : undefined,
    key: cellFor("key") || undefined,
    genre: cellFor("genre") || undefined,
    label: cellFor("label") || undefined,
  };
}

async function fetchProductPage(url: string, query: string): Promise<ProviderResult> {
  let html: string;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
    });
    // A Google-found URL that's now unreachable is "no usable result", not
    // a Traxsource-side technical failure — stays not_found, never error.
    if (!response.ok) return { platform: "Traxsource", status: "not_found" };
    html = await response.text();
  } catch {
    return { platform: "Traxsource", status: "not_found" };
  }

  const track = parseProductPage(html);
  if (!track) return { platform: "Traxsource", status: "not_found" };

  if (!isRelevantMatch(query, `${track.artist} ${track.title}`)) {
    return { platform: "Traxsource", status: "not_found" };
  }

  return {
    platform: "Traxsource",
    status: "found",
    purchaseUrl: url,
    coverUrl: track.cover,
    matchedArtist: track.artist || undefined,
    matchedTitle: track.title,
    metadata: {
      bpm: track.bpm,
      key: track.key,
      genre: track.genre,
      label: track.label,
    },
  };
}
```

Replace this block in `search()`:

```ts
      const firstRow = $(".trk-row").first();
      if (firstRow.length === 0) {
        return { platform: "Traxsource", status: "not_found" };
      }
```

with:

```ts
      const firstRow = $(".trk-row").first();
      if (firstRow.length === 0) {
        const googleUrl = await findViaGoogle(
          query,
          "traxsource.com/track",
          (u) => /\/track\//.test(u)
        );
        if (!googleUrl) return { platform: "Traxsource", status: "not_found" };
        return fetchProductPage(googleUrl, query);
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/providers/traxsource.test.ts`
Expected: PASS (6 tests — 3 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add lib/providers/traxsource.ts test/providers/traxsource.test.ts test/fixtures/traxsource-product.html
git commit -m "feat: Google search fallback for Traxsource when direct search finds nothing"
```

---

### Task 4: Full suite + type-check verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, all suites green (existing tests unaffected — Task 2/3 only touch the `not_found` branch of each provider).

- [ ] **Step 2: Run the type-checker**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit if either step required a fix**

Only if Steps 1 or 2 needed a code fix:

```bash
git add -A
git commit -m "fix: address test/type-check issues from Google search fallback"
```

If both steps passed clean, no commit needed for this task.
