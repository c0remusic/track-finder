import { chromium as playwrightCore, type Browser } from "playwright-core";
import sparticuzChromium from "@sparticuz/chromium";

// Cloudflare/Akamai-class bot management fingerprints both the TLS handshake
// (undici's `fetch` gets a "Just a moment..." challenge even with a browser
// User-Agent, while curl/a real browser passes with identical headers) and
// headless-automation signals (a headless browser can get challenged where
// the same browser headed does not) — verified live (2026-07-10). Neither
// bypass is guaranteed on every request; this reduces the failure rate, it
// doesn't eliminate it (see docs/superpowers/changes/
// 2026-07-10-playwright-cloudflare-bypass/design.md).
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// `--disable-blink-features=AutomationControlled` plus hiding
// `navigator.webdriver` are the two cheapest, most commonly effective
// headless-detection countermeasures — not a full stealth suite, just the
// low-cost baseline.
const ANTI_DETECTION_ARGS = ["--disable-blink-features=AutomationControlled"];

// A single search can trigger several providers' Playwright fallbacks at
// once (Beatport, Traxsource, Bandcamp, Amazon Music all go through this
// module) — without a cap, a query that fails everywhere can spin up 6-8
// concurrent Chromium instances, which starves the event loop badly enough
// that setTimeout-based timeouts fire late too (verified live 2026-07-10:
// a single request took 24s wall-clock and 4 providers all mis-reported
// "error" instead of a clean "not_found", despite each having an 18s
// budget). Queueing extra launches behind a small concurrency cap keeps
// each running browser's CPU/memory share high enough to behave
// predictably, at the cost of some queued providers waiting longer.
const MAX_CONCURRENT_BROWSERS = 2;
let activeBrowsers = 0;
const browserSlotWaiters: (() => void)[] = [];

function acquireBrowserSlot(): Promise<void> {
  if (activeBrowsers < MAX_CONCURRENT_BROWSERS) {
    activeBrowsers++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    browserSlotWaiters.push(() => {
      activeBrowsers++;
      resolve();
    });
  });
}

function releaseBrowserSlot(): void {
  activeBrowsers--;
  browserSlotWaiters.shift()?.();
}

async function launchBrowser(): Promise<Browser> {
  // @sparticuz/chromium bundles a Chromium binary built for AWS Lambda's
  // Amazon Linux runtime (which Vercel's serverless functions also run on)
  // — it doesn't exist as a real executable on a local dev machine
  // (verified live: `spawn ...\Temp\chromium ENOENT` on Windows). Outside
  // Vercel, launch the system's installed Edge/Chrome via playwright-core's
  // `channel` option instead — no extra binary to download or bundle.
  if (process.env.VERCEL) {
    return playwrightCore.launch({
      args: [...sparticuzChromium.args, ...ANTI_DETECTION_ARGS],
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }
  return playwrightCore.launch({
    channel: "msedge",
    headless: true,
    args: ANTI_DETECTION_ARGS,
  });
}

// Fetches a URL's rendered HTML through a real Chromium instance instead of
// `fetch`, to survive bot detection that a plain HTTP request can't get
// past. Never throws — any failure (browser launch, navigation, timeout)
// resolves to `null`; callers decide what that means for their own status
// semantics.
export async function fetchHtmlViaBrowser(
  url: string,
  opts: { gotoTimeoutMs?: number; postGotoWaitMs?: number } = {}
): Promise<string | null> {
  const { gotoTimeoutMs = 10000, postGotoWaitMs = 0 } = opts;

  await acquireBrowserSlot();
  try {
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ userAgent: USER_AGENT, locale: "en-US" });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
      if (postGotoWaitMs > 0) await page.waitForTimeout(postGotoWaitMs);
      return await page.content();
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  } finally {
    releaseBrowserSlot();
  }
}
