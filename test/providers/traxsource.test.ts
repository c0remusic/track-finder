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

  it("returns not_found when no .trk-row is present and Google finds nothing", async () => {
    mockBrowserFetch.mockImplementation((url: string) => {
      if (url.startsWith("https://www.traxsource.com/search")) {
        return Promise.resolve("<html><body><div class=\"search-list-cont\"></div></body></html>");
      }
      return Promise.resolve(`<html><body><div id="search"></div></body></html>`);
    });

    const result = await traxsourceProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });

  it("falls back to Google (and returns not_found) when the browser fetch fails outright", async () => {
    mockBrowserFetch.mockResolvedValue(null);

    const result = await traxsourceProvider.search("anything");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
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
      if (url.startsWith("https://www.google.com/search")) {
        return Promise.resolve(googleResultsHtml);
      }
      if (url === "https://www.traxsource.com/track/1809532/minus") {
        return Promise.resolve(productFixture);
      }
      throw new Error(`unexpected browser fetch: ${url}`);
    });

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

  it("falls back to Google when the first row exists but isn't relevant (regression: irrelevant top result skipped Google entirely)", async () => {
    // Traxsource's own search ranks by its own signal, not query-token
    // overlap — an unrelated top row must not short-circuit the Google
    // fallback the way a fully-empty result list already correctly does.
    const irrelevantSearchHtml = `<html><body><div class="trk-row">
      <div class="trk-cell title"><a href="/track/999/unrelated">Totally Unrelated Track</a></div>
      <div class="trk-cell artists"><a>Someone Else</a></div>
    </div></body></html>`;
    const productFixture = readFileSync(
      join(__dirname, "../fixtures/traxsource-product.html"),
      "utf-8"
    );
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://www.traxsource.com/track/1809532/minus?srsltid=abc"><h3>Robert Hood - Minus [Tresor Records]</h3></a></div></body></html>`;

    mockBrowserFetch.mockImplementation((url: string) => {
      if (url.startsWith("https://www.traxsource.com/search")) {
        return Promise.resolve(irrelevantSearchHtml);
      }
      if (url.startsWith("https://www.google.com/search")) {
        return Promise.resolve(googleResultsHtml);
      }
      if (url === "https://www.traxsource.com/track/1809532/minus") {
        return Promise.resolve(productFixture);
      }
      throw new Error(`unexpected browser fetch: ${url}`);
    });

    const result = await traxsourceProvider.search("Robert Hood Minus");

    expect(result.status).toBe("found");
    expect(result).toMatchObject({ matchedTitle: "Minus", matchedArtist: "Robert Hood" });
  });

  it("stays not_found (never error) when Google finds nothing either", async () => {
    const emptySearchHtml = "<html><body><div class=\"search-list-cont\"></div></body></html>";
    const emptyGoogleHtml = `<!DOCTYPE html><html><body><div id="search"></div></body></html>`;

    mockBrowserFetch.mockImplementation((url: string) => {
      if (url.startsWith("https://www.traxsource.com/search")) {
        return Promise.resolve(emptySearchHtml);
      }
      return Promise.resolve(emptyGoogleHtml);
    });

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
      if (url.startsWith("https://www.google.com/search")) {
        return Promise.resolve(googleResultsHtml);
      }
      return Promise.resolve(null);
    });

    const result = await traxsourceProvider.search("Robert Hood Minus");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });
});
