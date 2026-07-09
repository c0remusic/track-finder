import type { Provider, ProviderResult } from "./types";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";

type ITunesTrack = {
  artistName: string;
  trackName: string;
  trackViewUrl: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
};

type ITunesSearchResponse = {
  resultCount: number;
  results: ITunesTrack[];
};

export const appleMusicProvider: Provider = {
  name: "Apple Music",

  async search(query: string): Promise<ProviderResult> {
    const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(query)}&entity=song&limit=1`;

    let response: { ok: boolean; json: () => Promise<ITunesSearchResponse> };
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    } catch {
      return { platform: "Apple Music", status: "error" };
    }

    if (!response.ok) {
      return { platform: "Apple Music", status: "error" };
    }

    const data = await response.json();
    if (data.resultCount === 0 || data.results.length === 0) {
      return { platform: "Apple Music", status: "not_found" };
    }

    const track = data.results[0];
    return {
      platform: "Apple Music",
      status: "found",
      purchaseUrl: track.trackViewUrl,
      coverUrl: track.artworkUrl100,
      matchedArtist: track.artistName,
      matchedTitle: track.trackName,
      metadata: track.primaryGenreName ? { genre: track.primaryGenreName } : undefined,
    };
  },
};
