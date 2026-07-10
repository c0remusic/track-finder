# Réutilisation du navigateur partagé — perf — design

## Contexte

Demande directe : "on peut améliorer la vitesse ?" après un exemple de
recherche montrant Traxsource et Amazon Music en "Indisponible pour
l'instant" (erreur technique, pas juste lent). Le principal coût identifié :
`lib/browser-fetch.ts` lançait un **nouveau processus Chromium complet à
chaque appel**, puis le fermait — alors qu'un seul provider peut appeler
`fetchHtmlViaBrowser` 2-3 fois par recherche (recherche propre + fallback
Google + page produit). Lancer un navigateur coûte 1-3s ; ouvrir une page
dans un navigateur déjà lancé coûte quelques centaines de ms.

## Décision

`lib/browser-fetch.ts` garde désormais **un seul processus Chromium partagé
en vie** pour la durée du module (un conteneur Vercel "chaud", ou tout le
process `next dev` en local), au lieu d'en relancer un à chaque appel.
Chaque appel ouvre juste un `context`+`page` légers dans ce navigateur
déjà lancé, et ferme uniquement le `context` après usage (pas le
navigateur). Détection de déconnexion via `browser.isConnected()` (API
réelle vérifiée dans les types `playwright-core`) — si le navigateur
partagé est mort, le prochain appel en relance un.

Le limiteur de concurrence, qui plafonnait avant les **lancements de
navigateur** à 2, plafonne maintenant les **ouvertures de page** à 3
(`MAX_CONCURRENT_PAGES`) — une page coûte bien moins qu'un processus
navigateur complet, la limite peut donc être un peu plus généreuse.

## Vérifié en direct

- Recherche à froid (premier lancement) : 9.2s (contre 20-30s+ avant, avec
  la contention de ressources du chantier précédent).
- Deuxième recherche fraîche (navigateur déjà chaud) : 7.5s.
- Requête exacte du signalement précédent ("Ticon Mona Bone") : 7.5s,
  **zéro erreur technique** cette fois (avant : Traxsource + Amazon Music
  en erreur) — la contention de ressources qui causait ces faux "error"
  disparaît presque entièrement avec un seul processus navigateur au lieu
  de plusieurs concurrents.

## Audit

Revue de code adverse dédiée — 2 findings confirmés et corrigés :
1. Commentaire obsolète dans `route.ts` décrivant encore l'ancien modèle
   "2 navigateurs concurrents max" au lieu du nouveau "3 pages concurrentes
   partagées entre tous les providers".
2. Les budgets de timeout par provider (calibrés pour l'ancien modèle)
   n'avaient plus de marge réelle sous le nouveau modèle de contention par
   page partagée entre 4 providers — recalculés : Beatport/Traxsource/
   Bandcamp 30s→40s, Amazon Music 28s→35s, `maxDuration` 40s→50s (toujours
   sous le plafond Hobby de 60s).

Le reste (cycle de vie du navigateur partagé, détection de race sur le
lancement, sémaphore de pages, isolation des tests via
`vi.resetModules()`) vérifié sain, aucun changement nécessaire.

## Hors scope

- Pas de pool de plusieurs navigateurs (un seul suffit vu le gain déjà
  obtenu ; ajouter un pool serait de la sur-ingénierie sans preuve que la
  limite actuelle de 3 pages soit un vrai goulot en usage réel).
- Pas de fermeture explicite du navigateur partagé en fin de requête — le
  laisser vivant entre requêtes (conteneur Vercel chaud, process `next dev`
  local) est le comportement voulu, pas un oubli.
