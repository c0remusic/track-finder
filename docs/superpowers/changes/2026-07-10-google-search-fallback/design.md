# Fallback de découverte via recherche Google — design

## Contexte

Beatport et Traxsource sont scrapés directement (moteur de recherche interne
de chaque site). Ce scraping échoue parfois (`not_found`) sur des tracks
réellement présentes au catalogue — cas typique : morceaux underground/anciens
que l'utilisateur retrouve manuellement en cherchant sur Google
(`site:beatport.com ...`) quand le moteur de recherche du site lui-même ne
les remonte pas.

Recherche exhaustive menée en amont (voir historique de conversation,
2026-07-10) : aucune alternative API self-service n'existe pour Beatport,
Traxsource, Amazon Music ni Bandcamp (tout nécessite soit une relation
commerciale/account manager, soit un programme fermé aux nouveaux clients —
Google Custom Search API y compris, fermé depuis son annonce "n'est plus
disponible pour les nouveaux clients"). Le scraping reste l'architecture
correcte du projet, pas un pis-aller. Ce document ajoute un **filet de
sécurité** : une recherche Google ciblée en second recours, elle-même
scrapée comme les autres sources (même risque ToS assumé, déjà documenté
dans `CLAUDE.md`).

Test manuel exploratoire (3 requêtes `site:` sur google.com) a confirmé
empiriquement :
- Ça marche parfois (résultats pertinents trouvés)
- Ça échoue proprement parfois (zéro résultat, Google le signale)
- Ça échoue silencieusement parfois — Google renvoie des résultats **hors
  sujet** au lieu d'une liste vide (danger : faux positif si non filtré)

## Objectif

Ajouter un fallback Google pour Beatport et Traxsource, déclenché uniquement
quand le scraping direct du site renvoie `not_found`, sans jamais dégrader
le contrat existant (`found` / `not_found` / `error`, jamais d'exception).

## Architecture

Nouveau module partagé `lib/google-search.ts` :

```ts
export async function findViaGoogle(
  query: string,
  siteFilter: string,                          // ex: "beatport.com/track"
  isPlausibleUrl: (url: string) => boolean,     // ex: /\/track\//.test(url)
): Promise<string | null>
```

Responsabilité : construire la requête (`site:{siteFilter} "{query}"`,
opérateurs Google standards — restriction de domaine + phrase exacte),
fetch la page 1 des résultats, parser les liens+titres, filtrer chaque
candidat via `isRelevantMatch` (déjà dans `lib/relevance.ts`) et
`isPlausibleUrl`. Si rien de pertinent, fetch la page 2 (paramètre `start=10`)
et retente le même filtrage. Retourne la première URL pertinente trouvée, ou
`null` après les deux pages.

Chaque provider (`beatport.ts`, `traxsource.ts`) reste propriétaire de :
1. Appeler `findViaGoogle` uniquement si son scraping direct a renvoyé
   `not_found`.
2. Fetch la page produit retournée.
3. Parser cette page avec une fonction **dédiée**, distincte du parseur de
   la page de recherche du site — une page produit Beatport a un
   `__NEXT_DATA__` de forme différente d'une page de résultats de recherche ;
   une page produit Traxsource a un HTML différent d'une ligne de résultats.
4. Revalider avec `isRelevantMatch` avant de renvoyer `found` (double
   filtrage : une fois sur le titre du résultat Google, une fois sur les
   données réelles extraites de la page produit — la première passe peut
   laisser passer un match approximatif que la page produit dément).

`google-search.ts` est agnostique du site : aucune connaissance de Beatport
ou Traxsource, uniquement la mécanique de recherche + filtrage générique.

## Gestion d'erreurs

- `findViaGoogle` ne lève jamais d'exception : tout échec (fetch KO, HTML
  imparsable, rien de pertinent après 2 pages) retourne `null`.
- `null` en retour de `findViaGoogle` → le provider renvoie simplement le
  `not_found` original du scraping direct. Un échec du fallback n'est
  jamais une panne, jamais un `error`.
- Si la page produit trouvée est injoignable/imparsable après coup, même
  règle : repli sur `not_found`, pas `error` — piste trouvée mais donnée
  non exploitable reste un cas "pas trouvé", pas une panne technique.
- `error` reste réservé aux pannes du scraping direct primaire (comportement
  actuel inchangé). Google n'est qu'un filet optionnel, jamais un nouveau
  point de défaillance qui dégrade un statut existant.
- Chaque appel HTTP interne au fallback (page 1, page 2, page produit) a un
  timeout court (~2-3s) — l'orchestrateur ([route.ts](../../../app/api/search/route.ts))
  applique un budget dur unique de 8s à tous les providers sans distinction ;
  le fallback doit pouvoir échouer proprement en interne avant que ce budget
  global ne coupe tout et ne retourne un `error` générique de timeout.

## Tests

- `google-search.ts` : tests unitaires purs sur `findViaGoogle`, fixtures
  HTML de résultats Google capturées réellement (jamais inventées, suivant
  la convention déjà en place dans `test/fixtures/`) — cas page 1
  pertinente, cas page 2 nécessaire, cas rien de pertinent sur les deux
  pages, cas HTML imparsable.
- Nouveaux parseurs de page produit (Beatport `__NEXT_DATA__` page produit,
  Traxsource HTML page produit) : mêmes fixtures réelles capturées.
- Test d'intégration par provider : scraping direct → `not_found` →
  fallback Google → `found`, avec mocks de fetch pour chaque étape.

## Hors scope

- Bandcamp et Amazon Music ne sont pas concernés par ce fallback (Bandcamp
  a déjà une couverture catalogue complète via `bcsearch_public_api` sans
  ce problème ; Amazon Music est une SPA qui nécessiterait du rendu JS de
  toute façon, le gain serait nul — voir historique de conversation).
- Pas de Playwright/navigateur headless pour interroger Google — fetch HTTP
  simple, comme les autres providers. Si Vercel se fait bloquer/CAPTCHA en
  production, le fallback échoue proprement en `not_found` (comportement
  normal du système, pas un incident) ; on réévaluera avec des données
  réelles de prod plutôt qu'en anticipant.
