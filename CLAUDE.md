# Track-finder — CLAUDE.md

> Nom de projet provisoire (placeholder, jamais tranché). Repo séparé,
> volontairement distinct de Sift (`dj-assistant-m6a`) — produit public,
> cycle de vie et exposition légale différents. Voir
> `docs/superpowers/changes/2026-07-09-track-finder/design.md` pour le
> contexte complet de création.

## Quoi

Outil web public : à partir d'une recherche artiste/titre, agrège (1) des
liens d'achat directs sur 5 plateformes qui vendent réellement des fichiers
à l'unité (Apple Music/iTunes, Beatport, Traxsource, Bandcamp, Amazon
Music) et (2) les métadonnées disponibles (BPM/clé/genre/label/pochette).
Motivé par un besoin réel : retrouver une release qu'on ne trouve qu'en
fichiers de mauvaise qualité sur Soulseek.

Pas un agrégateur "où écouter" (Spotify/YouTube/Tidal/Deezer/SoundCloud/
Mixcloud sont hors scope — aucune ne vend de fichier à l'unité). Ne pas
confondre avec l'app "Track Finder" préexistante de Conor Bronsdon qui a
pris le sous-domaine générique `track-finder.vercel.app` — sans rapport,
notre app est sur `track-finder-c0re-s-projects.vercel.app`.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 + shadcn/ui
(style base-nova, `@base-ui/react`) · next-themes (dark mode) · motion
(animations, import path `motion/react`) · cheerio (parsing HTML) ·
playwright-core + @sparticuz/chromium (Amazon Music, serverless) ·
@upstash/ratelimit + @upstash/redis (rate limiting, fail-open) · Vitest.
Déployé sur Vercel, repo GitHub public (`c0remusic/track-finder`, git-linked
— déploiement auto à chaque push sur `master`).

## Commandes

- Dev : `npm run dev`
- Build : `npm run build`
- Tests : `npm run test` (Vitest, tous Node-environment — aucun test ne
  rend de composant React, donc pas de `@vitejs/plugin-react`/jsdom)
- Type-check : `npx tsc --noEmit`
- Smoke-test manuel contre une instance réelle : `node scripts/smoke-test.mjs`
  (jamais en CI — casse à chaque refonte HTML des sites scrapés)

## Structure (état réel)

```
app/
  page.tsx              — page de recherche (client component, EventSource)
  layout.tsx             — ThemeProvider (next-themes) + metadata réels
  icon.tsx                — favicon généré (next/og ImageResponse), même
                           motif que components/Logo.tsx
  api/search/route.ts   — orchestrateur SSE : fan-out 5 providers, cache,
                           rate limit, timeout dur par provider
  globals.css           — thème shadcn (variables oklch, accent violet
                           `--primary`/`--ring` depuis le 2026-07-10 — voir
                           Task 1 du plan pour l'historique du bug
                           "variables manquantes")
components/
  SearchForm.tsx, AchatSection.tsx, Disclaimer.tsx, Logo.tsx
  theme-provider.tsx, theme-toggle.tsx — dark mode (next-themes)
  ui/                   — composants shadcn (badge/button/card/input)
lib/
  providers/
    types.ts            — contrat Provider/ProviderResult/Slot
    names.ts            — liste de noms plate, ZERO import (permet au client
                           de connaître les 5 noms sans tirer amazon-music.ts
                           et ses deps Node-only playwright-core/@sparticuz
                           dans le bundle client — ne jamais faire importer
                           lib/providers/index.ts par un fichier "use client")
    index.ts             — registre allProviders (server-only via names.ts)
    {apple-music,traxsource,beatport,bandcamp,amazon-music}.ts
  relevance.ts           — filtre anti-faux-positif (voir Méthode)
  cache.ts, rate-limit.ts, utils.ts
scripts/
  capture-fixture.mjs    — capture Playwright réutilisable (spike Bandcamp/
                           Amazon Music)
  smoke-test.mjs         — vérif manuelle post-déploiement
test/                    — miroir de lib/ et app/api, fixtures réelles
                           capturées (jamais inventées) dans test/fixtures/
```

## Méthode

Même philosophie que Sift (détective, fail-fast, pas de fallback
silencieux). Les règles détaillées et scopées par fichier vivent désormais
dans `.claude/rules/` (chargées seulement quand Claude touche les fichiers
concernés — voir `docs/superpowers/...` pour l'historique complet) :

- [`.claude/rules/providers.md`](.claude/rules/providers.md) — contrat
  provider (jamais de throw non catché, `not_found` ≠ `error`, filtre de
  pertinence, rate limiter fail-open), checklist de décision pour une
  nouvelle intégration scraping.
- [`.claude/rules/playwright.md`](.claude/rules/playwright.md) — contraintes
  Chromium serverless, concurrence du navigateur partagé, détection de
  crash, versions épinglées.
- [`.claude/rules/deployment.md`](.claude/rules/deployment.md) — config
  Next.js pour Playwright en prod, `maxDuration`.

## Différé

Décisions explicitement repoussées (pas écartées) — trigger de réouverture
nommé pour chacune, à reconsidérer si le trigger se produit :

- **Metadata (BPM/clé/genre/label/pochette) dans le flux de recherche** —
  retirée d'`aggregateSearch`/`page.tsx` le 2026-07-10 (voir
  `docs/superpowers/changes/archive/2026-07-10-remove-metadata-from-search-flow/design.md`).
  Le contrat `ProviderResult.metadata` reste inchangé côté providers.
  Trigger de réouverture : demande explicite de réintroduire l'affichage
  metadata, avec ses propres providers/déclenchement dédiés plutôt que
  greffée sur le flux de recherche actuel.
- **Apify `google-search-scraper` pour le fallback Google** — évalué et
  écarté le 2026-07-13 (voir memory `project_apify_google_scraper_decision`)
  : `lib/google-search.ts` fait déjà le même travail en interne, pas de
  preuve de besoin. Trigger de réouverture : blocage Google observé en prod
  sur le fallback interne, non résolu par un correctif local dans
  `browser-fetch.ts`/`google-search.ts`.

## Risque légal (scraping)

Beatport/Traxsource/Amazon Music n'ont pas d'API publique auto-inscriptible
accessible ; le scraping de ces 3 sources reste un risque ToS assumé
explicitement par l'utilisateur (voir design.md, section Risques) — **pas
un avis juridique**, une vérification par un professionnel reste
recommandée avant tout usage commercial élargi. Bandcamp et Apple Music
utilisent des API/endpoints légitimes (respectivement `bcsearch_public_api`
et `itunes.apple.com/search`), risque ToS nul pour ces deux-là.

## Déploiement (Vercel)

- Git-linked (push sur `master` → déploiement auto). Le premier import a
  échoué via l'outil MCP `deploy_to_vercel` (403, permission projet sur le
  compte équipe) — utiliser le flow dashboard "Import Git Repository" à la
  place, plus fiable et donne le déploiement continu en prime.
- Nouveau projet = **Deployment Protection (SSO) actif par défaut** sur un
  compte équipe — bloque l'accès public tant que non désactivé dans les
  réglages du projet (décision utilisateur, pas un fix de code).
- `UPSTASH_REDIS_REST_URL`/`TOKEN` optionnelles — absentes, le rate
  limiting tourne en mode "toujours autorisé" (fail-open), l'app reste
  pleinement fonctionnelle.
- Config Next.js pour Playwright/Chromium en prod (`serverExternalPackages`,
  `outputFileTracingIncludes`, `maxDuration`) : voir
  [`.claude/rules/deployment.md`](.claude/rules/deployment.md).

## Index des documents docs/

@docs/INDEX.json

## Outillage / routage skills

Même règle impérative que tous les projets (voir `~/.claude/CLAUDE.md`,
section routage skills) — pas de registre skills dédié pour ce projet
encore (trop jeune/petit), les décisions d'outillage rencontrées jusqu'ici :
`superpowers:brainstorming` → `superpowers:writing-plans` →
`superpowers:subagent-driven-development` pour tout le cycle de vie
design→implémentation ; `code-review`/revues ad hoc via sous-agents
dispatchés manuellement pour les fix post-livraison.
