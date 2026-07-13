import { isRelevantMatch } from "../relevance";
import { findViaGoogle } from "../google-search";
import type { Provider, ProviderResult } from "./types";

const BANDCAMP_AUTOCOMPLETE_URL =
  "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic";

type BandcampResult = {
  type: string;
  name: string;
  band_name?: string;
  item_url_path?: string;
  img?: string;
};

type BandcampAutocompleteResponse = {
  auto: { results: BandcampResult[] };
};

// Bandcamp's own autocomplete is strict about combined "artist + title"
// queries — verified live (2026-07-10): "ticon" alone finds the album,
// "monda bone" alone finds the track, but "mona bone ticon" (the natural
// way a user types artist+title together) returns zero results even though
// the release genuinely exists. A Google fallback restricted to
// bandcamp.com catches these — same pattern as Beatport/Traxsource.
type BandcampTralbum = {
  artist?: string;
  current?: { title?: string };
};

function parseTralbum(html: string): BandcampTralbum | null {
  const match = html.match(/data-tralbum="([^"]+)"/);
  if (!match) return null;
  try {
    const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function fetchProductPage(
  url: string,
  query: string,
  signal?: AbortSignal
): Promise<ProviderResult> {
  let html: string;
  try {
    const timeout = AbortSignal.timeout(3000);
    const response = await fetch(url, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
    });
    // A Google-found URL that's now unreachable is "no usable result", not
    // a Bandcamp-side technical failure — stays not_found, never error.
    if (!response.ok) return { platform: bandcampProvider.name, status: "not_found" };
    html = await response.text();
  } catch {
    return { platform: bandcampProvider.name, status: "not_found" };
  }

  const tralbum = parseTralbum(html);
  const title = tralbum?.current?.title;
  if (!title) return { platform: bandcampProvider.name, status: "not_found" };

  const artist = tralbum?.artist ?? "";
  if (!isRelevantMatch(query, `${artist} ${title}`)) {
    return { platform: bandcampProvider.name, status: "not_found" };
  }

  return {
    platform: bandcampProvider.name,
    status: "found",
    purchaseUrl: url,
    matchedArtist: artist || undefined,
    matchedTitle: title,
  };
}

export const bandcampProvider: Provider = {
  name: "Bandcamp",

  async search(query: string, signal?: AbortSignal): Promise<ProviderResult> {
    try {
      const timeout = AbortSignal.timeout(6000);
      const response = await fetch(BANDCAMP_AUTOCOMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_text: query,
          search_filter: "",
          full_page: false,
          fan_id: null,
        }),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });

      if (!response.ok) return { platform: bandcampProvider.name, status: "error" };

      const data = (await response.json()) as BandcampAutocompleteResponse;
      const track = data.auto?.results?.find(
        (r) => r.type === "t" && isRelevantMatch(query, `${r.band_name ?? ""} ${r.name}`)
      );

      if (!track || !track.item_url_path) {
        const googleUrl = await findViaGoogle(
          query,
          "bandcamp.com",
          (u) => /\/(track|album)\//.test(u),
          signal
        );
        if (!googleUrl) return { platform: bandcampProvider.name, status: "not_found" };
        return fetchProductPage(googleUrl, query, signal);
      }

      return {
        platform: bandcampProvider.name,
        status: "found",
        purchaseUrl: track.item_url_path,
        coverUrl: track.img,
        matchedArtist: track.band_name,
        matchedTitle: track.name,
      };
    } catch {
      return { platform: bandcampProvider.name, status: "error" };
    }
  },
};
