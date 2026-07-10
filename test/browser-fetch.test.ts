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

  it("queues launches beyond the concurrency cap and releases the slot when one finishes", async () => {
    const first = makeBrowser("<html>1</html>");
    const second = makeBrowser("<html>2</html>");
    const third = makeBrowser("<html>3</html>");

    // Both left pending so this test controls exactly when each slot frees
    // up — must resolve both before the end, or the module-level
    // activeBrowsers/browserSlotWaiters state (shared across this whole
    // test file) leaks a permanently-held slot into later tests.
    let resolveFirstGoto: () => void = () => {};
    let resolveSecondGoto: () => void = () => {};
    first.page.goto.mockImplementation(
      () => new Promise<void>((resolve) => (resolveFirstGoto = resolve))
    );
    second.page.goto.mockImplementation(
      () => new Promise<void>((resolve) => (resolveSecondGoto = resolve))
    );

    launchMock
      .mockResolvedValueOnce(first.browser)
      .mockResolvedValueOnce(second.browser)
      .mockResolvedValueOnce(third.browser);

    const p1 = fetchHtmlViaBrowser("https://example.com/1");
    const p2 = fetchHtmlViaBrowser("https://example.com/2");
    const p3 = fetchHtmlViaBrowser("https://example.com/3");

    // Let the two allowed launches (MAX_CONCURRENT_BROWSERS = 2) start; the
    // third should still be queued, so launch() has only been called twice.
    // Each call chains several real awaits before reaching page.goto()
    // (acquireBrowserSlot -> launchBrowser -> newContext -> addInitScript ->
    // newPage -> goto), so poll rather than guess a fixed microtask-tick
    // count.
    await vi.waitFor(() => expect(launchMock).toHaveBeenCalledTimes(2));
    expect(launchMock).not.toHaveBeenCalledTimes(3);

    // Finishing the first call frees a slot for the queued third call.
    resolveFirstGoto();
    await p1;
    await vi.waitFor(() => expect(launchMock).toHaveBeenCalledTimes(3));

    const result3 = await p3;
    expect(result3).toBe("<html>3</html>");
    expect(third.browser.close).toHaveBeenCalled();

    // Free p2's slot too, so no state leaks into the next test.
    resolveSecondGoto();
    await p2;
  });
});
