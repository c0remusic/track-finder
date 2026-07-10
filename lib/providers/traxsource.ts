import * as cheerio from "cheerio";
import { isRelevantMatch } from "../relevance";
import { findViaGoogle } from "../google-search";
import { fetchHtmlViaBrowser } from "../browser-fetch";
import type { Provider, ProviderResult } from "./types";

const TRAXSOURCE_SEARCH_URL = "https://www.traxsource.com/search";

type TraxsourceProductTrack = {
  title: string;
  artist: string;
  cover?: string;
  bpm?: number;
  key?: string;
  genre?: string;
  label?: string;
};

// A product page's markup is unrelated to the search-results row markup
// (.trk-row / .trk-cell): the track lives under .trkp-hdr, and BPM/key/
// genre/label sit in a table whose columns are matched by header text
// (not by a stable per-cell class) — verified live (2026-07-10).
function parseProductPage(html: string): TraxsourceProductTrack | null {
  const $ = cheerio.load(html);
  const header = $(".trkp-hdr");

  const title = header.find(".page-head h1.title").first().text().trim();
  if (!title) return null;

  const version = header.find(".page-head h1.version").first().text().trim();
  const artist = header.find(".page-head a.com-artists").first().text().trim();
  const cover = header.find(".tr-image img").attr("src");

  const rows = header.find(".tr-det-tbl tr");
  const headerCells = rows
    .eq(0)
    .find("td")
    .map((_, el) => $(el).text().trim().replace(/:$/, "").toLowerCase())
    .get();
  const dataCells = rows
    .eq(1)
    .find("td")
    .map((_, el) => $(el).text().trim())
    .get();

  const cellFor = (name: string): string | undefined => {
    const idx = headerCells.indexOf(name);
    return idx === -1 ? undefined : dataCells[idx];
  };

  const bpmRaw = cellFor("bpm");
  const bpm = bpmRaw ? Number(bpmRaw) : undefined;

  return {
    title: version ? `${title} (${version})` : title,
    artist,
    cover,
    bpm: bpm !== undefined && Number.isFinite(bpm) ? bpm : undefined,
    key: cellFor("key") || undefined,
    genre: cellFor("genre") || undefined,
    label: cellFor("label") || undefined,
  };
}

async function fetchProductPage(url: string, query: string): Promise<ProviderResult> {
  // A Google-found URL that's now unreachable is "no usable result", not a
  // Traxsource-side technical failure — stays not_found, never error.
  const html = await fetchHtmlViaBrowser(url);
  if (!html) return { platform: "Traxsource", status: "not_found" };

  const track = parseProductPage(html);
  if (!track) return { platform: "Traxsource", status: "not_found" };

  if (!isRelevantMatch(query, `${track.artist} ${track.title}`)) {
    return { platform: "Traxsource", status: "not_found" };
  }

  return {
    platform: "Traxsource",
    status: "found",
    purchaseUrl: url,
    coverUrl: track.cover,
    matchedArtist: track.artist || undefined,
    matchedTitle: track.title,
    metadata: {
      bpm: track.bpm,
      key: track.key,
      genre: track.genre,
      label: track.label,
    },
  };
}

export const traxsourceProvider: Provider = {
  name: "Traxsource",

  async search(query: string): Promise<ProviderResult> {
    const url = `${TRAXSOURCE_SEARCH_URL}?term=${encodeURIComponent(query)}`;

    const html = await fetchHtmlViaBrowser(url);
    if (!html) return { platform: "Traxsource", status: "error" };

    try {
      const $ = cheerio.load(html);
      // Traxsource's own search ranks by its own relevance/popularity
      // signal, not query-token overlap — the correct match isn't always
      // the first row (same class of gap found on Beatport, 2026-07-10:
      // a differently-spelled or differently-ordered query can rank other
      // tracks by the same artist above the actual match). Scan every
      // returned row for the first one isRelevantMatch accepts, same
      // pattern as Bandcamp's autocomplete .find(), before falling back to
      // Google — rather than only falling back when zero rows exist.
      const rows = $(".trk-row").toArray();
      const match = rows
        .map((el) => {
          const row = $(el);
          const titleLink = row.find(".trk-cell.title a").first();
          const title = titleLink.text().trim();
          const href = titleLink.attr("href");
          const artist = row.find(".trk-cell.artists a").first().text().trim();
          return { row, title, href, artist };
        })
        .find(({ title, href, artist }) => href && title && isRelevantMatch(query, `${artist} ${title}`));

      if (!match) {
        const googleUrl = await findViaGoogle(
          query,
          "traxsource.com/track",
          (u) => /\/track\//.test(u)
        );
        if (!googleUrl) return { platform: "Traxsource", status: "not_found" };
        return fetchProductPage(googleUrl, query);
      }

      const { row: firstRow, title, href, artist } = match;

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
