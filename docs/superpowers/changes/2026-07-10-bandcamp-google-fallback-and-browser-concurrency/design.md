# Bandcamp Google fallback + Google/browser concurrency fix — design

## Contexte

Signalement direct : une recherche "mona bone ticon" ne trouvait pas
`iboga-beatspace.bandcamp.com/album/rewind` (le morceau "Monda Bone" de
Ticon existe pourtant bel et bien sur Bandcamp). Vérifié en direct contre
l'API Bandcamp elle-même : `bcsearch_public_api` renvoie **zéro résultat**
pour une requête combinée artiste+titre à 3 mots ("mona bone ticon"), alors
que "ticon" seul trouve l'album et "monda bone" seul trouve le morceau —
un vrai trou de couverture côté recherche Bandcamp, pas une faute de frappe
utilisateur (l'orthographe "Mona"/"Monda" divergeant elle-même entre
Discogs et Bandcamp, sans lien avec le bug).

## Décisions

- **Fallback Google pour Bandcamp** (`lib/providers/bandcamp.ts`), même
  pattern que Beatport/Traxsource : `findViaGoogle(query, "bandcamp.com",
  ...)` déclenché quand l'autocomplete direct ne renvoie aucun résultat de
  type track. La page produit trouvée (track ou album) est parsée via son
  attribut `data-tralbum` embarqué (JSON), extrait `artist` et
  `current.title` — fonctionne pour les deux types de page sans distinction.
- **Découverte en cours d'implémentation : Google bloque aussi `fetch`
  brut.** Vérifié en direct : une requête Node `fetch` vers
  `google.com/search` reçoit une page de challenge JS ("enablejs"), `#search`
  vide — alors qu'un vrai navigateur Playwright reçoit les vrais résultats.
  Même famille de détection que Cloudflare/Akamai sur Beatport/Traxsource/
  Amazon Music. `lib/google-search.ts` bascule donc aussi sur
  `fetchHtmlViaBrowser` (`lib/browser-fetch.ts`, module déjà partagé).
  `MAX_PAGES` réduit de 2 à 1 (chaque page est maintenant un lancement de
  navigateur coûteux, plus un simple fetch HTTP).
- **Découverte en testant celle-ci : contention de ressources.** Avec
  jusqu'à 4 providers (Amazon Music, Beatport, Traxsource, Bandcamp)
  pouvant chacun avoir besoin d'un navigateur réel simultanément, une
  requête qui échoue partout peut déclencher 6-8 instances Chromium
  concurrentes. Constaté en direct : une requête a pris 24s et **4
  providers ont rapporté "error" au lieu de "not_found"** — la boucle
  d'événements Node était suffisamment saturée pour que les timeouts
  `setTimeout` de l'orchestrateur se déclenchent en retard sur le vrai
  travail. Corrigé par un **sémaphore de concurrence** dans
  `lib/browser-fetch.ts` (`MAX_CONCURRENT_BROWSERS = 2`) — les lancements
  au-delà de la limite attendent en file plutôt que de tous partir en même
  temps.
- **Timeouts orchestrateur réajustés** (`app/api/search/route.ts`) pour
  tenir compte de la file d'attente introduite par le sémaphore : Amazon
  Music 28s (corrigé après revue — son propre budget interne, 20s de
  `gotoTimeoutMs` + 2.5s de `postGotoWaitMs`, dépassait déjà son ancienne
  surcharge de 20s), Beatport/Traxsource/Bandcamp 30s (jusqu'à 3 lancements
  de navigateur séquentiels dans leur pire cas : recherche propre + Google
  + page produit trouvée). `maxDuration` de la route passé à 40s (toujours
  confortablement sous le plafond Hobby de 60s).

## Vérifié en direct

- Requête "mona bone ticon" (fraîche, non cachée) : Bandcamp retourne
  désormais `found` → `iboga-beatspace.bandcamp.com/track/monda-bone`,
  12.9s, aucune erreur technique sur les 5 providers.
- Rejoué en cache hit : résolution instantanée et cohérente.
- Suite de tests : 54/54 (ajout d'un test de couverture pour le sémaphore
  de concurrence, dont l'absence avait été relevée par la revue de code).

## Audit

Revue de code adverse dédiée (agent séparé) — 1 finding critique confirmé
et corrigé (décalage budget Amazon Music, voir ci-dessus), 1 gap de
couverture de test comblé (sémaphore de concurrence). Le reste (décodage
d'entités HTML dans `bandcamp.ts`, patterns de mock des tests) vérifié
sain, sans changement nécessaire.

## Hors scope

- Pas de pool de navigateurs partagé entre providers (optimisation plus
  invasive) — le sémaphore simple suffit à éviter la contention constatée,
  sans changer l'architecture "un provider, sa propre logique" du repo.
- Pas de correction floue générale des fautes de frappe côté recherche —
  le fallback Google couvre déjà la plupart des cas où la recherche directe
  de la plateforme est trop stricte.
