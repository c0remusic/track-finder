import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixtureData = readFileSync(
  join(__dirname, "../fixtures/beatport-search.json"),
  "utf-8"
);
const fixtureHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${fixtureData}</script></body></html>`;

vi.mock("../../lib/browser-fetch", () => ({
  fetchHtmlViaBrowser: vi.fn(),
}));

const { fetchHtmlViaBrowser } = await import("../../lib/browser-fetch");
const { beatportProvider } = await import("../../lib/providers/beatport");
const mockBrowserFetch = vi.mocked(fetchHtmlViaBrowser);

describe("beatportProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("parses the first track from the embedded __NEXT_DATA__ JSON", async () => {
    mockBrowserFetch.mockResolvedValue(fixtureHtml);

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
    mockBrowserFetch.mockResolvedValue(emptyHtml);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><body><div id="search"></div></body></html>`,
      })
    );

    const result = await beatportProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Beatport", status: "not_found" });
  });

  it("returns error when the browser fetch fails", async () => {
    mockBrowserFetch.mockResolvedValue(null);

    const result = await beatportProvider.search("anything");

    expect(result).toEqual({ platform: "Beatport", status: "error" });
  });

  it("falls back to Google when the direct search has zero tracks, and parses the product page", async () => {
    const productFixture = readFileSync(
      join(__dirname, "../fixtures/beatport-product.json"),
      "utf-8"
    );
    const productHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${productFixture}</script></body></html>`;
    const emptySearchHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[{"state":{"data":{"tracks":{"data":[]}}}}]}}}}</script></body></html>`;
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.beatport.com/track/minus/11595385?srsltid=abc"><h3>Robert Hood - Minus (Original Mix) [Tresor Records]</h3></a></div></body></html>`;

    mockBrowserFetch.mockImplementation((url: string) => {
      if (url.startsWith("https://www.beatport.com/search")) {
        return Promise.resolve(emptySearchHtml);
      }
      if (url === "https://www.beatport.com/track/minus/11595385") {
        return Promise.resolve(productHtml);
      }
      throw new Error(`unexpected browser fetch: ${url}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => googleResultsHtml })
    );

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

    mockBrowserFetch.mockResolvedValue(emptySearchHtml);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => emptyGoogleHtml })
    );

    const result = await beatportProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Beatport", status: "not_found" });
  });

  it("stays not_found (never error) when the Google-found product page fails to fetch", async () => {
    const emptySearchHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[{"state":{"data":{"tracks":{"data":[]}}}}]}}}}</script></body></html>`;
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.beatport.com/track/minus/11595385?srsltid=abc"><h3>Robert Hood - Minus (Original Mix) [Tresor Records]</h3></a></div></body></html>`;

    mockBrowserFetch.mockImplementation((url: string) => {
      if (url.startsWith("https://www.beatport.com/search")) {
        return Promise.resolve(emptySearchHtml);
      }
      return Promise.resolve(null);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => googleResultsHtml })
    );

    const result = await beatportProvider.search("Robert Hood Minus");

    expect(result).toEqual({ platform: "Beatport", status: "not_found" });
  });
});
