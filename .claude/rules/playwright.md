---
paths:
  - "lib/browser-fetch.ts"
  - "lib/google-search.ts"
  - "lib/providers/amazon-music.ts"
  - "lib/providers/beatport.ts"
  - "lib/providers/traxsource.ts"
  - "lib/providers/bandcamp.ts"
---

# Playwright / Chromium serverless — règles

## Index symptôme → emplacement (débug rapide, avant de relire toute la section)

| Symptôme observé | Cause | Où regarder |
|---|---|---|
| `spawn ...\Temp\chromium ENOENT` en local Windows | `@sparticuz/chromium` est un binaire Lambda-only | `browser-fetch.ts`, branche `process.env.VERCEL` |
| `error` occasionnel isolé sur Beatport/Traxsource/Amazon Music | Blocage anti-bot probabiliste, pas forcément une régression | Vérifier si ça se reproduit avant de toucher au code |
| Page de challenge "enablejs" sur une recherche Google | Google bloque le `fetch` brut comme Cloudflare | `lib/google-search.ts` → doit passer par `browser-fetch.ts` |
| 4 providers en `error` simultané, requête à ~24s | Contention sur `MAX_CONCURRENT_PAGES`, `setTimeout` de l'orchestrateur en retard | `browser-fetch.ts`, limiteur de concurrence partagé |
| Retry de récupération sur crash qui ne se déclenche jamais en prod | `browser.isConnected()` reste `true` après un crash réel | Utiliser `isSharedBrowserClosedError` à la place |
| Traxsource/Amazon Music passent d'échec quasi-systématique à succès après un changement de flags Chromium | `--single-process` était activé | Vérifier qu'il est bien absent des args de lancement |
| Navigateur partagé qui plante en prod sans rapport avec charge/mémoire, après une mise à jour de package | `playwright-core` 1.57+ change le binaire Chromium livré | Vérifier le pinning exact de `playwright-core`/`@sparticuz/chromium` |
| Contention qui s'aggrave sur les requêtes suivantes après un timeout provider | Le slot de page reste occupé ~40s après l'abandon HTTP | Vérifier que `AbortSignal` est bien propagé jusqu'à `fetchHtmlViaBrowser` |

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
- **L'orchestrateur (`route.ts`) annule un provider via `AbortSignal` dès
  que son budget de timeout expire**, plutôt que de le laisser tourner —
  trouvé par audit d'architecture (2026-07-13) : un provider abandonné
  gardait le seul slot de page partagé occupé jusqu'à ~40s de plus après
  que la réponse HTTP était déjà partie, aggravant la contention pour
  toutes les requêtes suivantes. `Provider.search(query, signal?)` reçoit
  ce signal ; `fetchHtmlViaBrowser` (dans `browser-fetch.ts`) l'utilise
  pour sortir immédiatement de la file d'attente de page ou fermer le
  contexte Chromium en cours dès l'abandon, au lieu d'attendre le
  `gotoTimeoutMs` interne. Toute nouvelle intégration Playwright doit
  accepter et propager ce `signal` de la même façon (voir apple-music.ts/
  bandcamp.ts pour le pattern côté `fetch` brut : `AbortSignal.any([timeout,
  signal])`).
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

## Interdictions connues

- Ne jamais détecter un crash Playwright via `browser.isConnected()` —
  utiliser `isSharedBrowserClosedError` dans `browser-fetch.ts`.
- Ne jamais relancer Chromium avec le flag `--single-process` — cause de
  crashs sous charge concurrente réelle en prod, même avec
  `MAX_CONCURRENT_PAGES=1`.
- Ne jamais mettre `playwright-core`/`playwright` ou `@sparticuz/chromium`
  en range caret — 1.57+ change le binaire Chromium livré et casse le
  navigateur partagé en prod. Versions exactes obligatoires.
