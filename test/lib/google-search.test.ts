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

  it("accepts a candidate from the correct domain (regression: www subdomain)", async () => {
    // Existing test with www.beatport.com must still pass — this is the
    // main regression check that hostMatches allows subdomains.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => relevantHtml })
    );

    const url = await findViaGoogle("Robert Hood Minus", "beatport.com/track", isTrackUrl);

    expect(url).toBe("https://www.beatport.com/track/minus/11595385");
  });

  it("rejects a candidate from a different host even if path and title match", async () => {
    // Construct a synthetic fixture with a result from evil-mirror.example
    // that has the same path pattern (/track/...) and a matching title.
    // This candidate should be rejected by hostMatches, even though it
    // passes isPlausibleUrl (path matches /\/track\//) and isRelevantMatch
    // (title is about Robert Hood). We fall through to page 2 (empty) and
    // return null.
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

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const isPage2 = url.includes("start=10");
      return Promise.resolve({
        ok: true,
        text: async () => (isPage2 ? emptyHtml : evilMirrorHtml),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const url = await findViaGoogle("Robert Hood Minus", "beatport.com/track", isTrackUrl);

    // Should reject the evil-mirror result and fall through to page 2 (empty)
    expect(url).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
