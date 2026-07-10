import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core / @sparticuz/chromium ship native binaries whose internal
  // relative-path lookups (chromium's getBinPath()) break if the Next.js
  // bundler relocates their source into the Route Handler bundle — must stay
  // external so they're required from node_modules as-is at runtime.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // serverExternalPackages keeps these two out of the JS bundle, but Next's
  // automatic output-file-tracing still has to know to COPY their non-code
  // asset files (e.g. playwright-core's browsers.json, read via fs at
  // runtime rather than require()'d) into the deployed function. Confirmed
  // in production (2026-07-10): without this, the function 500s on
  // `Cannot find module '/var/task/node_modules/playwright-core/browsers.json'`.
  outputFileTracingIncludes: {
    "/api/search/route": [
      "./node_modules/playwright-core/**",
      "./node_modules/@sparticuz/chromium/**",
    ],
  },
};

export default nextConfig;
