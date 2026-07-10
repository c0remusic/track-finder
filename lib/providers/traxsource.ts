import * as cheerio from "cheerio";
import { isRelevantMatch } from "../relevance";
import type { Provider, ProviderResult } from "./types";

const TRAXSOURCE_SEARCH_URL = "https://www.traxsource.com/search";

export const traxsourceProvider: Provider = {
  name: "Traxsource",

  async search(query: string): Promise<ProviderResult> {
    const url = `${TRAXSOURCE_SEARCH_URL}?term=${encodeURIComponent(query)}`;

    let html: string;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
      });
      if (!response.ok) return { platform: "Traxsource", status: "error" };
      html = await response.text();

      const $ = cheerio.load(html);
      const firstRow = $(".trk-row").first();
      if (firstRow.length === 0) {
        return { platform: "Traxsource", status: "not_found" };
      }

      const titleLink = firstRow.find(".trk-cell.title a").first();
      const title = titleLink.text().trim();
      const href = titleLink.attr("href");
      if (!href || !title) {
        return { platform: "Traxsource", status: "not_found" };
      }

      const artist = firstRow.find(".trk-cell.artists a").first().text().trim();
      if (!isRelevantMatch(query, `${artist} ${title}`)) {
        return { platform: "Traxsource", status: "not_found" };
      }

      const label = firstRow.find(".trk-cell.label a").first().text().trim();
      const cover = firstRow.find(".trk-cell.thumb img").attr("src");
      const genre = firstRow.find(".trk-cell.genre a").first().text().trim();

      // The "key-bpm" cell renders as `G#min<br>135` — split on <br>, not on
      // text(), since cheerio's .text() drops the <br> entirely and would
      // concatenate the two values with no separator.
      const keyBpmHtml = firstRow.find(".trk-cell.key-bpm").html() ?? "";
      const [keyRaw, bpmRaw] = keyBpmHtml
        .split(/<br\s*\/?>/i)
        .map((part) => part.replace(/<[^>]+>/g, "").trim());
      const bpm = bpmRaw ? Number(bpmRaw) : undefined;

      return {
        platform: "Traxsource",
        status: "found",
        purchaseUrl: `https://www.traxsource.com${href}`,
        coverUrl: cover,
        matchedArtist: artist || undefined,
        matchedTitle: title,
        metadata: {
          bpm: bpm !== undefined && Number.isFinite(bpm) ? bpm : undefined,
          key: keyRaw || undefined,
          genre: genre || undefined,
          label: label || undefined,
        },
      };
    } catch {
      return { platform: "Traxsource", status: "error" };
    }
  },
};
