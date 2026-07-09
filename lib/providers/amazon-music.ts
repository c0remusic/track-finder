import * as cheerio from "cheerio";
import { chromium as playwrightCore } from "playwright-core";
import chromium from "@sparticuz/chromium";
import type { Provider, ProviderResult } from "./types";

const AMAZON_SEARCH_URL = "https://www.amazon.com/s";

// A plain `fetch` (curl and Node's fetch both tried) gets served an Akamai
// bot-management interstitial challenge that requires executing JS — a real
// browser is required. Even Playwright gets blocked intermittently; a fresh
// `newContext()` per call and a `waitForTimeout` after `goto` were needed to
// get a real result during implementation (see docs/superpowers/plans/
// 2026-07-09-track-finder-mvp.md, Task 7).
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const amazonMusicProvider: Provider = {
  name: "Amazon Music",

  async search(query: string): Promise<ProviderResult> {
    try {
      const browser = await playwrightCore.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
      try {
        const context = await browser.newContext({
          userAgent: USER_AGENT,
          locale: "en-US",
        });
        const page = await context.newPage();
        const url = `${AMAZON_SEARCH_URL}?k=${encodeURIComponent(query)}&i=digital-music`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(5000);
        const html = await page.content();

        const $ = cheerio.load(html);
        const firstResult = $('div[data-component-type="s-search-result"]').first();
        if (firstResult.length === 0) {
          return { platform: "Amazon Music", status: "not_found" };
        }

        const asin = firstResult.attr("data-asin");
        const title = firstResult.find('[data-cy="title-recipe"] h2').first().text().trim();
        const artist = firstResult
          .find('[data-cy="title-recipe"] .a-row.a-color-secondary .a-row span')
          .last()
          .text()
          .trim();
        const cover = firstResult.find("img.s-image").first().attr("src");

        if (!asin || !title) {
          return { platform: "Amazon Music", status: "not_found" };
        }

        return {
          platform: "Amazon Music",
          status: "found",
          purchaseUrl: `https://www.amazon.com/dp/${asin}`,
          coverUrl: cover,
          matchedArtist: artist || undefined,
          matchedTitle: title,
        };
      } finally {
        await browser.close();
      }
    } catch {
      return { platform: "Amazon Music", status: "error" };
    }
  },
};
