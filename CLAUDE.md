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
- **`@sparticuz/chromium` est un binaire Lambda-only** — ne se lance jamais
  en local sur Windows (`spawn ...\Temp\chromium ENOENT`, confirmé
  2026-07-10). Tout provider scrapé via Playwright doit passer par
  `lib/browser-fetch.ts`, qui branche sur `process.env.VERCEL` (Chromium
  Lambda en prod, Edge système en local via l'option `channel` de
  `playwright-core` — aucun téléchargement supplémentaire).
- **Le blocage Cloudflare/Akamai est probabiliste, pas un test binaire**
  (score de confiance IP/comportemental côté anti-bot) — un taux d'échec
  résiduel sur Beatport/Traxsource/Amazon Music est normal même avec les
  contre-mesures anti-détection en place (`browser-fetch.ts` : masquage
  `navigator.webdriver`, `--disable-blink-features=AutomationControlled`).
  Ne pas traiter un `error` occasionnel sur ces 3 providers comme une
  régression sans vérifier d'abord si ça se reproduit.
- **Google aussi bloque le `fetch` brut** (même famille de détection que
  Cloudflare — confirmé 2026-07-10 : page de challenge "enablejs" servie à
  un `fetch` Node, résultats réels obtenus via un vrai navigateur).
  `lib/google-search.ts` passe donc par `lib/browser-fetch.ts` comme les
  providers scrapés. `MAX_PAGES=1` (chaque page Google est un lancement de
  navigateur, pas un fetch HTTP léger).
- **`lib/browser-fetch.ts` garde un seul processus Chromium partagé en vie**
  au lieu d'en lancer un nouveau à chaque appel — un lancement coûte 1-3s,
  ouvrir une page dans un navigateur déjà lancé quelques centaines de ms
  (perf, 2026-07-10 : 9-24s+erreurs → 7-9s sans erreur sur les mêmes
  requêtes). Le limiteur de concurrence porte sur les **pages** ouvertes,
  pas les processus navigateur (`MAX_CONCURRENT_PAGES=1` depuis le
  2026-07-10 — voir le bullet `--single-process` ci-dessous pour pourquoi
  c'est descendu de 3 à 1, pas juste 3 à 2), partagé entre TOUS les
  providers Playwright, pas par provider — sans cette limite, une requête
  où plusieurs providers ont besoin d'un fallback simultanément peut
  saturer la boucle d'événements Node au point que les `setTimeout` de
  l'orchestrateur se déclenchent en retard sur le vrai travail (constaté
  avant ce fix : 24s, 4 providers rapportant "error" au lieu de
  "not_found"). Toute surcharge de timeout par provider dans `route.ts`
  doit tenir compte de cette file d'attente partagée entre providers, pas
  seulement du temps de navigation brut d'un seul appel.
- **Ne jamais détecter un crash Playwright via `browser.isConnected()`** —
  confirmé en prod (2026-07-10) que ce signal reste à `true` après un crash
  bien réel du navigateur partagé (`Target page, context or browser has
  been closed` en cascade sur tous les providers suivants dans la même
  requête). Le retry de récupération ajouté sur ce signal ne s'est JAMAIS
  déclenché en production malgré un code apparemment correct — bug resté
  invisible jusqu'à la lecture directe des logs runtime Vercel (aucun test
  local ne le révèle, ce cas ne se produit que sous charge concurrente
  réelle en prod). Détecter le crash par le message d'erreur Playwright
  lui-même (`isSharedBrowserClosedError` dans `browser-fetch.ts`) est le
  seul signal fiable observé.
- **`--single-process` (flag par défaut de `@sparticuz/chromium`, pensé
  pour réduire l'empreinte mémoire Lambda) a été retiré des args de
  lancement Chromium** — ce flag fait tourner le navigateur et tous ses
  renderers dans un seul process/thread pool OS, ce qui s'est révélé
  nettement plus sujet aux crashs que le mode multi-process normal de
  Chromium sous charge concurrente réelle, même une fois la concurrence
  des pages réduite à 1. Le plan Hobby Vercel a en réalité 2GB de mémoire
  fonction fixes (pas la contrainte serrée supposée au départ), donc la
  marge mémoire perdue en repassant en multi-process est un compromis
  largement rentable ici. Confirmé en prod (2026-07-10) : Traxsource et
  Amazon Music sont passés de quasi-systématiquement en échec à
  quasi-systématiquement en succès après ce retrait seul.
- **`playwright-core`/`playwright` et `@sparticuz/chromium` sont épinglés
  en versions exactes (pas de caret), pas un oubli** — `playwright-core`
  1.57+ lance des builds "Chrome for Testing"/`chrome-headless-shell` au
  lieu du Chromium open-source vanilla que `@sparticuz/chromium` fournit,
  un breaking change documenté upstream (microsoft/playwright#38489) qui a
  fait planter le navigateur partagé en production de façon quasi
  systématique, indépendamment de la charge ou de la mémoire — confirmé en
  isolant chaque variable (retry, concurrence, blocage de ressources) avant
  de trouver la vraie cause. Toute mise à jour de l'un des deux packages
  doit re-vérifier cette paire en conditions réelles, pas seulement via les
  ranges semver.

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
- **Le cap par défaut d'une function serverless est 10s sur le plan
  Hobby** (60s max configurable) — toute route dont le budget interne peut
  dépasser ça doit déclarer `export const maxDuration`. `/api/search` est à
  20s depuis le 2026-07-10 (3 providers Playwright à 15s de budget chacun).

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
