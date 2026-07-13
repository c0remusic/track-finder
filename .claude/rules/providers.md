---
paths:
  - "lib/providers/**/*.ts"
  - "lib/relevance.ts"
  - "lib/rate-limit.ts"
  - "lib/cache.ts"
---

# Providers — règles

Même philosophie que Sift (détective, fail-fast, pas de fallback silencieux),
incarnée concrètement dans ce code :

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
  correctif). Depuis le 2026-07-13, "fail-open" ne veut plus dire "sans
  aucune limite" : un filet de secours en mémoire (même fenêtre 20/60s que
  le limiteur Redis) borne les requêtes par instance pendant une panne
  Upstash — trouvé par audit d'architecture (chaque `/api/search` peut
  lancer jusqu'à 4 navigateurs Chromium, un fail-open total pendant une
  panne Redis était un vecteur de déni de service ressource, pas juste un
  abus mineur toléré).

## Checklist — nouvelle intégration scraping (à suivre dans l'ordre, s'arrêter au premier qui marche)

1. **API JSON publique interne ?** (ex. `bcsearch_public_api` de Bandcamp)
   — si oui, l'utiliser, fin de la checklist. Zéro navigateur, zéro risque
   ToS, zéro fragilité de parsing HTML.
2. **`__NEXT_DATA__` ou state embarqué dans le HTML servi ?** (ex. Beatport)
   — si oui, fetch brut + parse JSON, fin de la checklist. Toujours pas de
   navigateur, mais dépend de la structure du site (peut casser à une
   refonte front).
3. **Fetch brut suffit sans blocage anti-bot ?** — tester une requête réelle
   avant de conclure ; Cloudflare/Akamai/Google bloquent le `fetch` Node
   même pour du contenu public (voir `.claude/rules/playwright.md`). Si ça
   passe, fin de la checklist.
4. **Sinon, Playwright via `lib/browser-fetch.ts`** — dernier recours
   seulement, voir `.claude/rules/playwright.md` pour les contraintes.

## Interdictions connues (bugs déjà rencontrés, ne pas réintroduire)

- Ne jamais laisser une étape d'un provider (fetch, `.json()`, `.text()`,
  parsing cheerio, navigation Playwright) hors du bloc try/catch protégé —
  un provider ne lève jamais d'exception non catchée.
- Ne jamais afficher un résultat de recherche floue sans le passer par
  `lib/relevance.ts` — faux positif réel constaté sur Bandcamp (mismatch
  artiste/titre complet).
- Ne jamais laisser une couche de protection secondaire (rate limiter)
  bloquer la fonctionnalité cœur sur sa propre panne — fail-open obligatoire
  (`lib/rate-limit.ts`).
