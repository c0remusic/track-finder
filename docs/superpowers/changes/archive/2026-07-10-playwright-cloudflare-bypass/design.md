# Beatport/Traxsource → Playwright + Amazon Music timeout fix — design

## Contexte

Vérifié en direct (2026-07-10) : `curl` avec un User-Agent navigateur atteint
`beatport.com/search` et `traxsource.com/search` en 200 OK, mais le `fetch`
de Node (undici — ce que les deux providers utilisent) reçoit systématiquement
la page challenge Cloudflare "Just a moment..." (403), avec les mêmes headers.
Cloudflare fingerprinte la poignée de main TLS (JA3/JA4), pas seulement les
headers HTTP — undici et curl ont des empreintes différentes. Le fallback
Google déjà en place ne contourne pas ce blocage : `fetchProductPage` dans
les deux providers réutilise le même `fetch` pour charger la page produit
trouvée via Google, donc elle échoue de la même façon.

Séparément : Amazon Music documente déjà (commentaire dans
[amazon-music.ts](../../../../lib/providers/amazon-music.ts)) avoir besoin de
~25s worst-case avec Playwright (lancement Chromium + `goto` + attente
forcée), mais l'orchestrateur cap dur à 8s par provider
([route.ts](../../../../app/api/search/route.ts)) via `Promise.race` — donc
Amazon Music perd quasi systématiquement la course au timeout, indépendamment
de tout blocage réel.

## Décisions

- **Beatport et Traxsource passent sur Playwright** pour leurs deux points de
  fetch (recherche directe + page produit trouvée via Google), comme Amazon
  Music déjà — un vrai moteur Chromium contourne le fingerprinting TLS.
  Aucune autre logique ne change : le parsing HTML (cheerio pour Traxsource,
  extraction `__NEXT_DATA__` pour Beatport) reste identique, seule la façon
  d'obtenir le HTML change.
- **Le fallback Google (`lib/google-search.ts`) reste sur `fetch`** — Google
  n'est pas concerné par ce blocage (non vérifié à nouveau ici, hérité de la
  vérification live du chantier précédent).
- **Nouveau module partagé `lib/browser-fetch.ts`** — extrait le lancement de
  navigateur commun aux 3 providers (Amazon Music inclus, refactoré pour
  l'utiliser aussi) au lieu de dupliquer la logique Playwright 3 fois.
  Signature : `fetchHtmlViaBrowser(url, { gotoTimeoutMs?, postGotoWaitMs? }):
  Promise<string | null>` — ne lève jamais, `null` en cas d'échec (réseau,
  navigation, lancement du navigateur).
- **Timeout orchestrateur par provider** — `route.ts` gagne une table de
  surcharges (`Amazon Music`, `Beatport`, `Traxsource` → 15s au lieu du
  défaut 8s), pour laisser à Playwright le temps de démarrer un navigateur +
  naviguer, ce que les 3 providers scrapés-via-navigateur nécessitent
  désormais.
- **Amazon Music : `waitForTimeout` réduit de 5000ms à 2500ms** — pour
  laisser plus de marge dans le nouveau budget de 15s (lancement Chromium +
  `goto` + attente), au lieu de consommer déjà un tiers du budget sur cette
  seule attente fixe.

## Tests

- `test/providers/beatport.test.ts` et `test/providers/traxsource.test.ts` —
  remplacent le mock de `global.fetch` par un mock du nouveau module
  `lib/browser-fetch` (`vi.mock` + `fetchHtmlViaBrowser` mocké par URL) — les
  fixtures HTML et les assertions restent inchangées, seul le point
  d'interception change.
- `test/providers/amazon-music.test.ts` — simplifié : mock direct de
  `fetchHtmlViaBrowser` au lieu de mocker `playwright-core`/`@sparticuz/chromium`
  et reconstruire un faux `browser`/`context`/`page` à la main.
- Nouveau `test/browser-fetch.test.ts` — teste le module partagé isolément
  (mock `playwright-core`), pour garder au moins un point de test qui vérifie
  le vrai lancement Playwright plutôt que de le mocker partout.
- `test/api/search.test.ts` — inchangé (l'override de timeout par provider
  est un détail interne à `runProvider`, pas testé via des noms de provider
  réels dans les tests existants qui utilisent des `fakeProvider` génériques).

## Découverte en cours d'implémentation (2026-07-10)

Bloqueur non anticipé au design initial : `@sparticuz/chromium` fournit un
binaire Chromium compilé pour Amazon Linux (Lambda/Vercel serverless) — sur
une machine de dev Windows, `chromium.executablePath()` renvoie un chemin
qui n'existe pas (`spawn ...\Temp\chromium ENOENT`), donc **les 3 providers
échouaient à 100% en local avant même d'atteindre Cloudflare**, y compris
Amazon Music (déjà cassé avant ce chantier, pas seulement Beatport/
Traxsource). `lib/browser-fetch.ts` branche donc désormais le lancement du
navigateur selon l'environnement : `@sparticuz/chromium` + `playwright-core`
sur Vercel (`process.env.VERCEL`), sinon le Edge/Chrome système via l'option
`channel` de `playwright-core` (aucun téléchargement supplémentaire, marche
sur toute machine Windows).

Deuxième découverte : le blocage Cloudflare n'est pas purement une histoire
de fingerprint TLS — un vrai navigateur piloté par Playwright en mode
**headless** reçoit aussi le challenge par intermittence (le même navigateur
en mode **headed** passe systématiquement dans nos tests manuels). Ajout de
deux contre-mesures anti-détection à bas coût (`--disable-blink-
features=AutomationControlled` + masquage de `navigator.webdriver`) — mais
constaté empiriquement **non déterministe** : plusieurs essais identiques
donnent des résultats différents (bloqué puis passant sans changement de
code). Le blocage semble reposer sur un score de confiance IP/comportemental
côté Cloudflare, pas un test binaire. Documenté comme risque résiduel connu,
cohérent avec la section "Fragilité du scraping" du design MVP initial — pas
un bug corrigeable à 100% côté client.

## Hors scope

- Amazon Music lui-même n'est pas migré vers le module partagé pour ses
  paramètres spécifiques au-delà de ce que couvre `postGotoWaitMs` — s'il a
  besoin d'un comportement plus divergent plus tard, il redeviendra
  autonome.
- Aucun changement de la stratégie anti-bot pour Apple Music/Bandcamp — non
  concernés (API officielle / `bcsearch_public_api`, pas de scraping HTML).
