---
paths:
  - "next.config.ts"
  - "app/api/search/route.ts"
  - "vercel.json"
---

# Déploiement Vercel — contraintes techniques

- `playwright-core` + `@sparticuz/chromium` (Amazon Music) nécessitent
  **deux** configs Next.js ensemble, pas une seule : `serverExternalPackages`
  ET `outputFileTracingIncludes` (voir `next.config.ts` — un 500 réel en
  prod a révélé que la seconde manquait, `serverExternalPackages` seul ne
  suffit pas car le tracer ne voit pas les fichiers lus via `fs` au
  runtime comme `browsers.json`). `playwright-core`/`@sparticuz/chromium`
  doivent être en `dependencies`, jamais `devDependencies` — c'est un
  import runtime réel, pas juste un besoin de test.
- **Le cap par défaut d'une function serverless est 10s sur le plan
  Hobby** (60s max configurable) — toute route dont le budget interne peut
  dépasser ça doit déclarer `export const maxDuration`. `/api/search` est à
  `maxDuration=50` (les budgets par provider Playwright dans
  `PROVIDER_TIMEOUT_OVERRIDES_MS` sont montés à 35-40s chacun depuis — le
  chiffre "20s/15s" documenté ici jusqu'au 2026-07-13 était obsolète par
  rapport au code réel, trouvé par audit d'architecture).
