# Track-finder MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public web tool where a user types an artist/title query and gets back (1) direct purchase links across Beatport, Traxsource, Amazon Music, Bandcamp, and Apple Music, and (2) aggregated metadata (BPM/key/genre/label/cover) from whichever of those platforms provide it.

**Architecture:** Single Next.js (App Router) app deployed on Vercel. One API route (`/api/search`) fans out to 5 independent "provider" modules in parallel, aggregates results, and returns JSON consumed by a single search page. No persistent catalog storage — each search is a live fetch, with a short in-memory cache to reduce load on scraped sites.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + React + Tailwind CSS + shadcn/ui, cheerio (HTML parsing), Playwright (headless browser for JS-gated sources), Vitest (tests), Upstash Redis (rate limiting), deployed on Vercel.

## Global Constraints

- No persistent storage of scraped catalog data — every search is a live fetch (design.md, "Stratégie de fetch").
- A platform with no match (`not_found`) is never shown in the purchase-links section; a platform where the search itself failed (`error`) is always shown explicitly (design.md, "Règle d'affichage").
- No silent retries against scraped sites — a failure is surfaced as-is for that search, never retried automatically.
- Every adapter times out independently (~5-8s) and a slow/broken adapter must never block the other four (`Promise.allSettled`).
- `tsc --noEmit` must pass before every commit.
- Verified empirically before writing this plan (2026-07-09, real HTTP requests, not assumed): Apple Music's iTunes Search API and Traxsource's search page are both plain server-rendered responses reachable with a normal HTTP fetch (no headless browser needed). Beatport's search page is server-rendered too, but the actual result data lives inside an embedded `__NEXT_DATA__` JSON blob, not in visible HTML — parse that JSON, don't scrape visible markup. Bandcamp's search page returned a JS "Client Challenge" bot-detection page to a plain fetch (title literally `Client Challenge`), and both `music.amazon.com/search` and `www.amazon.com/s?...` returned an empty client-rendered shell / 503 block page respectively — both require a real headless browser (Playwright), and Amazon in particular may still block a headless browser (its anti-bot stack is aggressive); treat Amazon Music as the highest-risk, most-likely-to-need-extra-work adapter.

---

## File Structure

```
track-finder/
  app/
    page.tsx                    # search UI
    api/search/route.ts         # orchestrator endpoint
    layout.tsx                  # root layout (Tailwind globals)
  components/
    SearchForm.tsx
    AchatSection.tsx
    MetadataSection.tsx
    Disclaimer.tsx
  lib/
    providers/
      types.ts                  # Provider interface, ProviderResult type
      apple-music.ts
      traxsource.ts
      beatport.ts
      bandcamp.ts
      amazon-music.ts
      index.ts                  # exports the list of all 5 providers
    cache.ts                    # short-TTL in-memory cache
    rate-limit.ts                # Upstash-backed per-IP limiter
  scripts/
    smoke-test.mjs              # manual, not run in CI
    capture-fixture.mjs         # Playwright capture helper (Bandcamp/Amazon tasks)
  test/
    fixtures/
      traxsource-search.html
      beatport-search.html
      bandcamp-search.html      # captured during Task 6
      amazon-music-search.html  # captured during Task 7
    providers/
      apple-music.test.ts
      traxsource.test.ts
      beatport.test.ts
      bandcamp.test.ts
      amazon-music.test.ts
    api/
      search.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`, `vitest.config.ts`, `.gitignore`

**Interfaces:**
- Produces: a working Next.js dev server and a `vitest` test runner other tasks build on.

- [ ] **Step 1: Scaffold Next.js app**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --no-turbopack
```
When prompted, accept defaults. This creates `package.json`, `tsconfig.json`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`.

- [ ] **Step 2: Add shadcn/ui**

Run:
```bash
npx shadcn@latest init -d
npx shadcn@latest add card badge button input
```

- [ ] **Step 3: Add test/scrape dependencies**

Run:
```bash
npm install cheerio
npm install -D vitest @vitejs/plugin-react jsdom @types/node
```

- [ ] **Step 4: Configure Vitest**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

Add to `package.json` `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify the scaffold works**

Run: `npm run dev` (then Ctrl+C once it starts without errors), and:
```bash
npx tsc --noEmit
npm run test
```
Expected: `tsc` prints nothing (clean), `vitest` reports "No test files found" (expected, none written yet) without crashing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + Tailwind + shadcn + Vitest"
```

---

### Task 2: Provider types and orchestrator contract

**Files:**
- Create: `lib/providers/types.ts`
- Test: `test/providers/types.test.ts`

**Interfaces:**
- Produces: `ProviderResult`, `Provider` — every later provider task implements `Provider`; the orchestrator (Task 8) consumes `Provider[]`.

- [ ] **Step 1: Write the failing test**

Create `test/providers/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { Provider, ProviderResult } from "../../lib/providers/types";

describe("Provider contract", () => {
  it("a minimal provider satisfies the Provider type", async () => {
    const fake: Provider = {
      name: "Fake",
      async search(query: string): Promise<ProviderResult> {
        return { platform: "Fake", status: "not_found" };
      },
    };
    const result = await fake.search("test");
    expect(result.status).toBe("not_found");
    expect(result.platform).toBe("Fake");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/providers/types.test.ts`
Expected: FAIL — `Cannot find module '../../lib/providers/types'`

- [ ] **Step 3: Write the types**

Create `lib/providers/types.ts`:
```ts
export type ProviderStatus = "found" | "not_found" | "error";

export type ProviderMetadata = {
  bpm?: number;
  key?: string;
  genre?: string;
  label?: string;
};

export type ProviderResult = {
  platform: string;
  status: ProviderStatus;
  purchaseUrl?: string;
  coverUrl?: string;
  matchedArtist?: string;
  matchedTitle?: string;
  metadata?: ProviderMetadata;
};

export type Provider = {
  name: string;
  search(query: string): Promise<ProviderResult>;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/providers/types.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add lib/providers/types.ts test/providers/types.test.ts
git commit -m "feat: define Provider/ProviderResult contract"
```

---

### Task 3: Apple Music provider (iTunes Search API)

**Files:**
- Create: `lib/providers/apple-music.ts`
- Test: `test/providers/apple-music.test.ts`

**Interfaces:**
- Consumes: `Provider`, `ProviderResult` from `lib/providers/types.ts` (Task 2).
- Produces: `appleMusicProvider: Provider`, consumed by `lib/providers/index.ts` (Task 8).

