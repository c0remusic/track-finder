import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureHtml = readFileSync(
  path.join(__dirname, "../fixtures/amazon-music-search.html"),
  "utf-8"
);

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock("playwright-core", () => ({
  chromium: { launch: launchMock },
}));

vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: [],
    executablePath: vi.fn().mockResolvedValue("/mock/chromium"),
  },
}));

const { amazonMusicProvider } = await import("../../lib/providers/amazon-music");

function makeBrowser(html: string) {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(html),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return browser;
}

describe("amazonMusicProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps the first search result to ProviderResult", async () => {
    launchMock.mockResolvedValue(makeBrowser(fixtureHtml));

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

  it("returns error when Playwright throws", async () => {
    launchMock.mockRejectedValue(new Error("launch failed"));

    const result = await amazonMusicProvider.search("anything");

    expect(result).toEqual({ platform: "Amazon Music", status: "error" });
  });
});
