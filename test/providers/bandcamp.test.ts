import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../lib/browser-fetch", () => ({
  fetchHtmlViaBrowser: vi.fn(),
}));

const { fetchHtmlViaBrowser } = await import("../../lib/browser-fetch");
const { bandcampProvider } = await import("../../lib/providers/bandcamp");
const mockBrowserFetch = vi.mocked(fetchHtmlViaBrowser);

describe("bandcampProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("maps the first track result to ProviderResult", async () => {
    const fakeResponse = {
      auto: {
        results: [
          {
            type: "t",
            name: "Minus",
            band_name: "Robert Hood",
            item_url_path: "https://roberthood.bandcamp.com/track/minus",
            img: "https://f4.bcbits.com/img/0696091404_3.jpg",
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => fakeResponse })
    );

    const result = await bandcampProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Bandcamp",
      status: "found",
      purchaseUrl: "https://roberthood.bandcamp.com/track/minus",
      coverUrl: "https://f4.bcbits.com/img/0696091404_3.jpg",
      matchedArtist: "Robert Hood",
      matchedTitle: "Minus",
    });
  });

  it("returns error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await bandcampProvider.search("anything");

    expect(result).toEqual({ platform: "Bandcamp", status: "error" });
  });

  it("returns error when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    const result = await bandcampProvider.search("anything");

    expect(result).toEqual({ platform: "Bandcamp", status: "error" });
  });

  it("falls back to Google when the direct search has no track-type results, and parses the product page", async () => {
    const emptyAutocomplete = { auto: { results: [{ type: "b", name: "Some Band" }] } };
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://ticon.bandcamp.com/track/monda-bone?srsltid=abc"><h3>Ticon - Monda Bone</h3></a></div></body></html>`;
    const productHtml = `<!DOCTYPE html><html><body><div data-tralbum="{&quot;artist&quot;:&quot;Ticon&quot;,&quot;current&quot;:{&quot;title&quot;:&quot;Monda Bone&quot;}}"></div></body></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith("https://bandcamp.com/api/bcsearch_public_api")) {
          return Promise.resolve({ ok: true, json: async () => emptyAutocomplete });
        }
        if (url === "https://ticon.bandcamp.com/track/monda-bone") {
          return Promise.resolve({ ok: true, text: async () => productHtml });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
    mockBrowserFetch.mockResolvedValue(googleResultsHtml);

    const result = await bandcampProvider.search("Mona Bone Ticon");

    expect(result).toEqual({
      platform: "Bandcamp",
      status: "found",
      purchaseUrl: "https://ticon.bandcamp.com/track/monda-bone",
      matchedArtist: "Ticon",
      matchedTitle: "Monda Bone",
    });
  });

  it("stays not_found (never error) when Google finds nothing either", async () => {
    const emptyAutocomplete = { auto: { results: [] } };
    const emptyGoogleHtml = `<!DOCTYPE html><html><body><div id="search"></div></body></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => emptyAutocomplete })
    );
    mockBrowserFetch.mockResolvedValue(emptyGoogleHtml);

    const result = await bandcampProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Bandcamp", status: "not_found" });
  });

  it("stays not_found (never error) when the Google-found product page fails to fetch", async () => {
    const emptyAutocomplete = { auto: { results: [] } };
    const googleResultsHtml = `<!DOCTYPE html><html><body><div id="search"><a href="https://ticon.bandcamp.com/track/monda-bone?srsltid=abc"><h3>Ticon - Monda Bone</h3></a></div></body></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith("https://bandcamp.com/api/bcsearch_public_api")) {
          return Promise.resolve({ ok: true, json: async () => emptyAutocomplete });
        }
        return Promise.resolve({ ok: false });
      })
    );
    mockBrowserFetch.mockResolvedValue(googleResultsHtml);

    const result = await bandcampProvider.search("Mona Bone Ticon");

    expect(result).toEqual({ platform: "Bandcamp", status: "not_found" });
  });
});
