import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const relevantHtml = readFileSync(
  join(__dirname, "../fixtures/google-search-relevant.html"),
  "utf-8"
);
const emptyHtml = readFileSync(
  join(__dirname, "../fixtures/google-search-empty.html"),
  "utf-8"
);
const isTrackUrl = (url: string) => /\/track\//.test(url);

vi.mock("../../lib/browser-fetch", () => ({
  fetchHtmlViaBrowser: vi.fn(),
}));

const { fetchHtmlViaBrowser } = await import("../../lib/browser-fetch");
const { findViaGoogle } = await import("../../lib/google-search");
const mockBrowserFetch = vi.mocked(fetchHtmlViaBrowser);

describe("findViaGoogle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns the first plausible+relevant URL from page 1, query string stripped", async () => {
    mockBrowserFetch.mockResolvedValue(relevantHtml);

    const url = await findViaGoogle("Robert Hood Minus", "beatport.com/track", isTrackUrl);

    expect(url).toBe("https://www.beatport.com/track/minus/11595385");
  });

  it("only requests page 1 (MAX_PAGES=1 — each page is now a real browser launch)", async () => {
    mockBrowserFetch.mockResolvedValue(emptyHtml);

    const url = await findViaGoogle("asdkjaskdjaskdj", "beatport.com/track", isTrackUrl);

    expect(url).toBeNull();
    expect(mockBrowserFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null (never throws) when the browser fetch itself fails", async () => {
    mockBrowserFetch.mockResolvedValue(null);

    const url = await findViaGoogle("anything", "beatport.com/track", isTrackUrl);

    expect(url).toBeNull();
  });

  it("rejects a plausible-URL candidate whose title isn't relevant", async () => {
    // relevantHtml's 2 results are both Robert Hood tracks; a completely
    // different query must not match either, so this stays null after the
    // single page attempted.
    mockBrowserFetch.mockResolvedValue(relevantHtml);

    const url = await findViaGoogle("Sven Dose All In", "beatport.com/track", isTrackUrl);

    expect(url).toBeNull();
    expect(mockBrowserFetch).toHaveBeenCalledTimes(1);
  });

  it("accepts a candidate from the correct domain (regression: www subdomain)", async () => {
    // Existing test with www.beatport.com must still pass — this is the
    // main regression check that hostMatches allows subdomains.
    mockBrowserFetch.mockResolvedValue(relevantHtml);

    const url = await findViaGoogle("Robert Hood Minus", "beatport.com/track", isTrackUrl);

    expect(url).toBe("https://www.beatport.com/track/minus/11595385");
  });

  it("rejects a candidate from a different host even if path and title match", async () => {
    // Construct a synthetic fixture with a result from evil-mirror.example
    // that has the same path pattern (/track/...) and a matching title.
    // This candidate should be rejected by hostMatches, even though it
    // passes isPlausibleUrl (path matches /\/track\//) and isRelevantMatch
    // (title is about Robert Hood).
    const evilMirrorHtml = `<!DOCTYPE html>
<html><body>
<div id="search">
<div class="g">
  <a href="https://evil-mirror.example/track/minus/1">
    <h3>Robert Hood - Minus (Original Mix) [Tresor Records]</h3>
  </a>
</div>
</div>
</body></html>`;

    mockBrowserFetch.mockResolvedValue(evilMirrorHtml);

    const url = await findViaGoogle("Robert Hood Minus", "beatport.com/track", isTrackUrl);

    // Should reject the evil-mirror result and return null.
    expect(url).toBeNull();
    expect(mockBrowserFetch).toHaveBeenCalledTimes(1);
  });
});
