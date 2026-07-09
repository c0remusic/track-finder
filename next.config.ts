import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core / @sparticuz/chromium ship native binaries whose internal
  // relative-path lookups (chromium's getBinPath()) break if the Next.js
  // bundler relocates their source into the Route Handler bundle — must stay
  // external so they're required from node_modules as-is at runtime.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
};

export default nextConfig;
