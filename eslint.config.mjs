import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Client/server boundary: app/api/** (server) and lib/** are exempt —
  // only UI-layer files (pages, components) are restricted. Node-only
  // provider deps (playwright-core, @sparticuz/chromium) must never reach
  // the client bundle. See .claude/rules/providers.md.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/providers",
              message:
                "Never import the providers registry (index.ts) from UI code — it pulls playwright-core/@sparticuz/chromium into the client bundle. Import from @/lib/providers/names or @/lib/providers/types instead.",
            },
            {
              name: "@/lib/browser-fetch",
              message:
                "browser-fetch.ts is server-only (Playwright). Never import it from UI code.",
            },
            {
              name: "@/lib/providers/amazon-music",
              message: "Provider implementations are server-only — never import them from UI code.",
            },
            {
              name: "@/lib/providers/beatport",
              message: "Provider implementations are server-only — never import them from UI code.",
            },
            {
              name: "@/lib/providers/traxsource",
              message: "Provider implementations are server-only — never import them from UI code.",
            },
            {
              name: "@/lib/providers/bandcamp",
              message: "Provider implementations are server-only — never import them from UI code.",
            },
            {
              name: "@/lib/providers/apple-music",
              message: "Provider implementations are server-only — never import them from UI code.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
