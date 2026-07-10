import { isRelevantMatch } from "../relevance";
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

export const bandcampProvider: Provider = {
  name: "Bandcamp",

  async search(query: string): Promise<ProviderResult> {
    try {
      const response = await fetch(BANDCAMP_AUTOCOMPLETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_text: query,
          search_filter: "",
          full_page: false,
          fan_id: null,
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) return { platform: "Bandcamp", status: "error" };

      const data = (await response.json()) as BandcampAutocompleteResponse;
      const track = data.auto?.results?.find(
        (r) => r.type === "t" && isRelevantMatch(query, `${r.band_name ?? ""} ${r.name}`)
      );

      if (!track || !track.item_url_path) {
        return { platform: "Bandcamp", status: "not_found" };
      }

      return {
        platform: "Bandcamp",
        status: "found",
        purchaseUrl: track.item_url_path,
        coverUrl: track.img,
        matchedArtist: track.band_name,
        matchedTitle: track.name,
      };
    } catch {
      return { platform: "Bandcamp", status: "error" };
    }
  },
};
