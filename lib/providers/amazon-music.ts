import * as cheerio from "cheerio";
import { fetchHtmlViaBrowser } from "../browser-fetch";
import { isRelevantMatch } from "../relevance";
import type { Provider, ProviderResult } from "./types";

const AMAZON_SEARCH_URL = "https://www.amazon.com/s";

export const amazonMusicProvider: Provider = {
  name: "Amazon Music",

  async search(query: string, signal?: AbortSignal): Promise<ProviderResult> {
    const url = `${AMAZON_SEARCH_URL}?k=${encodeURIComponent(query)}&i=digital-music`;
    // Amazon's Akamai bot-management interstitial needs a beat after
    // `domcontentloaded` to clear before the real result markup is present —
    // 2500ms leaves headroom inside the orchestrator's 15s budget for this
    // provider (see route.ts's per-provider timeout overrides).
    const html = await fetchHtmlViaBrowser(url, {
      gotoTimeoutMs: 20000,
      postGotoWaitMs: 2500,
      signal,
    });
    if (!html) return { platform: amazonMusicProvider.name, status: "error" };

    const $ = cheerio.load(html);
    const firstResult = $('div[data-component-type="s-search-result"]').first();
    if (firstResult.length === 0) {
      return { platform: amazonMusicProvider.name, status: "not_found" };
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
      return { platform: amazonMusicProvider.name, status: "not_found" };
    }

    if (!isRelevantMatch(query, `${artist} ${title}`)) {
      return { platform: amazonMusicProvider.name, status: "not_found" };
    }

    return {
      platform: amazonMusicProvider.name,
      status: "found",
      purchaseUrl: `https://www.amazon.com/dp/${asin}`,
      coverUrl: cover,
      matchedArtist: artist || undefined,
      matchedTitle: title,
    };
  },
};
