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
    if (!track) return { platform: "Beatport", status: "not_found" };

    const title =
      track.mix_name && track.mix_name !== "Original Mix"
        ? `${track.track_name} (${track.mix_name})`
        : track.track_name;

    return {
      platform: "Beatport",
      status: "found",
      purchaseUrl: `https://www.beatport.com/track/${slugify(track.track_name)}/${track.track_id}`,
      coverUrl: track.track_image_uri,
      matchedArtist: track.artists?.[0]?.artist_name,
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
