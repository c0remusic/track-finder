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
// Lowered to 1 (2026-07-10): 3, then 2, concurrent pages against the shared
// `--single-process` Chromium (the @sparticuz/chromium default, chosen for
// its own lower memory footprint) both still crashed mid-navigation under
// real concurrent load ("Target page, context or browser has been closed"),
// even after ruling out a playwright-core/@sparticuz/chromium version
// mismatch as the cause (pinned to a matched pair, same crash persisted
// unchanged) and even against a freshly relaunched browser. `--single-
// process` runs the browser and every renderer in one OS process/thread
// pool — inherently more fragile under ANY concurrent page creation, not
// just at high counts. Fully serializing page opens is the next real test
// of that theory before concluding this needs a paid-tier memory bump.
const MAX_CONCURRENT_PAGES = 1;
let activePages = 0;
const pageSlotWaiters: (() => void)[] = [];

// If the caller's signal aborts while still queued for a page slot, drop out
// of the queue immediately instead of waiting to be granted a slot the
// caller no longer needs — otherwise an orchestrator-abandoned request
// (route.ts's per-provider timeout) still occupies a queue position and
// delays every other provider's page slot behind it.
function acquirePageSlot(signal?: AbortSignal): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = () => {
      activePages++;
      resolve();
    };
    pageSlotWaiters.push(waiter);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          const idx = pageSlotWaiters.indexOf(waiter);
          // If the waiter already fired (idx === -1), the slot was granted
          // right as the abort landed — too late to cancel the wait, the
          // caller's own post-acquire signal check handles that case.
          if (idx !== -1) {
            pageSlotWaiters.splice(idx, 1);
            reject(new Error("aborted-while-queued"));
          }
        },
        { once: true }
      );
    }
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
    // @sparticuz/chromium's default args include --single-process, chosen
    // to minimize Lambda memory footprint — but it runs the browser and
    // every renderer in one OS process/thread pool, which is inherently
    // more crash-prone than Chromium's normal multi-process architecture.
    // Confirmed live 2026-07-10: even with page concurrency fully
    // serialized to 1, the shared browser still crashed with "Target page,
    // context or browser has been closed" at newPage/goto/waitForTimeout.
    // Vercel Hobby's fixed 2GB function memory (not the tight ceiling
    // originally assumed) should have headroom for normal multi-process
    // Chromium, so removing this flag trades some of that memory margin
    // for the stability multi-process mode is actually built for.
    const args = sparticuzChromium.args.filter((arg) => arg !== "--single-process");
    return playwrightCore.launch({
      args: [...args, ...ANTI_DETECTION_ARGS],
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

// Playwright's own message for "the browser/context this call belongs to
// died" — distinct from ordinary navigation failures (timeouts, DNS,
// bot-block challenges), which throw with different messages entirely.
function isSharedBrowserClosedError(err: unknown): boolean {
  return err instanceof Error && /Target page, context or browser has been closed/.test(err.message);
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
  postGotoWaitMs: number,
  signal?: AbortSignal
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
    const navigation = (async () => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
      if (postGotoWaitMs > 0) await page.waitForTimeout(postGotoWaitMs);
      return await page.content();
    })();

    if (!signal) return await navigation;

    // Once the caller aborts, don't wait for the navigation's own
    // `gotoTimeoutMs` (up to 20s) — race it against the abort and let the
    // outer `finally` close the context immediately, freeing the page slot
    // for the next queued provider. The orphaned navigation keeps running
    // until it settles on its own; nothing awaits it further, so it can't
    // throw an unhandled rejection.
    navigation.catch(() => {});
    return await Promise.race([
      navigation,
      new Promise<string>((_, reject) => {
        if (signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    ]);
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
  opts: { gotoTimeoutMs?: number; postGotoWaitMs?: number; signal?: AbortSignal } = {}
): Promise<string | null> {
  const { gotoTimeoutMs = 10000, postGotoWaitMs = 0, signal } = opts;

  if (signal?.aborted) return null;

  try {
    await acquirePageSlot(signal);
  } catch {
    // Aborted while queued for a page slot — never held one, nothing to
    // release.
    return null;
  }
  try {
    if (signal?.aborted) return null;
    try {
      return await fetchOnce(url, gotoTimeoutMs, postGotoWaitMs, signal);
    } catch (err) {
      // The shared Chromium process can crash mid-request (confirmed live
      // 2026-07-10: "Target page, context or browser has been closed" at
      // newPage/goto/waitForTimeout) — every provider mid-flight against
      // that browser fails together unless the dead reference is dropped
      // and a fresh one launched. `sharedBrowser.isConnected()` does NOT
      // reliably reflect this crash — confirmed live that it kept
      // reporting connected while every subsequent provider in the same
      // request hit the identical error, which meant this retry never
      // actually fired in production despite looking correct. Detecting
      // the crash from Playwright's own error message instead is the
      // reliable signal; an ordinary navigation failure (real bot-block,
      // real timeout) has a different message and isn't retried, so this
      // doesn't add latency to the common case.
      if (isSharedBrowserClosedError(err)) {
        sharedBrowser = null;
        if (signal?.aborted) return null;
        try {
          return await fetchOnce(url, gotoTimeoutMs, postGotoWaitMs, signal);
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
