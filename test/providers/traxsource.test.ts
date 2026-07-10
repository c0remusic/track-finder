import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = readFileSync(
  join(__dirname, "../fixtures/traxsource-search.html"),
  "utf-8"
);

vi.mock("../../lib/browser-fetch", () => ({
  fetchHtmlViaBrowser: vi.fn(),
}));

const { fetchHtmlViaBrowser } = await import("../../lib/browser-fetch");
const { traxsourceProvider } = await import("../../lib/providers/traxsource");
const mockBrowserFetch = vi.mocked(fetchHtmlViaBrowser);

describe("traxsourceProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("parses the first result row from the fixture", async () => {
    mockBrowserFetch.mockResolvedValue(fixture);

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
    mockBrowserFetch.mockResolvedValue(
      "<html><body><div class=\"search-list-cont\"></div></body></html>"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `<html><body><div id="search"></div></body></html>`,
      })
    );

    const result = await traxsourceProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });

  it("returns error when the browser fetch fails", async () => {
    mockBrowserFetch.mockResolvedValue(null);

    const result = await traxsourceProvider.search("anything");

    expect(result).toEqual({ platform: "Traxsource", status: "error" });
  });

  it("falls back to Google when the direct search has zero rows, and parses the product page", async () => {
    const productFixture = readFileSync(
      join(__dirname, "../fixtures/traxsource-product.html"),
      "utf-8"
    );
    const emptySearchHtml = "<html><body><div class=\"search-list-cont\"></div></body></html>";
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.traxsource.com/track/1809532/minus?srsltid=abc"><h3>Robert Hood - Minus [Tresor Records]</h3></a></div></body></html>`;

    mockBrowserFetch.mockImplementation((url: string) => {
      if (url.startsWith("https://www.traxsource.com/search")) {
        return Promise.resolve(emptySearchHtml);
      }
      if (url === "https://www.traxsource.com/track/1809532/minus") {
        return Promise.resolve(productFixture);
      }
      throw new Error(`unexpected browser fetch: ${url}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => googleResultsHtml })
    );

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

    mockBrowserFetch.mockResolvedValue(emptySearchHtml);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => emptyGoogleHtml })
    );

    const result = await traxsourceProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });

  it("stays not_found (never error) when the Google-found product page fails to fetch", async () => {
    const emptySearchHtml = "<html><body><div class=\"search-list-cont\"></div></body></html>";
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.traxsource.com/track/1809532/minus?srsltid=abc"><h3>Robert Hood - Minus [Tresor Records]</h3></a></div></body></html>`;

    mockBrowserFetch.mockImplementation((url: string) => {
      if (url.startsWith("https://www.traxsource.com/search")) {
        return Promise.resolve(emptySearchHtml);
      }
      return Promise.resolve(null);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => googleResultsHtml })
    );

    const result = await traxsourceProvider.search("Robert Hood Minus");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });
});
