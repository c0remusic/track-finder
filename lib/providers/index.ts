import type { Provider } from "./types";
import { appleMusicProvider } from "./apple-music";
import { traxsourceProvider } from "./traxsource";
import { beatportProvider } from "./beatport";
import { bandcampProvider } from "./bandcamp";
import { amazonMusicProvider } from "./amazon-music";

export const allProviders: Provider[] = [
  appleMusicProvider,
  traxsourceProvider,
  beatportProvider,
  bandcampProvider,
  amazonMusicProvider,
];
