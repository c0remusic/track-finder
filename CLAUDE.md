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
(style base-nova, `@base-ui/react`) · cheerio (parsing HTML) ·
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
  api/search/route.ts   — orchestrateur SSE : fan-out 5 providers, cache,
                           rate limit, timeout dur par provider
  globals.css           — thème shadcn (variables oklch, voir Task 1 du plan
                           pour l'historique du bug "variables manquantes")
components/
  SearchForm.tsx, AchatSection.tsx, MetadataSection.tsx, Disclaimer.tsx
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
silencieux), incarnée concrètement dans ce code :

- **Un provider ne lève jamais d'exception** — toute erreur (réseau, parse,
  timeout, blocage anti-bot) devient `{status: "error"}`, jamais un throw
  non catché. Cette classe de bug (une étape après le premier `try` non
  protégée) est revenue plusieurs fois pendant l'implémentation — toujours
  vérifier que CHAQUE étape qui peut lever (fetch, `.json()`, `.text()`,
  parsing cheerio, navigation Playwright) est dans le bloc protégé, pas
  seulement le premier appel.
- **`not_found` ≠ `error`**, distinction maintenue partout : `not_found` =
  recherche réellement exécutée, rien de pertinent (affiché en badge
  neutre "Non trouvé" depuis le 2026-07-10 — la version initiale le
  masquait complètement, jugée confusante en usage réel) ; `error` = échec
  technique réel (badge destructif "Indisponible pour l'instant").
- **Ne jamais faire confiance au premier résultat d'une recherche floue**
  sans vérifier sa pertinence (`lib/relevance.ts`) — bug réel trouvé par
  test manuel (Bandcamp a matché "sven dose all in" à un titre totalement
  différent), pas par la revue de code. Toute nouvelle intégration de
  recherche externe doit passer par ce même filtre.
- **Une couche de protection secondaire (rate limiter) doit fail-open**,
  jamais faire tomber la fonctionnalité cœur sur sa propre panne/mauvaise
  config (`lib/rate-limit.ts` — confirmé par un vrai 500 en prod avant
  correctif).
- **Avant Playwright, vérifier une API JSON interne plus légère** (voir
  Bandcamp : `bcsearch_public_api` contourne entièrement le CAPTCHA public)
  ou un `__NEXT_DATA__` embarqué (voir Beatport) — moins fragile, moins de
  risque légal, pas de navigateur à maintenir.

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
- `playwright-core` + `@sparticuz/chromium` (Amazon Music) nécessitent
  **deux** configs Next.js ensemble, pas une seule : `serverExternalPackages`
  ET `outputFileTracingIncludes` (voir `next.config.ts` — un 500 réel en
  prod a révélé que la seconde manquait, `serverExternalPackages` seul ne
  suffit pas car le tracer ne voit pas les fichiers lus via `fs` au
  runtime comme `browsers.json`). `playwright-core`/`@sparticuz/chromium`
  doivent être en `dependencies`, jamais `devDependencies` — c'est un
  import runtime réel, pas juste un besoin de test.
- `UPSTASH_REDIS_REST_URL`/`TOKEN` optionnelles — absentes, le rate
  limiting tourne en mode "toujours autorisé" (fail-open), l'app reste
  pleinement fonctionnelle.

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
