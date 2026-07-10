import { describe, it, expect, vi, afterEach } from "vitest";

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

const { fetchHtmlViaBrowser } = await import("../lib/browser-fetch");

function makeBrowser(html: string) {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(html),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    addInitScript: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, page, context };
}

describe("fetchHtmlViaBrowser", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the page's HTML after navigating", async () => {
    const { browser } = makeBrowser("<html>ok</html>");
    launchMock.mockResolvedValue(browser);

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBe("<html>ok</html>");
    expect(browser.close).toHaveBeenCalled();
  });

  it("waits the requested amount after navigation when postGotoWaitMs is set", async () => {
    const { browser, page } = makeBrowser("<html>ok</html>");
    launchMock.mockResolvedValue(browser);

    await fetchHtmlViaBrowser("https://example.com", { postGotoWaitMs: 2500 });

    expect(page.waitForTimeout).toHaveBeenCalledWith(2500);
  });

  it("skips waitForTimeout when postGotoWaitMs is omitted", async () => {
    const { browser, page } = makeBrowser("<html>ok</html>");
    launchMock.mockResolvedValue(browser);

    await fetchHtmlViaBrowser("https://example.com");

    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("returns null when the browser fails to launch", async () => {
    launchMock.mockRejectedValue(new Error("launch failed"));

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBeNull();
  });

  it("returns null when navigation throws (e.g. timeout)", async () => {
    const { browser, page } = makeBrowser("<html>ok</html>");
    page.goto.mockRejectedValue(new Error("timeout"));
    launchMock.mockResolvedValue(browser);

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBeNull();
    expect(browser.close).toHaveBeenCalled();
  });
});
