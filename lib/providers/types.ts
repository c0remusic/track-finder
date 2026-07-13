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
  // `signal` fires when the orchestrator has already given up on this
  // provider (timeout budget elapsed) — providers that hold an expensive
  // shared resource (the Chromium page slot, see browser-fetch.ts) should
  // release it as soon as it fires instead of running to their own
  // internal timeout. Optional: a provider that ignores it just keeps its
  // current behavior.
  search(query: string, signal?: AbortSignal): Promise<ProviderResult>;
};

// UI-only state shape: a platform's row before its result has arrived over
// the search stream.
export type Slot = ProviderResult | { platform: string; status: "pending" };
