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
    route: vi.fn().mockResolvedValue(undefined),
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

  it("blocks images/fonts/media/stylesheets but allows other resource types", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    const page = makePage("<html>ok</html>");
    context.newPage.mockResolvedValue(page);
    launchMock.mockResolvedValue(browser);

    await fetchHtmlViaBrowser("https://example.com");

    expect(context.route).toHaveBeenCalledWith("**/*", expect.any(Function));
    const handler = context.route.mock.calls[0][1];

    const abort = vi.fn();
    const continue_ = vi.fn();
    for (const resourceType of ["image", "font", "media", "stylesheet"]) {
      abort.mockClear();
      continue_.mockClear();
      handler({ request: () => ({ resourceType: () => resourceType }), abort, continue: continue_ });
      expect(abort).toHaveBeenCalled();
      expect(continue_).not.toHaveBeenCalled();
    }
    for (const resourceType of ["document", "script", "xhr", "fetch"]) {
      abort.mockClear();
      continue_.mockClear();
      handler({ request: () => ({ resourceType: () => resourceType }), abort, continue: continue_ });
      expect(continue_).toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();
    }
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

  it("retries once with a fresh browser when the shared browser crashes mid-call, and still returns the result", async () => {
    // Regression (confirmed live 2026-07-10): the single shared Chromium
    // process crashed mid-navigation under concurrent load ("Target page,
    // context or browser has been closed"), taking every provider racing
    // that same browser down with it. A crash detected mid-call must
    // relaunch and retry once, not just leave the next unrelated call to
    // pick up the pieces.
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const first = makeBrowser();
    const crashingPage = makePage("<html>unused</html>");
    // Regression (confirmed live 2026-07-10): isConnected() does NOT
    // reliably flip to false when the shared browser dies this way — the
    // retry must trigger off Playwright's own error message instead, so
    // isConnected() is deliberately left reporting true here.
    crashingPage.goto.mockRejectedValue(
      new Error("page.goto: Target page, context or browser has been closed")
    );
    first.context.newPage.mockResolvedValue(crashingPage);

    const second = makeBrowser();
    second.context.newPage.mockResolvedValue(makePage("<html>recovered</html>"));

    launchMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBe("<html>recovered</html>");
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the browser is still alive and the failure is an ordinary navigation error", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    const page = makePage("<html>unused</html>");
    page.goto.mockRejectedValue(new Error("page.goto: Timeout 10000ms exceeded"));
    context.newPage.mockResolvedValue(page);
    launchMock.mockResolvedValue(browser);

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBeNull();
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry also fails against the freshly relaunched browser", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const first = makeBrowser();
    const crashingPage = makePage("<html>unused</html>");
    crashingPage.goto.mockRejectedValue(
      new Error("browserContext.newPage: Target page, context or browser has been closed")
    );
    first.context.newPage.mockResolvedValue(crashingPage);

    const second = makeBrowser();
    const stillFailingPage = makePage("<html>unused2</html>");
    stillFailingPage.goto.mockRejectedValue(new Error("timeout"));
    second.context.newPage.mockResolvedValue(stillFailingPage);

    launchMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);

    const result = await fetchHtmlViaBrowser("https://example.com");

    expect(result).toBeNull();
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it("queues page opens beyond the concurrency cap and releases the slot when one finishes", async () => {
    const fetchHtmlViaBrowser = await freshFetchHtmlViaBrowser();
    const { browser, context } = makeBrowser();
    launchMock.mockResolvedValue(browser);

    const pages = [makePage("<html>1</html>"), makePage("<html>2</html>")];
    let resolveFirstGoto: () => void = () => {};
    pages[0].goto.mockImplementation(
      () => new Promise<void>((resolve) => (resolveFirstGoto = resolve))
    );
    // pages[1] (the queued 2nd call) resolves immediately once it gets a slot.

    let callIndex = 0;
    context.newPage.mockImplementation(() => Promise.resolve(pages[callIndex++]));

    const p1 = fetchHtmlViaBrowser("https://example.com/1");
    const p2 = fetchHtmlViaBrowser("https://example.com/2");

    // MAX_CONCURRENT_PAGES = 1 — the 2nd call's newPage() should not have
    // been reached yet.
    await vi.waitFor(() => expect(context.newPage).toHaveBeenCalledTimes(1));
    expect(context.newPage).not.toHaveBeenCalledTimes(2);

    resolveFirstGoto();
    await p1;
    await vi.waitFor(() => expect(context.newPage).toHaveBeenCalledTimes(2));

    const result2 = await p2;
    expect(result2).toBe("<html>2</html>");

  });
});
