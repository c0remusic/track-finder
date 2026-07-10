import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureHtml = readFileSync(
  path.join(__dirname, "../fixtures/amazon-music-search.html"),
  "utf-8"
);

vi.mock("../../lib/browser-fetch", () => ({
  fetchHtmlViaBrowser: vi.fn(),
}));

const { fetchHtmlViaBrowser } = await import("../../lib/browser-fetch");
const { amazonMusicProvider } = await import("../../lib/providers/amazon-music");
const mockBrowserFetch = vi.mocked(fetchHtmlViaBrowser);

describe("amazonMusicProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps the first search result to ProviderResult", async () => {
    mockBrowserFetch.mockResolvedValue(fixtureHtml);

    const result = await amazonMusicProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Amazon Music",
      status: "found",
      purchaseUrl: "https://www.amazon.com/dp/B09Z7CN4DC",
      coverUrl: "https://m.media-amazon.com/images/I/61yb-Lti4qL._AC_UY218_.jpg",
      matchedArtist: "Robert Hood",
      matchedTitle: "Minus",
    });
  });

  it("returns error when the browser fetch fails", async () => {
    mockBrowserFetch.mockResolvedValue(null);

    const result = await amazonMusicProvider.search("anything");

    expect(result).toEqual({ platform: "Amazon Music", status: "error" });
  });
});
