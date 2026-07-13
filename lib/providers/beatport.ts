import { findViaGoogle } from "../google-search";
import { fetchHtmlViaBrowser } from "../browser-fetch";
import { isRelevantMatch } from "../relevance";
import type { Provider, ProviderResult } from "./types";

const BEATPORT_SEARCH_URL = "https://www.beatport.com/search";

type BeatportTrack = {
  track_id: number;
  track_name: string;
  mix_name?: string;
  artists?: { artist_name: string }[];
  bpm?: number;
  key_name?: string;
  genre?: { genre_name: string }[];
  label?: { label_name: string };
  track_image_uri?: string;
};

function extractNextData(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function searchTracks(nextData: unknown): BeatportTrack[] {
  const data = nextData as {
    props?: {
      pageProps?: {
        dehydratedState?: {
          queries?: { state?: { data?: { tracks?: { data?: BeatportTrack[] } } } }[];
        };
      };
    };
  };
  return data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.tracks?.data ?? [];
}

type BeatportProductTrack = {
  id: number;
  name: string;
  mix_name?: string;
  artists?: { name: string }[];
  bpm?: number;
  key?: { name: string };
  genre?: { name: string };
  release?: { label?: { name: string } };
  image?: { uri?: string };
};

// A product page's __NEXT_DATA__ holds the track directly at
// queries[0].state.data — a different shape from the search-results page
// (queries[0].state.data.tracks.data[]), verified live (2026-07-10).
function productPageTrack(nextData: unknown): BeatportProductTrack | null {
  const data = nextData as {
    props?: {
      pageProps?: {
        dehydratedState?: {
          queries?: { state?: { data?: BeatportProductTrack } }[];
        };
      };
    };
  };
  return data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data ?? null;
}

async function fetchProductPage(
  url: string,
  query: string,
  signal?: AbortSignal
): Promise<ProviderResult> {
  // A Google-found URL that's now unreachable is "no usable result", not a
  // Beatport-side technical failure — stays not_found, never error.
  const html = await fetchHtmlViaBrowser(url, { signal });
  if (!html) return { platform: beatportProvider.name, status: "not_found" };

  const nextData = extractNextData(html);
  if (!nextData) return { platform: beatportProvider.name, status: "not_found" };

  const track = productPageTrack(nextData);
  if (!track) return { platform: beatportProvider.name, status: "not_found" };

  const title =
    track.mix_name && track.mix_name !== "Original Mix"
      ? `${track.name} (${track.mix_name})`
      : track.name;
  const artist = track.artists?.[0]?.name ?? "";

  if (!isRelevantMatch(query, `${artist} ${title}`)) {
    return { platform: beatportProvider.name, status: "not_found" };
  }

  return {
    platform: beatportProvider.name,
    status: "found",
    purchaseUrl: url,
    coverUrl: track.image?.uri,
    matchedArtist: artist || undefined,
    matchedTitle: title,
    metadata: {
      bpm: track.bpm,
      key: track.key?.name,
      genre: track.genre?.name,
      label: track.release?.label?.name,
    },
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function titleAndArtist(track: BeatportTrack): { title: string; artist: string } {
  const title =
    track.mix_name && track.mix_name !== "Original Mix"
      ? `${track.track_name} (${track.mix_name})`
      : track.track_name;
  return { title, artist: track.artists?.[0]?.artist_name ?? "" };
}

export const beatportProvider: Provider = {
  name: "Beatport",

  async search(query: string, signal?: AbortSignal): Promise<ProviderResult> {
    const url = `${BEATPORT_SEARCH_URL}?q=${encodeURIComponent(query)}`;

    // Beatport's own search page can come back as a Cloudflare "Just a
    // moment..." challenge instead of real markup (probabilistic bot-block,
    // see .claude/rules/playwright.md) — that's a failure to get usable data
    // from Beatport's own search, not proof the track isn't there. Treat it
    // the same as "own search returned zero relevant tracks" below and fall
    // through to the Google fallback, rather than reporting `error` and
    // skipping the fallback that would otherwise find it (confirmed live
    // 2026-07-13: "Ticon Mona Bone" blocked on Beatport's own search every
    // time, but the Google fallback path below — already used for the
    // zero-match case — reaches the real product page).
    const html = await fetchHtmlViaBrowser(url, { signal });
    const nextData = html ? extractNextData(html) : null;

    // Beatport's own search ranks by its own relevance/popularity signal,
    // not query-token overlap — the correct match isn't always first result
    // (confirmed real case, 2026-07-10: "Ticon Mona Bone" ranked other Ticon
    // tracks above the actual "Monda Bone" match). Scan every returned track
    // for the first one isRelevantMatch accepts, same pattern as Bandcamp's
    // autocomplete .find(), before falling back to Google.
    const track = nextData
      ? searchTracks(nextData).find((t) => {
          const { title, artist } = titleAndArtist(t);
          return isRelevantMatch(query, `${artist} ${title}`);
        })
      : undefined;

    if (!track) {
      const googleUrl = await findViaGoogle(
        query,
        "beatport.com/track",
        (u) => /\/track\//.test(u),
        signal
      );
      if (!googleUrl) return { platform: beatportProvider.name, status: "not_found" };
      return fetchProductPage(googleUrl, query, signal);
    }

    const { title, artist } = titleAndArtist(track);

    return {
      platform: beatportProvider.name,
      status: "found",
      purchaseUrl: `https://www.beatport.com/track/${slugify(track.track_name)}/${track.track_id}`,
      coverUrl: track.track_image_uri,
      matchedArtist: artist || undefined,
      matchedTitle: title,
      metadata: {
        bpm: track.bpm,
        key: track.key_name,
        genre: track.genre?.[0]?.genre_name,
        label: track.label?.label_name,
      },
    };
  },
};