Verified real response shape (captured 2026-07-09 via `curl "https://itunes.apple.com/search?term=Robert+Hood+Minus&entity=song&limit=3"`, no auth needed, no bot-blocking encountered):
```json
{
  "resultCount": 1,
  "results": [{
    "artistName": "Robert Hood",
    "trackName": "Minus",
    "trackViewUrl": "https://music.apple.com/us/album/minus/1621738221?i=1621738415&uo=4",
    "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/.../100x100bb.jpg",
    "trackPrice": 1.29,
    "primaryGenreName": "Electronic"
  }]
}
```

- [ ] **Step 1: Write the failing test**

Create `test/providers/apple-music.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { appleMusicProvider } from "../../lib/providers/apple-music";

describe("appleMusicProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a found track to ProviderResult", async () => {
    const fakeResponse = {
      resultCount: 1,
      results: [
        {
          artistName: "Robert Hood",
          trackName: "Minus",
          trackViewUrl: "https://music.apple.com/us/album/minus/1621738221?i=1621738415&uo=4",
          artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
          primaryGenreName: "Electronic",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fakeResponse,
      })
    );

    const result = await appleMusicProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Apple Music",
      status: "found",
      purchaseUrl: "https://music.apple.com/us/album/minus/1621738221?i=1621738415&uo=4",
      coverUrl: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
      matchedArtist: "Robert Hood",
      matchedTitle: "Minus",
      metadata: { genre: "Electronic" },
    });
  });

  it("returns not_found when resultCount is 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ resultCount: 0, results: [] }),
      })
    );

    const result = await appleMusicProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Apple Music", status: "not_found" });
  });

  it("returns error when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const result = await appleMusicProvider.search("anything");

    expect(result).toEqual({ platform: "Apple Music", status: "error" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/providers/apple-music.test.ts`
Expected: FAIL — `Cannot find module '../../lib/providers/apple-music'`

- [ ] **Step 3: Write the implementation**

