import { chromium as playwrightCore, type Browser } from "playwright-core";
import sparticuzChromium from "@sparticuz/chromium";

// playwright-core and @sparticuz/chromium are PINNED (exact versions, no
// caret) to 1.56.1 / 141.0.0 in package.json, not incidental. Root cause,
// confirmed live 2026-07-10: playwright-core 1.57+ launches "Chrome for
// Testing" / chrome-headless-shell builds instead of vanilla open-source
// Chromium — a documented breaking change (microsoft/playwright#38489,
// reports of 20GB+ memory per instance and crashes under normal load).
// @sparticuz/chromium bundles vanilla open-source Chromium, built for low
// Lambda memory footprints, not Chrome for Testing. Running the two
// mismatched (playwright-core 1.61.1 + @sparticuz/chromium 149.0.0) meant
// every real page load crashed almost immediately in production — "Target
// page, context or browser has been closed" mid-navigation, independent of
// concurrency or memory tuning (both were tried first and neither helped,
// which is what pointed at a binary/protocol mismatch instead of resource
// pressure). 1.56.1 is the last playwright-core release before the switch;
// 141.0.0 is the @sparticuz/chromium release bundling the matching
// Chromium 141 build. Bumping either package requires re-verifying this
// pairing live, not just checking semver ranges.

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

// A single search can call this module several times (Beatport, Traxsource,
// Bandcamp and Amazon Music can each need 1-3 browser round trips). Launching
// a fresh Chromium *process* per call was the dominant cost (1-3s each) and,
// worse, the earlier version also closed it after every call — verified live
// 2026-07-10 that this made 4+ providers spinning up 6-8 concurrent full
// browser processes starve Node's event loop badly enough that orchestrator
// timeouts fired late. Keeping ONE browser process alive for the life of
// this module (a warm Lambda container, or the whole `next dev` process
// locally) and opening a lightweight context+page per call instead cuts
// nearly all of that cost: only the very first call in a cold start pays for
// a real launch.
let sharedBrowser: Browser | null = null;
let sharedBrowserPromise: Promise<Browser> | null = null;

async function getSharedBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = launchBrowser()
      .then((browser) => {
        sharedBrowser = browser;
        return browser;
      })
      .finally(() => {
        sharedBrowserPromise = null;
      });
  }
  return sharedBrowserPromise;
}

// Concurrent *pages* in the shared browser are still capped — a page is far
// cheaper than a whole browser process, but Chromium still spawns a
// renderer per page, so an unbounded burst (e.g. every provider's fallback
// triggering at once) could still contend for CPU. The cap is looser than
// the old per-browser-process limit since the unit is cheaper now.
//
// Lowered from 3 to 2 (2026-07-10): confirmed live in production that 3
// concurrent pages against the shared `--single-process` Chromium (the
// @sparticuz/chromium default, chosen for its own lower memory footprint)
// crashed the browser mid-navigation under real concurrent load — visible
// as "Target page, context or browser has been closed" errors that took
// every provider racing that same browser down together, sometimes
// surviving the one-retry recovery in fetchHtmlViaBrowser but crashing
// again on the retry too. This trades a bit of speed under heavy
// concurrency for not exceeding the serverless function's memory budget.
const MAX_CONCURRENT_PAGES = 2;
let activePages = 0;
const pageSlotWaiters: (() => void)[] = [];

function acquirePageSlot(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    pageSlotWaiters.push(() => {
      activePages++;
      resolve();
    });
  });
}

function releasePageSlot(): void {
  activePages--;
  pageSlotWaiters.shift()?.();
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

// Every page fetched here is scraped for embedded HTML/JSON data (Beatport's
// __NEXT_DATA__, Traxsource's DOM, Google's #search links) — never rendered
// or screenshotted, so images/fonts/media/stylesheets are pure overhead.
// Blocking them cuts Chromium's peak memory substantially (images are
// typically the single largest consumer on these product pages) and speeds
// up every navigation, which matters most on a memory-constrained
// serverless function where Chromium has been crashing under load
// (confirmed live 2026-07-10 — see the crash-retry logic below). Doesn't
// touch "script"/"xhr"/"fetch": Cloudflare's bot-challenge and Beatport's
// hydration both need JS to run.
const BLOCKED_RESOURCE_TYPES = new Set(["image", "font", "media", "stylesheet"]);

async function fetchOnce(
  url: string,
  gotoTimeoutMs: number,
  postGotoWaitMs: number
): Promise<string> {
  const browser = await getSharedBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT, locale: "en-US" });
  try {
    await context.route("**/*", (route) => {
      if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
    if (postGotoWaitMs > 0) await page.waitForTimeout(postGotoWaitMs);
    return await page.content();
  } finally {
    // The browser that owns this context may itself be the thing that just
    // crashed (see the retry below) — closing an already-dead context would
    // otherwise throw here and mask the real error from fetchOnce's own
    // try block.
    await context.close().catch(() => {});
  }
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

  await acquirePageSlot();
  try {
    try {
      return await fetchOnce(url, gotoTimeoutMs, postGotoWaitMs);
    } catch (err) {
      // TEMP DIAGNOSTIC (2026-07-10, round 3): pinning playwright-core to
      // 1.56.1 / @sparticuz/chromium to 141.0.0 (matched pre-Chrome-for-
      // Testing pair) did not resolve the failures either. Need to confirm
      // whether the error signature actually changed at all.
      console.error("[browser-fetch] fetchOnce failed (attempt 1)", url, err);
      // The shared Chromium process can crash mid-request (confirmed live
      // 2026-07-10: "Target page, context or browser has been closed"
      // mid-navigation/mid-wait) — every provider mid-flight against that
      // browser fails together unless the dead reference is dropped and a
      // fresh one launched. Retry exactly once, and only when the browser
      // is confirmed dead; an ordinary navigation failure (real bot-block,
      // real timeout) with the browser still alive isn't worth doubling
      // the latency for. Confirmed live 2026-07-10 that even the freshly
      // relaunched browser can crash again just as fast — this retry
      // recovers some cases but is not a full fix for what's most likely
      // a serverless function memory ceiling (see CLAUDE.md).
      if (sharedBrowser && !sharedBrowser.isConnected()) {
        sharedBrowser = null;
        try {
          return await fetchOnce(url, gotoTimeoutMs, postGotoWaitMs);
        } catch {
          return null;
        }
      }
      return null;
    }
  } finally {
    releasePageSlot();
  }
}
