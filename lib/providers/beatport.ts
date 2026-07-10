import { findViaGoogle } from "../google-search";
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

function firstTrack(nextData: unknown): BeatportTrack | null {
  const data = nextData as {
    props?: {
      pageProps?: {
        dehydratedState?: {
          queries?: { state?: { data?: { tracks?: { data?: BeatportTrack[] } } } }[];
        };
      };
    };
  };
  const tracks = data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.tracks?.data;
  if (!tracks || tracks.length === 0) return null;
  return tracks[0];
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

async function fetchProductPage(url: string, query: string): Promise<ProviderResult> {
  let html: string;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
    });
    // A Google-found URL that's now unreachable is "no usable result", not
    // a Beatport-side technical failure — stays not_found, never error.
    if (!response.ok) return { platform: "Beatport", status: "not_found" };
    html = await response.text();
  } catch {
    return { platform: "Beatport", status: "not_found" };
  }

  const nextData = extractNextData(html);
  if (!nextData) return { platform: "Beatport", status: "not_found" };

  const track = productPageTrack(nextData);
  if (!track) return { platform: "Beatport", status: "not_found" };

  const title =
    track.mix_name && track.mix_name !== "Original Mix"
      ? `${track.name} (${track.mix_name})`
      : track.name;
  const artist = track.artists?.[0]?.name ?? "";

  if (!isRelevantMatch(query, `${artist} ${title}`)) {
    return { platform: "Beatport", status: "not_found" };
  }

  return {
    platform: "Beatport",
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

export const beatportProvider: Provider = {
  name: "Beatport",

  async search(query: string): Promise<ProviderResult> {
    const url = `${BEATPORT_SEARCH_URL}?q=${encodeURIComponent(query)}`;

    let html: string;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; track-finder/1.0)" },
      });
      if (!response.ok) return { platform: "Beatport", status: "error" };
      html = await response.text();
    } catch {
      return { platform: "Beatport", status: "error" };
    }

    const nextData = extractNextData(html);
    if (!nextData) return { platform: "Beatport", status: "error" };

    const track = firstTrack(nextData);
    if (!track) {
      const googleUrl = await findViaGoogle(
        query,
        "beatport.com/track",
        (u) => /\/track\//.test(u)
      );
      if (!googleUrl) return { platform: "Beatport", status: "not_found" };
      return fetchProductPage(googleUrl, query);
    }

    const title =
      track.mix_name && track.mix_name !== "Original Mix"
        ? `${track.track_name} (${track.mix_name})`
        : track.track_name;
    const artist = track.artists?.[0]?.artist_name ?? "";

    if (!isRelevantMatch(query, `${artist} ${title}`)) {
      return { platform: "Beatport", status: "not_found" };
    }

    return {
      platform: "Beatport",
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
