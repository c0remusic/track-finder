export type ProviderStatus = "found" | "not_found" | "error";

export type ProviderMetadata = {
  bpm?: number;
  key?: string;
  genre?: string;
  label?: string;
};

export type ProviderResult = {
  platform: string;
  status: ProviderStatus;
  purchaseUrl?: string;
  coverUrl?: string;
  matchedArtist?: string;
  matchedTitle?: string;
  metadata?: ProviderMetadata;
};

export type Provider = {
  name: string;
  search(query: string): Promise<ProviderResult>;
};

// UI-only state shape: a platform's row before its result has arrived over
// the search stream.
export type Slot = ProviderResult | { platform: string; status: "pending" };