Create `lib/providers/apple-music.ts`:
```ts
import type { Provider, ProviderResult } from "./types";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";

type ITunesTrack = {
  artistName: string;
  trackName: string;
  trackViewUrl: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
};

type ITunesSearchResponse = {
  resultCount: number;
  results: ITunesTrack[];
};

export const appleMusicProvider: Provider = {
  name: "Apple Music",

  async search(query: string): Promise<ProviderResult> {
    const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(query)}&entity=song&limit=1`;

    let response: { ok: boolean; json: () => Promise<ITunesSearchResponse> };
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    } catch {
      return { platform: "Apple Music", status: "error" };
    }

    if (!response.ok) {
      return { platform: "Apple Music", status: "error" };
    }

    const data = await response.json();
    if (data.resultCount === 0 || data.results.length === 0) {
      return { platform: "Apple Music", status: "not_found" };
    }

    const track = data.results[0];
    return {
      platform: "Apple Music",
      status: "found",
      purchaseUrl: track.trackViewUrl,
      coverUrl: track.artworkUrl100,
      matchedArtist: track.artistName,
      matchedTitle: track.trackName,
      metadata: track.primaryGenreName ? { genre: track.primaryGenreName } : undefined,
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/providers/apple-music.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/providers/apple-music.ts test/providers/apple-music.test.ts
git commit -m "feat: Apple Music provider via public iTunes Search API"
```

---

### Task 4: Traxsource provider (cheerio, server-rendered HTML)

**Files:**
- Create: `lib/providers/traxsource.ts`
- Create: `test/fixtures/traxsource-search.html`
- Test: `test/providers/traxsource.test.ts`

**Interfaces:**
- Consumes: `Provider`, `ProviderResult` (Task 2).
- Produces: `traxsourceProvider: Provider`.

Verified real markup (captured 2026-07-09 via `curl "https://www.traxsource.com/search?term=Robert+Hood+Minus"`, plain HTTP, no bot-block encountered) — one result row:
```html
<div data-trid="1809532" class="trk-row play-trk ptk-1809532">
  <div class="trk-cell thumb">
    <img src="https://www.traxsource.com/scripts/image.php/52x52/5210c009e66df5f21140e78c61b2b97c.jpg" />
  </div>
  <div class="trk-cell artit-cont"></div>
  <div class="trk-cell title">
    <a href="/track/1809532/minus">Minus</a>
  </div>
  <div class="trk-cell artists">
    <a href="/artist/8868/robert-hood" class="com-artists" data-aid="8868">Robert Hood</a>
  </div>
  <div class="trk-cell label">
    <a href="/label/19000/tresor-records">Tresor Records</a>
  </div>
  <div class="trk-cell key-bpm">
    G#min<br>135
  </div>
  <div class="trk-cell genre">
    <a href="/genre/20/techno">Techno</a>
  </div>
  <div class="trk-cell r-date">2011-11-28</div>
  <div class="trk-cell btncell">
    <div class="buy-cont"><a class="com-buy" data-cart="{title_id: 337744, track_id: 1809532}"><span class="price">&#36;1.49</span></a></div>
  </div>
</div>
```

- [ ] **Step 1: Save the fixture**

Create `test/fixtures/traxsource-search.html` with exactly the HTML block above, wrapped in a minimal document so cheerio has a root to parse:
```html
<!DOCTYPE html>
<html><body>
<div class="search-list-cont trk-list-cont">
<div data-trid="1809532" class="trk-row play-trk ptk-1809532">
  <div class="trk-cell thumb">
    <img src="https://www.traxsource.com/scripts/image.php/52x52/5210c009e66df5f21140e78c61b2b97c.jpg" />
  </div>
  <div class="trk-cell artit-cont"></div>
  <div class="trk-cell title">
    <a href="/track/1809532/minus">Minus</a>
  </div>
  <div class="trk-cell artists">
    <a href="/artist/8868/robert-hood" class="com-artists" data-aid="8868">Robert Hood</a>
  </div>
  <div class="trk-cell label">
    <a href="/label/19000/tresor-records">Tresor Records</a>
  </div>
  <div class="trk-cell key-bpm">
    G#min<br>135
  </div>
  <div class="trk-cell genre">
    <a href="/genre/20/techno">Techno</a>
  </div>
  <div class="trk-cell r-date">2011-11-28</div>
  <div class="trk-cell btncell">
    <div class="buy-cont"><a class="com-buy" data-cart="{title_id: 337744, track_id: 1809532}"><span class="price">&#36;1.49</span></a></div>
  </div>
</div>
</div>
</body></html>
```

- [ ] **Step 2: Write the failing test**

Create `test/providers/traxsource.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { traxsourceProvider } from "../../lib/providers/traxsource";

const fixture = readFileSync(
  join(__dirname, "../fixtures/traxsource-search.html"),
  "utf-8"
);

describe("traxsourceProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the first result row from the fixture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => fixture })
    );

    const result = await traxsourceProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Traxsource",
      status: "found",
      purchaseUrl: "https://www.traxsource.com/track/1809532/minus",
      coverUrl:
        "https://www.traxsource.com/scripts/image.php/52x52/5210c009e66df5f21140e78c61b2b97c.jpg",
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

  it("returns not_found when no .trk-row is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "<html><body><div class=\"search-list-cont\"></div></body></html>",
      })
    );

    const result = await traxsourceProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });

  it("returns error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));

    const result = await traxsourceProvider.search("anything");

    expect(result).toEqual({ platform: "Traxsource", status: "error" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/providers/traxsource.test.ts`
Expected: FAIL — `Cannot find module '../../lib/providers/traxsource'`

- [ ] **Step 4: Write the implementation**

Create `lib/providers/traxsource.ts`:
```ts
import * as cheerio from "cheerio";
import type { Provider, ProviderResult } from "./types";

const TRAXSOURCE_SEARCH_URL = "https://www.traxsource.com/search";

export const traxsourceProvider: Provider = {
  name: "Traxsource",

  async search(query: string): Promise<ProviderResult> {
    const url = `${TRAXSOURCE_SEARCH_URL}?term=${encodeURIComponent(query)}`;

    let html: string;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
      });
      if (!response.ok) return { platform: "Traxsource", status: "error" };
      html = await response.text();
    } catch {
      return { platform: "Traxsource", status: "error" };
    }

    const $ = cheerio.load(html);
    const firstRow = $(".trk-row").first();
    if (firstRow.length === 0) {
      return { platform: "Traxsource", status: "not_found" };
    }

    const titleLink = firstRow.find(".trk-cell.title a").first();
    const title = titleLink.text().trim();
    const href = titleLink.attr("href");
    if (!href || !title) {
      return { platform: "Traxsource", status: "not_found" };
    }

    const artist = firstRow.find(".trk-cell.artists a").first().text().trim();
    const label = firstRow.find(".trk-cell.label a").first().text().trim();
    const cover = firstRow.find(".trk-cell.thumb img").attr("src");
    const genre = firstRow.find(".trk-cell.genre a").first().text().trim();

    // The "key-bpm" cell renders as `G#min<br>135` — split on <br>, not on
    // text(), since cheerio's .text() drops the <br> entirely and would
    // concatenate the two values with no separator.
    const keyBpmHtml = firstRow.find(".trk-cell.key-bpm").html() ?? "";
    const [keyRaw, bpmRaw] = keyBpmHtml
      .split(/<br\s*\/?>/i)
      .map((part) => part.replace(/<[^>]+>/g, "").trim());
    const bpm = bpmRaw ? Number(bpmRaw) : undefined;

    return {
      platform: "Traxsource",
      status: "found",
      purchaseUrl: `https://www.traxsource.com${href}`,
      coverUrl: cover,
      matchedArtist: artist || undefined,
      matchedTitle: title,
      metadata: {
        bpm: bpm !== undefined && Number.isFinite(bpm) ? bpm : undefined,
        key: keyRaw || undefined,
        genre: genre || undefined,
        label: label || undefined,
      },
    };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/providers/traxsource.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/providers/traxsource.ts test/providers/traxsource.test.ts test/fixtures/traxsource-search.html
git commit -m "feat: Traxsource provider via cheerio scraping"
```

---

### Task 5: Beatport provider (fetch + embedded `__NEXT_DATA__` JSON)

**Files:**
- Create: `lib/providers/beatport.ts`
- Create: `test/fixtures/beatport-search.json`
- Test: `test/providers/beatport.test.ts`

**Interfaces:**
- Consumes: `Provider`, `ProviderResult` (Task 2).
- Produces: `beatportProvider: Provider`.

Verified real data (captured 2026-07-09 via `curl "https://www.beatport.com/search?q=Robert+Hood+Minus"` — plain HTTP, 200 OK, no bot-block encountered). Beatport's page does not expose result data as visible HTML rows; it embeds the full search response as JSON inside `<script id="__NEXT_DATA__">`, at
`props.pageProps.dehydratedState.queries[0].state.data.tracks.data`. One real track object (trimmed to the fields this adapter uses):
```json
{
  "track_id": 4196748,
  "track_name": "Robert Hood",
  "mix_name": "Original Mix",
  "artists": [{ "artist_name": "Robert Hood" }],
  "bpm": 133,
  "key_name": "B Minor",
  "genre": [{ "genre_name": "Minimal / Deep Tech" }],
  "label": { "label_name": "Telegraph" },
  "track_image_uri": "https://geo-media.beatport.com/image_size/1500x250/73e8eb9b-43e3-4810-9a55-47c20f0d2f54.png"
}
```
Note: the JSON has no `slug` field. Beatport track URLs follow the pattern `/track/<slug>/<track_id>` where the slug is SEO-cosmetic — Beatport's routing resolves on the numeric ID. This adapter builds the slug from `track_name` and must be spot-checked with a real click-through during Task 5's manual verification (Step 6 below), since this is inferred, not directly confirmed from the JSON.

- [ ] **Step 1: Save the fixture**

Create `test/fixtures/beatport-search.json` (a trimmed but structurally faithful copy of the real embedded payload):
```json
{
  "props": {
    "pageProps": {
      "dehydratedState": {
        "queries": [
          {
            "state": {
              "data": {
                "tracks": {
                  "data": [
                    {
                      "track_id": 4196748,
                      "track_name": "Robert Hood",
                      "mix_name": "Original Mix",
                      "artists": [{ "artist_name": "Robert Hood" }],
                      "bpm": 133,
                      "key_name": "B Minor",
                      "genre": [{ "genre_name": "Minimal / Deep Tech" }],
                      "label": { "label_name": "Telegraph" },
                      "track_image_uri": "https://geo-media.beatport.com/image_size/1500x250/73e8eb9b-43e3-4810-9a55-47c20f0d2f54.png"
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/providers/beatport.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beatportProvider } from "../../lib/providers/beatport";

const fixtureData = readFileSync(
  join(__dirname, "../fixtures/beatport-search.json"),
  "utf-8"
);
const fixtureHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${fixtureData}</script></body></html>`;

describe("beatportProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the first track from the embedded __NEXT_DATA__ JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => fixtureHtml })
    );

    const result = await beatportProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Beatport",
      status: "found",
      purchaseUrl: "https://www.beatport.com/track/robert-hood/4196748",
      coverUrl:
        "https://geo-media.beatport.com/image_size/1500x250/73e8eb9b-43e3-4810-9a55-47c20f0d2f54.png",
      matchedArtist: "Robert Hood",
      matchedTitle: "Robert Hood",
      metadata: {
        bpm: 133,
        key: "B Minor",
        genre: "Minimal / Deep Tech",
        label: "Telegraph",
      },
    });
  });

  it("returns not_found when __NEXT_DATA__ has zero tracks", async () => {
    const emptyHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[{"state":{"data":{"tracks":{"data":[]}}}}]}}}}</script></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => emptyHtml })
    );

    const result = await beatportProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Beatport", status: "not_found" });
  });

  it("returns error when __NEXT_DATA__ is missing entirely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "<html></html>" })
    );

    const result = await beatportProvider.search("anything");

    expect(result).toEqual({ platform: "Beatport", status: "error" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/providers/beatport.test.ts`
Expected: FAIL — `Cannot find module '../../lib/providers/beatport'`

- [ ] **Step 4: Write the implementation**

Create `lib/providers/beatport.ts`:
```ts
import type { Provider, ProviderResult } from "./types";

const BEATPORT_SEARCH_URL = "https://www.beatport.com/search";

type BeatportTrack = {
  track_id: number;
  track_name: string;
  mix_name?: string;
  artists?: { artist_name: string }[];
  bpm?: number;
  key_name?: string;
  genre?: { genre_name: string }[];
  label?: { label_name: string };
  track_image_uri?: string;
};

function extractNextData(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function firstTrack(nextData: unknown): BeatportTrack | null {
  const data = nextData as {
    props?: {
      pageProps?: {
        dehydratedState?: {
          queries?: { state?: { data?: { tracks?: { data?: BeatportTrack[] } } } }[];
        };
      };
    };
  };
  const tracks = data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.tracks?.data;
  if (!tracks || tracks.length === 0) return null;
  return tracks[0];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const beatportProvider: Provider = {
  name: "Beatport",

  async search(query: string): Promise<ProviderResult> {
    const url = `${BEATPORT_SEARCH_URL}?q=${encodeURIComponent(query)}`;

    let html: string;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
      });
      if (!response.ok) return { platform: "Beatport", status: "error" };
      html = await response.text();
    } catch {
      return { platform: "Beatport", status: "error" };
    }

    const nextData = extractNextData(html);
    if (!nextData) return { platform: "Beatport", status: "error" };

    const track = firstTrack(nextData);
    if (!track) return { platform: "Beatport", status: "not_found" };

    const title =
      track.mix_name && track.mix_name !== "Original Mix"
        ? `${track.track_name} (${track.mix_name})`
        : track.track_name;

    return {
      platform: "Beatport",
      status: "found",
      purchaseUrl: `https://www.beatport.com/track/${slugify(track.track_name)}/${track.track_id}`,
      coverUrl: track.track_image_uri,
      matchedArtist: track.artists?.[0]?.artist_name,
      matchedTitle: title,
      metadata: {
        bpm: track.bpm,
        key: track.key_name,
        genre: track.genre?.[0]?.genre_name,
        label: track.label?.label_name,
      },
    };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/providers/beatport.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Manual verification of the inferred purchase URL**

The `purchaseUrl` slug is inferred (Beatport's JSON has no `slug` field). Before considering this task done, manually open `https://www.beatport.com/track/robert-hood/4196748` in a browser and confirm it resolves to the "Minus" track page rather than a 404 — if it 404s, the slug format needs adjusting (try the actual track title instead of the artist name, since Beatport's `track_name` field for this particular entry is oddly the artist's name — re-check the raw fixture data before assuming which field is really the title).

- [ ] **Step 7: Commit**

```bash
git add lib/providers/beatport.ts test/providers/beatport.test.ts test/fixtures/beatport-search.json
git commit -m "feat: Beatport provider via embedded __NEXT_DATA__ JSON"
```

---

### Task 6: Bandcamp provider (Playwright — confirmed to require a real browser)

**Files:**
- Create: `scripts/capture-fixture.mjs`
- Create: `lib/providers/bandcamp.ts`
- Create: `test/fixtures/bandcamp-search.html` (captured in Step 1)
- Test: `test/providers/bandcamp.test.ts`

**Interfaces:**
- Consumes: `Provider`, `ProviderResult` (Task 2).
- Produces: `bandcampProvider: Provider`.

Confirmed 2026-07-09: a plain `curl` against `https://bandcamp.com/search?q=...` returns a page titled `Client Challenge` (JS bot-detection gate), not real results. A headless browser is required. The exact result markup is not yet known — Step 1 below captures it for real before any selector is written.

- [ ] **Step 1: Install Playwright and capture a real fixture**

Run:
```bash
npm install -D playwright
npx playwright install chromium
```

Create `scripts/capture-fixture.mjs`:
```js
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2];
const outPath = process.argv[3];
if (!url || !outPath) {
  console.error("Usage: node scripts/capture-fixture.mjs <url> <outPath>");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
});
await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
const html = await page.content();
writeFileSync(outPath, html, "utf-8");
console.log(`Saved ${html.length} bytes to ${outPath}`);
await browser.close();
```

Run:
```bash
node scripts/capture-fixture.mjs "https://bandcamp.com/search?q=Robert%20Hood%20Minus" test/fixtures/bandcamp-search.html
```

- [ ] **Step 2: Inspect the captured fixture and identify real selectors**

Open `test/fixtures/bandcamp-search.html` and find the container holding search results (as of past observation, Bandcamp's search results have historically used a `.result-info` block per result with a `.heading a` for the title/link, `.subhead` for artist, and `.art img` for the cover — but this must be confirmed against the fixture just captured, not assumed). Note the actual class names found before writing Step 4. If the captured page still shows a "Client Challenge"/CAPTCHA instead of results, increase the Playwright wait (`page.waitForSelector` on a plausible results container, or `waitForTimeout(3000)` after `goto`) and re-run Step 1 before continuing.

- [ ] **Step 3: Write the failing test**

Create `test/providers/bandcamp.test.ts` following the exact same pattern as `test/providers/traxsource.test.ts` (Task 4, Step 2): read the fixture captured in Step 1, stub `fetch`... **but note Bandcamp requires Playwright, not `fetch`** — stub the Playwright call instead. Structure:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bandcampProvider } from "../../lib/providers/bandcamp";
import * as playwright from "playwright";

const fixture = readFileSync(join(__dirname, "../fixtures/bandcamp-search.html"), "utf-8");

describe("bandcampProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses the first result from the captured fixture", async () => {
    const fakePage = {
      goto: vi.fn(),
      content: vi.fn().mockResolvedValue(fixture),
      close: vi.fn(),
    };
    const fakeBrowser = {
      newPage: vi.fn().mockResolvedValue(fakePage),
      close: vi.fn(),
    };
    vi.spyOn(playwright.chromium, "launch").mockResolvedValue(fakeBrowser as any);

    const result = await bandcampProvider.search("Robert Hood Minus");

    // Fill in the exact expected fields once Step 2's real selectors are known —
    // this assertion must match a genuine result parsed from the real fixture,
    // not an invented value.
    expect(result.status).toBe("found");
    expect(result.platform).toBe("Bandcamp");
  });

  it("returns error when Playwright throws", async () => {
    vi.spyOn(playwright.chromium, "launch").mockRejectedValue(new Error("launch failed"));

    const result = await bandcampProvider.search("anything");

    expect(result).toEqual({ platform: "Bandcamp", status: "error" });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/providers/bandcamp.test.ts`
Expected: FAIL — `Cannot find module '../../lib/providers/bandcamp'`

- [ ] **Step 5: Write the implementation**

Create `lib/providers/bandcamp.ts` using the real selectors identified in Step 2 (replace the placeholder selectors below — marked clearly — with what Step 2 actually found):
```ts
import { chromium } from "playwright";
import * as cheerio from "cheerio";
import type { Provider, ProviderResult } from "./types";

const BANDCAMP_SEARCH_URL = "https://bandcamp.com/search";

export const bandcampProvider: Provider = {
  name: "Bandcamp",

  async search(query: string): Promise<ProviderResult> {
    const url = `${BANDCAMP_SEARCH_URL}?q=${encodeURIComponent(query)}`;

    let html: string;
    try {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        });
        await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
        html = await page.content();
      } finally {
        await browser.close();
      }
    } catch {
      return { platform: "Bandcamp", status: "error" };
    }

    const $ = cheerio.load(html);
    // REPLACE these selectors with what Step 2 found in the real fixture —
    // do not ship with unverified guesses.
    const firstResult = $(".result-info").first();
    if (firstResult.length === 0) {
      return { platform: "Bandcamp", status: "not_found" };
    }

    const titleLink = firstResult.find(".heading a").first();
    const title = titleLink.text().trim();
    const href = titleLink.attr("href");
    const artist = firstResult.find(".subhead").first().text().trim();
    const cover = firstResult.find("img").attr("src");

    if (!href || !title) {
      return { platform: "Bandcamp", status: "not_found" };
    }

    return {
      platform: "Bandcamp",
      status: "found",
      purchaseUrl: href,
      coverUrl: cover,
      matchedArtist: artist || undefined,
      matchedTitle: title,
    };
  },
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/providers/bandcamp.test.ts`
Expected: PASS — if it fails because the selectors don't match the real fixture, go back to Step 2, re-inspect, correct the selectors in Step 5, and re-run. Do not weaken the test to make it pass; fix the selectors.

- [ ] **Step 7: Commit**

```bash
git add lib/providers/bandcamp.ts test/providers/bandcamp.test.ts test/fixtures/bandcamp-search.html scripts/capture-fixture.mjs package.json
git commit -m "feat: Bandcamp provider via Playwright (bot-gated site)"
```

---

### Task 7: Amazon Music provider (Playwright — highest-risk adapter)

**Files:**
- Create: `lib/providers/amazon-music.ts`
- Create: `test/fixtures/amazon-music-search.html` (captured in Step 1)
- Test: `test/providers/amazon-music.test.ts`

**Interfaces:**
- Consumes: `Provider`, `ProviderResult` (Task 2), `scripts/capture-fixture.mjs` (Task 6).
- Produces: `amazonMusicProvider: Provider`.

Confirmed 2026-07-09: `music.amazon.com/search/<query>` returns an empty client-rendered SPA shell to a plain fetch (no results in initial HTML), and `www.amazon.com/s?k=...&i=digital-music` (the actual MP3-purchase storefront) returned an outright `503 Sorry! Something went wrong!` block page to a plain request. Amazon's anti-bot stack is known to be aggressive — a headless Playwright browser may still get blocked even with realistic headers. Budget extra time for this task and do not assume Step 1 will work on the first try.

- [ ] **Step 1: Capture a real fixture with Playwright**

Run (reusing `scripts/capture-fixture.mjs` from Task 6):
```bash
node scripts/capture-fixture.mjs "https://www.amazon.com/s?k=Robert+Hood+Minus&i=digital-music" test/fixtures/amazon-music-search.html
```

Open the resulting file. If it's still a block/CAPTCHA page (check the `<title>`; a real Amazon result page title looks like `"Robert Hood Minus" : Amazon.com : Digital Music`, a block page says something like `Sorry! Something went wrong!` or shows a CAPTCHA image), try:
1. Adding `--proxy-server` is out of scope for v1 — first retry with a longer `waitForTimeout(5000)` after `goto` and a fresh `browser.newContext()` per attempt (a shared context can accumulate a block flag).
2. If it still blocks after 2-3 attempts, stop and mark this adapter `error` unconditionally in Step 5's implementation (return `{ platform: "Amazon Music", status: "error" }` immediately) rather than shipping a scraper that never actually works — document this as a known gap for a future task, don't force it.

- [ ] **Step 2: Inspect the fixture and identify real selectors** (only if Step 1 produced real results, not a block page)

Find the search-results container and note the actual classes/attributes for: result item, title, artist, product link, cover image. Do not reuse Bandcamp's or Traxsource's selectors — Amazon's markup is unrelated.

- [ ] **Step 3: Write the failing test**

Create `test/providers/amazon-music.test.ts` following the same structure as `test/providers/bandcamp.test.ts` (Task 6, Step 3), reading `test/fixtures/amazon-music-search.html` and stubbing `playwright.chromium.launch`. Include the same two cases (found + Playwright-throws error).

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/providers/amazon-music.test.ts`
Expected: FAIL — `Cannot find module '../../lib/providers/amazon-music'`

- [ ] **Step 5: Write the implementation**

Create `lib/providers/amazon-music.ts` mirroring `lib/providers/bandcamp.ts`'s structure (Task 6, Step 5) — same Playwright launch/close pattern, `BANDCAMP_SEARCH_URL` replaced with `https://www.amazon.com/s?k=<query>&i=digital-music`, and selectors from Step 2. If Step 1 never produced real results, implement this as:
```ts
import type { Provider, ProviderResult } from "./types";

export const amazonMusicProvider: Provider = {
  name: "Amazon Music",

  async search(_query: string): Promise<ProviderResult> {
    // Amazon's anti-bot stack blocked every capture attempt during
    // implementation (see docs/superpowers/plans/2026-07-09-track-finder-mvp.md,
    // Task 7). Returning `error` unconditionally rather than shipping a
    // scraper known not to work — revisit if a future attempt succeeds.
    return { platform: "Amazon Music", status: "error" };
  },
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/providers/amazon-music.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/providers/amazon-music.ts test/providers/amazon-music.test.ts
git add test/fixtures/amazon-music-search.html 2>/dev/null || true
git commit -m "feat: Amazon Music provider (or documented stub if scraping blocked)"
```

---

### Task 8: Orchestrator API route (`/api/search`)

**Files:**
- Create: `lib/providers/index.ts`
- Create: `lib/cache.ts`
- Create: `app/api/search/route.ts`
- Test: `test/api/search.test.ts`
- Test: `test/lib/cache.test.ts`

**Interfaces:**
- Consumes: all 5 `Provider` implementations (Tasks 3-7), `ProviderResult` (Task 2).
- Produces: `GET /api/search?q=...` returning `{ purchase: ProviderResult[], metadata: ProviderMetadata & { sources: Record<string, string> } }`, consumed by `app/page.tsx` (Task 10).

- [ ] **Step 1: Write the failing cache test**

Create `test/lib/cache.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { TtlCache } from "../../lib/cache";

describe("TtlCache", () => {
  it("returns a cached value before it expires", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("returns undefined after the TTL elapses", async () => {
    const cache = new TtlCache<string>(10);
    cache.set("key", "value");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cache.get("key")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/cache.test.ts`
Expected: FAIL — `Cannot find module '../../lib/cache'`

- [ ] **Step 3: Implement the cache**

Create `lib/cache.ts`:
```ts
type Entry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/cache.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Create the provider registry**

Create `lib/providers/index.ts`:
```ts
import type { Provider } from "./types";
import { appleMusicProvider } from "./apple-music";
import { traxsourceProvider } from "./traxsource";
import { beatportProvider } from "./beatport";
import { bandcampProvider } from "./bandcamp";
import { amazonMusicProvider } from "./amazon-music";

export const allProviders: Provider[] = [
  appleMusicProvider,
  traxsourceProvider,
  beatportProvider,
  bandcampProvider,
  amazonMusicProvider,
];
```

- [ ] **Step 6: Write the failing orchestrator test**

Create `test/api/search.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { aggregateSearch } from "../../app/api/search/route";
import type { Provider } from "../../lib/providers/types";

function fakeProvider(overrides: Partial<Provider> & { name: string }): Provider {
  return {
    search: async () => ({ platform: overrides.name, status: "not_found" }),
    ...overrides,
  };
}

describe("aggregateSearch", () => {
  it("filters out not_found and keeps found + error in purchase list", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "A",
        search: async () => ({ platform: "A", status: "found", purchaseUrl: "https://a.example/x" }),
      }),
      fakeProvider({ name: "B", search: async () => ({ platform: "B", status: "not_found" }) }),
      fakeProvider({ name: "C", search: async () => ({ platform: "C", status: "error" }) }),
    ];

    const result = await aggregateSearch("query", providers);

    expect(result.purchase.map((r) => r.platform).sort()).toEqual(["A", "C"]);
  });

  it("merges metadata across found providers, keeping conflicting values with their source", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "A",
        search: async () => ({
          platform: "A",
          status: "found",
          purchaseUrl: "https://a.example/x",
          metadata: { bpm: 133 },
        }),
      }),
      fakeProvider({
        name: "B",
        search: async () => ({
          platform: "B",
          status: "found",
          purchaseUrl: "https://b.example/y",
          metadata: { bpm: 134 },
        }),
      }),
    ];

    const result = await aggregateSearch("query", providers);

    expect(result.metadata.bpm).toEqual([
      { value: 133, source: "A" },
      { value: 134, source: "B" },
    ]);
  });

  it("isolates a provider that throws instead of failing the whole search", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "A",
        search: async () => {
          throw new Error("boom");
        },
      }),
      fakeProvider({
        name: "B",
        search: async () => ({ platform: "B", status: "found", purchaseUrl: "https://b.example/y" }),
      }),
    ];

    const result = await aggregateSearch("query", providers);

    expect(result.purchase.map((r) => r.platform).sort()).toEqual(["A", "B"]);
    expect(result.purchase.find((r) => r.platform === "A")?.status).toBe("error");
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/api/search.test.ts`
Expected: FAIL — `Cannot find module '../../app/api/search/route'`

- [ ] **Step 8: Implement the orchestrator**

Create `app/api/search/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { allProviders } from "../../../lib/providers";
import type { Provider, ProviderResult } from "../../../lib/providers/types";
import { TtlCache } from "../../../lib/cache";

type MetadataValue<T> = { value: T; source: string };

type AggregatedMetadata = {
  bpm: MetadataValue<number>[];
  key: MetadataValue<string>[];
  genre: MetadataValue<string>[];
  label: MetadataValue<string>[];
};

type AggregatedResult = {
  purchase: ProviderResult[];
  metadata: AggregatedMetadata;
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const searchCache = new TtlCache<AggregatedResult>(ONE_HOUR_MS);

async function runProvider(provider: Provider, query: string): Promise<ProviderResult> {
  try {
    return await provider.search(query);
  } catch {
    return { platform: provider.name, status: "error" };
  }
}

export async function aggregateSearch(
  query: string,
  providers: Provider[] = allProviders
): Promise<AggregatedResult> {
  const cacheKey = query.trim().toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const results = await Promise.all(providers.map((p) => runProvider(p, query)));

  const purchase = results.filter((r) => r.status !== "not_found");

  const metadata: AggregatedMetadata = { bpm: [], key: [], genre: [], label: [] };
  for (const result of results) {
    if (result.status !== "found" || !result.metadata) continue;
    const { bpm, key, genre, label } = result.metadata;
    if (bpm !== undefined) metadata.bpm.push({ value: bpm, source: result.platform });
    if (key !== undefined) metadata.key.push({ value: key, source: result.platform });
    if (genre !== undefined) metadata.genre.push({ value: genre, source: result.platform });
    if (label !== undefined) metadata.label.push({ value: label, source: result.platform });
  }

  const aggregated: AggregatedResult = { purchase, metadata };
  searchCache.set(cacheKey, aggregated);
  return aggregated;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");
  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
  }

  const result = await aggregateSearch(query);
  return NextResponse.json(result);
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run test/api/search.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add lib/providers/index.ts lib/cache.ts app/api/search/route.ts test/api/search.test.ts test/lib/cache.test.ts
git commit -m "feat: /api/search orchestrator with cache, not_found filtering, metadata merge"
```

---

### Task 9: Rate limiting

**Files:**
- Create: `lib/rate-limit.ts`
- Modify: `app/api/search/route.ts`
- Test: `test/lib/rate-limit.test.ts`

**Interfaces:**
- Consumes: `@upstash/redis`, `@upstash/ratelimit` (installed this task).
- Produces: `checkRateLimit(identifier: string): Promise<{ success: boolean }>`, called from `GET` in `app/api/search/route.ts`.

- [ ] **Step 1: Check current library docs before writing code**

Before implementing, use Context7 (`resolve-library-id` then `query-docs` for `@upstash/ratelimit`) to confirm the current constructor and `.limit()` return shape — this project's CLAUDE.md-equivalent rule is "never guess an external API," and this library's API should be verified against current docs rather than assumed from memory.

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install @upstash/ratelimit @upstash/redis
```

- [ ] **Step 3: Write the failing test**

Create `test/lib/rate-limit.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { checkRateLimit } from "../../lib/rate-limit";

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue({ success: true }),
    })),
    { slidingWindow: vi.fn() }
  ),
}));

describe("checkRateLimit", () => {
  it("returns success true when under the limit", async () => {
    const result = await checkRateLimit("1.2.3.4");
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/lib/rate-limit.test.ts`
Expected: FAIL — `Cannot find module '../../lib/rate-limit'`

- [ ] **Step 5: Implement rate limiting**

Create `lib/rate-limit.ts` (constructor/method names to be confirmed against Step 1's doc lookup — this is the shape as of the library's last known stable release; adjust field/method names if the docs lookup shows a different current signature):
```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
});

export async function checkRateLimit(identifier: string): Promise<{ success: boolean }> {
  const { success } = await ratelimit.limit(identifier);
  return { success };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/lib/rate-limit.test.ts`
Expected: PASS

- [ ] **Step 7: Wire it into the route**

Modify `app/api/search/route.ts` — add the import and check at the top of `GET`:
```ts
import { checkRateLimit } from "../../../lib/rate-limit";
```
```ts
export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { success } = await checkRateLimit(ip);
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const query = request.nextUrl.searchParams.get("q");
  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
  }

  const result = await aggregateSearch(query);
  return NextResponse.json(result);
}
```

- [ ] **Step 8: Run the full test suite**

Run: `npm run test`
Expected: all tests still PASS (rate limiting only affects `GET`, not `aggregateSearch` which the existing tests call directly).

- [ ] **Step 9: Document the required environment variables**

Create/append to `.env.example`:
```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```
Note in a comment above them: obtained by creating a free Upstash Redis database and copying its REST credentials; must be set as real environment variables in Vercel (via `vercel env add`) before deploying Task 12.

- [ ] **Step 10: Commit**

```bash
git add lib/rate-limit.ts app/api/search/route.ts test/lib/rate-limit.test.ts .env.example
git commit -m "feat: per-IP rate limiting via Upstash Redis"
```

---

### Task 10: Search UI

**Files:**
- Create: `components/SearchForm.tsx`
- Create: `components/AchatSection.tsx`
- Create: `components/MetadataSection.tsx`
- Create: `components/Disclaimer.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: the JSON shape returned by `GET /api/search` (Task 8/9): `{ purchase: ProviderResult[], metadata: AggregatedMetadata }`.

- [ ] **Step 1: Build the search form**

Create `components/SearchForm.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  onSearch: (query: string) => void;
  isLoading: boolean;
};

export function SearchForm({ onSearch, isLoading }: Props) {
  const [query, setQuery] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (query.trim()) onSearch(query.trim());
      }}
      className="flex gap-2"
    >
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Artiste - Titre"
        aria-label="Recherche artiste et titre"
      />
      <Button type="submit" disabled={isLoading}>
        {isLoading ? "Recherche..." : "Chercher"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Build the purchase-links section**

Create `components/AchatSection.tsx`:
```tsx
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProviderResult } from "@/lib/providers/types";

export function AchatSection({ results }: { results: ProviderResult[] }) {
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune plateforme trouvée.</p>;
  }

  return (
    <div className="grid gap-3">
      {results.map((r) => (
        <Card key={r.platform} className="flex items-center justify-between p-4">
          <div>
            <p className="font-medium">{r.platform}</p>
            {r.status === "found" && r.matchedArtist && r.matchedTitle && (
              <p className="text-sm text-muted-foreground">
                {r.matchedArtist} — {r.matchedTitle}
              </p>
            )}
          </div>
          {r.status === "found" && r.purchaseUrl ? (
            <a
              href={r.purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              Voir l&apos;offre
            </a>
          ) : (
            <Badge variant="destructive">Indisponible pour l&apos;instant</Badge>
          )}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Build the metadata section**

Create `components/MetadataSection.tsx`:
```tsx
type MetadataValue<T> = { value: T; source: string };

type Props = {
  metadata: {
    bpm: MetadataValue<number>[];
    key: MetadataValue<string>[];
    genre: MetadataValue<string>[];
    label: MetadataValue<string>[];
  };
};

function Field<T>({ label, values }: { label: string; values: MetadataValue<T>[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="text-sm text-muted-foreground">
        {values.map((v) => `${v.value} (${v.source})`).join(", ")}
      </dd>
    </div>
  );
}

export function MetadataSection({ metadata }: Props) {
  const hasAny =
    metadata.bpm.length + metadata.key.length + metadata.genre.length + metadata.label.length > 0;

  if (!hasAny) {
    return <p className="text-sm text-muted-foreground">Aucune métadonnée disponible.</p>;
  }

  return (
    <dl className="grid gap-2">
      <Field label="BPM" values={metadata.bpm} />
      <Field label="Clé" values={metadata.key} />
      <Field label="Genre" values={metadata.genre} />
      <Field label="Label" values={metadata.label} />
    </dl>
  );
}
```

- [ ] **Step 4: Build the disclaimer footer**

Create `components/Disclaimer.tsx`:
```tsx
export function Disclaimer() {
  return (
    <footer className="mt-12 border-t pt-4 text-xs text-muted-foreground">
      Les liens fournis sont indicatifs et pointent vers les plateformes
      concernées. Ce site n&apos;est affilié à aucune des plateformes listées.
    </footer>
  );
}
```

- [ ] **Step 5: Wire the page together**

Modify `app/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import { SearchForm } from "@/components/SearchForm";
import { AchatSection } from "@/components/AchatSection";
import { MetadataSection } from "@/components/MetadataSection";
import { Disclaimer } from "@/components/Disclaimer";
import type { ProviderResult } from "@/lib/providers/types";

type SearchResponse = {
  purchase: ProviderResult[];
  metadata: {
    bpm: { value: number; source: string }[];
    key: { value: string; source: string }[];
    genre: { value: string; source: string }[];
    label: { value: string; source: string }[];
  };
};

export default function Home() {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(query: string) {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        setError("La recherche a échoué. Réessaie dans un instant.");
        return;
      }
      const json = (await response.json()) as SearchResponse;
      setData(json);
    } catch {
      setError("La recherche a échoué. Réessaie dans un instant.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Track finder</h1>
      <SearchForm onSearch={handleSearch} isLoading={isLoading} />

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {data && (
        <div className="mt-8 grid gap-8">
          <section>
            <h2 className="mb-3 text-lg font-medium">Où acheter</h2>
            <AchatSection results={data.purchase} />
          </section>
          <section>
            <h2 className="mb-3 text-lg font-medium">Metadata</h2>
            <MetadataSection metadata={data.metadata} />
          </section>
        </div>
      )}

      <Disclaimer />
    </main>
  );
}
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open `http://localhost:3000`, search for a real track (e.g. "Robert Hood Minus"), confirm the purchase links section and metadata section both render without errors, and the disclaimer is visible at the bottom.

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add components/SearchForm.tsx components/AchatSection.tsx components/MetadataSection.tsx components/Disclaimer.tsx app/page.tsx
git commit -m "feat: search UI with separated purchase-links and metadata sections"
```

---

### Task 11: Manual smoke-test script

**Files:**
- Create: `scripts/smoke-test.mjs`

**Interfaces:**
- Consumes: a running local or deployed instance of the app (via `BASE_URL` env var).

- [ ] **Step 1: Write the script**

Create `scripts/smoke-test.mjs`:
```js
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const QUERY = "Robert Hood Minus";

const response = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(QUERY)}`);
if (!response.ok) {
  console.error(`FAIL: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const data = await response.json();
console.log(`Query: "${QUERY}"`);
for (const result of data.purchase) {
  console.log(`  ${result.platform}: ${result.status}${result.purchaseUrl ? ` -> ${result.purchaseUrl}` : ""}`);
}
console.log("Metadata:", JSON.stringify(data.metadata, null, 2));
```

- [ ] **Step 2: Run it manually against the local dev server**

Run: `npm run dev` (in one terminal), then in another: `node scripts/smoke-test.mjs`
Expected: prints a status line per platform (found/not_found/error) and the metadata block. Read through it — this is a manual check, not an automated pass/fail gate; the goal is to visually confirm the 5 adapters still behave against the real sites, since none of this is covered by CI.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-test.mjs
git commit -m "chore: manual smoke-test script against real platforms"
```

---

### Task 12: Deploy to Vercel

**Files:**
- Create: `vercel.json` (only if a non-default setting is needed — start without one)

**Interfaces:**
- Consumes: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (Task 9).

- [ ] **Step 1: Push the repo to a remote**

Create a new empty GitHub repo (via `gh repo create`, or manually on github.com), then:
```bash
git remote add origin <repo-url>
git push -u origin master
```

- [ ] **Step 2: Set up the Upstash Redis database**

Create a free Upstash Redis database (via the Upstash dashboard, or the Vercel Marketplace integration if available), and copy its REST URL and token.

- [ ] **Step 3: Set Vercel environment variables**

Run:
```bash
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production
```
Paste the real values when prompted.

- [ ] **Step 4: Deploy**

Run:
```bash
vercel --prod
```

- [ ] **Step 5: Verify the production deployment**

Run: `BASE_URL=<the deployed URL> node scripts/smoke-test.mjs`
Expected: same output as the local run in Task 11 — if a scraped adapter behaves differently in production than locally (e.g. Vercel's IP range gets blocked where a home IP didn't), note it, it is not a blocker for this plan but should be flagged back for follow-up.

- [ ] **Step 6: Commit any deployment config changes**

```bash
git add vercel.json 2>/dev/null || true
git commit -m "chore: deployment config" --allow-empty-message -m "deploy to Vercel" 2>/dev/null || true
```

---

## Self-review notes

- **Spec coverage:** all design.md sections map to tasks — architecture (Tasks 1, 8), 5 providers (Tasks 3-7), two-section UI (Task 10), error handling incl. not_found/error distinction and cache (Task 8), rate limiting (Task 9), disclaimer (Task 10), tests (all tasks), deploy (Task 12).
- **Verified vs. inferred:** Apple Music, Traxsource, and Beatport adapters are built from real, captured 2026-07-09 data — high confidence. Bandcamp and Amazon Music adapters are deliberately structured as spike-first (capture → inspect → implement) because their real markup is not yet known and Amazon in particular may not be scrapable at all with a headless browser — this is flagged, not hidden.
- **Type consistency:** `ProviderResult`/`Provider` (Task 2) used identically across Tasks 3-10; `AggregatedMetadata` shape (Task 8) matches what `MetadataSection` (Task 10) consumes.
