// Static list of provider display names, kept separate from
// lib/providers/index.ts so client components can import it without pulling
// in the actual provider implementations (amazon-music.ts imports
// playwright-core/@sparticuz-chromium, Node-only server packages that must
// never end up in the client bundle).
export const PROVIDER_NAMES = [
  "Apple Music",
  "Traxsource",
  "Beatport",
  "Bandcamp",
  "Amazon Music",
] as const;
