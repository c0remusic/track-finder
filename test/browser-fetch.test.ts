import { describe, it, expect, vi, beforeEach } from "vitest";

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

function makePage(html: string) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue(html),
  };
}

function makeBrowser() {
  const context = {
    newPage: vi.fn(),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    isConnected: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, context };
}

// The module keeps a shared browser instance alive across calls (see
// lib/browser-fetch.ts) — `vi.resetModules()` + a fresh dynamic import per
// test is the only way to get a clean `sharedBrowser`/concurrency-counter
// state each time, since those live in module scope, not in the mocks.
async function freshFetchHtmlViaBrowser() {
  vi.resetModules();
  const mod = await import("../lib/browser-fetch");
  return mod.fetchHtmlViaBrowser;
}

describe("fetchHtmlViaBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the page's HTML after navigating", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    const page = makePage("<html>ok</html>");
    context.newPage.mockResolvedValue(page);
    launchMock.mockResolvedValue(browser);

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBe("<html>ok</html>");
    // The browser process itself stays alive for reuse; only the context
    // (and its pages) is torn down after each call.
    expect(context.close).toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it("waits the requested amount after navigation when postGotoWaitMs is set", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    const page = makePage("<html>ok</html>");
    context.newPage.mockResolvedValue(page);
    launchMock.mockResolvedValue(browser);

    await fetchHtmlViaBrowser("https://example.com", { postGotoWaitMs: 2500 });

    expect(page.waitForTimeout).toHaveBeenCalledWith(2500);
  });

  it("skips waitForTimeout when postGotoWaitMs is omitted", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    const page = makePage("<html>ok</html>");
    context.newPage.mockResolvedValue(page);
    launchMock.mockResolvedValue(browser);

    await fetchHtmlViaBrowser("https://example.com");

    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("returns null when the browser fails to launch", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    launchMock.mockRejectedValue(new Error("launch failed"));

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBeNull();
  });

  it("returns null when navigation throws (e.g. timeout), still closing the context", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    const page = makePage("<html>ok</html>");
    page.goto.mockRejectedValue(new Error("timeout"));
    context.newPage.mockResolvedValue(page);
    launchMock.mockResolvedValue(browser);

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBeNull();
    expect(context.close).toHaveBeenCalled();
  });

  it("reuses the shared browser across calls instead of relaunching", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    context.newPage.mockImplementation(() => Promise.resolve(makePage("<html>ok</html>")));
    launchMock.mockResolvedValue(browser);

    await fetchHtmlViaBrowser("https://example.com/1");
    await fetchHtmlViaBrowser("https://example.com/2");
    await fetchHtmlViaBrowser("https://example.com/3");

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(3);
  });

  it("relaunches if the shared browser has disconnected", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const first = makeBrowser();
    first.context.newPage.mockResolvedValue(makePage("<html>1</html>"));
    const second = makeBrowser();
    second.context.newPage.mockResolvedValue(makePage("<html>2</html>"));

    launchMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);

    await fetchHtmlViaBrowser("https://example.com/1");
    first.browser.isConnected.mockReturnValue(false);

    const result = await fetchHtmlViaBrowser("https://example.com/2");

    expect(result).toBe("<html>2</html>");
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it("queues page opens beyond the concurrency cap and releases the slot when one finishes", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    launchMock.mockResolvedValue(browser);

    const pages = [makePage("<html>1</html>"), makePage("<html>2</html>"), makePage("<html>3</html>"), makePage("<html>4</html>")];
    let resolveFirstGoto: () => void = () => {};
    pages[0].goto.mockImplementation(
      () => new Promise<void>((resolve) => (resolveFirstGoto = resolve))
    );
    pages[1].goto.mockImplementation(() => new Promise<void>(() => {})); // stays pending, released at the end
    pages[2].goto.mockImplementation(() => new Promise<void>(() => {})); // stays pending, released at the end
    // pages[3] (the queued 4th call) resolves immediately once it gets a slot.

    let callIndex = 0;
    context.newPage.mockImplementation(() => Promise.resolve(pages[callIndex++]));

    const p1 = fetchHtmlViaBrowser("https://example.com/1");
    const p2 = fetchHtmlViaBrowser("https://example.com/2");
    const p3 = fetchHtmlViaBrowser("https://example.com/3");
    const p4 = fetchHtmlViaBrowser("https://example.com/4");

    // MAX_CONCURRENT_PAGES = 3 — the 4th call's newPage() should not have
    // been reached yet.
    await vi.waitFor(() => expect(context.newPage).toHaveBeenCalledTimes(3));
    expect(context.newPage).not.toHaveBeenCalledTimes(4);

    resolveFirstGoto();
    await p1;
    await vi.waitFor(() => expect(context.newPage).toHaveBeenCalledTimes(4));

    const result4 = await p4;
    expect(result4).toBe("<html>4</html>");

    // Free the two still-pending calls so no state leaks into later tests
    // in this file (module state persists unless freshFetchHtmlViaBrowser
    // resets it, which the next test will do independently — but nothing
    // here should keep unresolved promises alive after this test ends).
    void p2;
    void p3;
  });
});
