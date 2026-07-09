# Track-finder — design

> Nom placeholder, à renommer plus tard. Nouveau projet, séparé du repo Sift
> (`dj-assistant-m6a`) volontairement — produit public distinct, cycle de vie
> et exposition légale différents.

## Contexte et objectif

Point de départ : Antoine cherche parfois une release qu'il ne trouve qu'en
fichiers de mauvaise qualité sur Soulseek. Besoin : un outil public gratuit
qui, à partir d'une recherche artiste/titre, indique sur quelles plateformes
la release est disponible **à l'achat** (Beatport, Traxsource, Amazon Music,
Bandcamp, Apple Music), avec lien direct — et séparément, remonte les
métadonnées disponibles (BPM, clé, genre, label, pochette) issues de ces
mêmes plateformes.

Ce n'est pas un scraper de catalogue complet ni une base de données
redistribuée : chaque recherche interroge les plateformes en direct, rien
n'est stocké côté serveur au-delà de la durée de la requête. Ce choix réduit
significativement le risque ToS par rapport à un index pré-construit (voir
section Risques).

Sift reste hors scope de ce document — le routage éventuel entre Sift et cet
outil est différé à une décision ultérieure (demande explicite d'Antoine :
"on verra plus tard pour le routing avec Sift").

## Décisions actées pendant le brainstorm

- Projet séparé, nouveau repo (`C:\Users\LEETJ\Desktop\track-finder`), pas
  un sous-dossier du repo Sift.
- Sources v1 : Beatport, Traxsource, Amazon Music, Bandcamp, Apple Music
  (5, toutes dès la v1 — pas de v1 réduite).
- Interface : site web avec recherche (UI) + endpoint API JSON, pas juste une
  API sans façade.
- Stack : Next.js (App Router) + React + Tailwind/shadcn (via MCP `shadcn`
  déjà connecté), déployé sur Vercel.
- Mode de recherche : recherche unitaire, un champ texte libre (pas de
  décomposition artiste/titre) — pas de recherche par lot en v1.
- Stratégie de fetch : en direct à la demande, aucun index/cache de catalogue
  persistant.
- Deux sections de résultat distinctes : **Où acheter** (liens d'achat) et
  **Metadata** (BPM/clé/genre/label/pochette), jamais mélangées.
- La section metadata est alimentée par les 5 mêmes plateformes (pas par
  Discogs/MusicBrainz — déjà couvert côté Sift séparément). MusicBrainz jugé
  moins pertinent que Discogs pour l'électronique (couverture plus faible,
  Discogs historiquement plus spécialisé sur ce créneau).
- Règle d'affichage : une plateforme où le titre **n'existe vraiment pas**
  (`not_found`) est invisible dans "Où acheter" (pas de bruit) ; une
  plateforme où la recherche **a échoué** (`error` — blocage anti-bot,
  timeout) reste affichée explicitement ("indisponible pour l'instant") —
  distinction volontaire, cohérente avec la règle Sift "jamais de fallback
  silencieux".
- Nom du projet : placeholder générique pour l'instant, à trancher plus tard.
- Apple Music : API iTunes Search publique/gratuite (pas MusicKit) — corrigé
  après revue, voir section Architecture.
- Cache court (~1h) par requête identique, pour réduire la charge de
  scraping — ajouté après revue, voir Gestion d'erreurs.

## Architecture

App Next.js full-stack unique (UI + API dans le même projet), déployée sur
Vercel.

Flux : utilisateur soumet une requête texte → `GET /api/search?q=...` →
l'API lance en parallèle 5 "adapters" (un par plateforme), chacun avec son
propre timeout (~5-8s) via `Promise.allSettled` → agrégation des résultats →
réponse JSON unique → UI affiche les deux sections.

Apple Music : correction actée après vérification (revient sur la décision
initiale du brainstorm) — MusicKit (API officielle, compte Developer 99$/an)
ne gère pas l'achat, seulement le catalogue/streaming. On utilise à la place
l'**API iTunes Search publique** (`itunes.apple.com/search`), gratuite, sans
compte ni clé, stable depuis plus de 10 ans, qui renvoie un `trackViewUrl`
pointant directement vers la page d'achat iTunes Store — mieux adaptée au
besoin et sans coût. Pas de scraping nécessaire pour cette source, risque
ToS nul.

Amazon Music : vérifié, le store MP3 à l'unité existe toujours (~1,29$/piste,
DRM-free, indépendant de l'abonnement streaming) — l'hypothèse "achat
possible" tient.

Les 4 autres (Beatport, Traxsource, Amazon Music, Bandcamp) n'ont
pas d'API publique accessible et nécessitent du scraping de leurs pages de
recherche publiques.

Mécanisme de scraping non figé à ce stade : v1 démarre avec des requêtes
HTTP simples + parsing HTML (cheerio, léger et rapide). Si une plateforme
bloque ce pattern (Cloudflare, rendu JS obligatoire), l'adapter concerné
passera à un navigateur headless (Playwright) — traité comme un spike
technique par adapter pendant l'implémentation, pas décidé à l'avance pour
les 4, pour éviter de sur-engineer (YAGNI). Point d'attention connu : les
functions serverless Vercel supportent mal Playwright standard (poids du
binaire Chromium, cold start) — si un adapter en a besoin, il faudra soit un
build Chromium allégé compatible serverless, soit héberger cet adapter à
part (petit service Node persistant hors Vercel). Décision différée à
l'implémentation, une fois le besoin réel constaté par adapter.

## Composants

- `app/page.tsx` — page de recherche : champ texte + bouton, zone de
  résultats scindée en `AchatSection` / `MetadataSection`, plus un pied de
  page avec mention légale visible ("liens fournis à titre indicatif, non
  affilié aux plateformes listées") — mitigation standard et peu coûteuse
  vu le risque ToS déjà documenté.
- `app/api/search/route.ts` — orchestrateur : lance les 5 adapters en
  parallèle, agrège, renvoie un JSON unique.
- `lib/providers/{beatport,traxsource,amazon-music,bandcamp,apple-music}.ts`
  — un adapter par plateforme, interface commune :
  ```ts
  type ProviderResult = {
    platform: string;
    status: "found" | "not_found" | "error";
    purchaseUrl?: string;
    coverUrl?: string;
    matchedArtist?: string;
    matchedTitle?: string;
    metadata?: { bpm?: number; key?: string; genre?: string; label?: string };
  };
  search(query: string): Promise<ProviderResult>;
  ```
- `components/AchatSection.tsx` — n'affiche que les entrées `found` ou
  `error` (jamais `not_found`), distinction visuelle claire entre un vrai
  résultat et un état d'erreur (shadcn Card/Badge).
- `components/MetadataSection.tsx` — agrège les champs metadata disponibles
  toutes plateformes confondues ; en cas de valeurs contradictoires entre
  deux plateformes (ex. BPM différent), affiche les deux avec leur source
  plutôt que d'en choisir une arbitrairement en silence.

Chaque adapter est isolé : testable/déboguable indépendamment, un
changement de sélecteur HTML sur une plateforme ne casse que son propre
adapter.

## Flux de données

1. Utilisateur soumet une requête sur `/` (chaîne libre, ex. "Robert Hood
   Minus" — pas de décomposition artiste/titre côté track-finder ; chaque
   adapter passe la chaîne telle quelle à la recherche native de sa
   plateforme, qui gère son propre matching).
2. `page.tsx` appelle `GET /api/search?q=...`.
3. L'API lance les 5 adapters en parallèle (`Promise.allSettled`, timeout
   individuel).
4. Chaque adapter renvoie son `ProviderResult`.
5. L'API filtre les `not_found` (masqués), garde `found` + `error` pour
   "Où acheter", fusionne les champs `metadata` des `found` (conflits
   affichés avec leur source, jamais résolus en silence).
6. Réponse JSON unique renvoyée au client.

Aucune persistance serveur au-delà de la durée de la requête.

## Gestion d'erreurs

- Timeout par adapter (~5-8s) : bascule en `error`, ne bloque pas les 4
  autres.
- Blocage anti-bot détecté (page inattendue reçue, ex. challenge Cloudflare)
  : traité en `error`, distinct de `not_found` (recherche réellement
  exécutée sans résultat).
- Crash d'un adapter (exception, sélecteur cassé) : catché individuellement
  via `Promise.allSettled`, n'affecte pas les autres adapters ni la réponse
  globale.
- Rate limiting global par IP (ex. Upstash Redis, gratuit à petit volume) —
  garde-fou contre un usage abusif qui ferait exploser le volume de requêtes
  sortantes vers les 5 plateformes ; mécanisme exact à affiner en
  implémentation.
- Aucun retry automatique agressif : un échec reste affiché tel quel pour
  cette recherche, pas de re-tentative silencieuse qui multiplierait la
  charge/le risque de ban IP sur les sites scrapés.
- **Cache court par requête identique** (ex. ~1h, en mémoire ou edge) : deux
  recherches identiques dans cette fenêtre réutilisent le résultat au lieu
  de re-scraper — réduit le volume de requêtes sortantes et le risque de ban
  IP, sans reconstituer un index de catalogue (TTL court, clé = requête
  exacte, pas un stockage progressif de tout ce qui a été cherché).

## Tests

- Par adapter : tests unitaires sur fixtures HTML statiques (page de
  résultat de recherche sauvegardée par plateforme) — vérifie l'extraction
  correcte des champs attendus. Ne détecte pas un changement de sélecteur en
  prod avant que ça casse, mais garantit la logique de parsing elle-même.
- Orchestrateur `/api/search` : tests avec adapters mockés (pas de réseau
  réel) — vérifie agrégation, filtrage `not_found`, fusion metadata,
  isolation des erreurs/timeouts par adapter.
- Pas de test end-to-end contre les vrais sites en CI (fragile, casse à
  chaque refonte HTML, risque de déclencher la détection anti-bot à chaque
  commit). À la place : script de smoke-test manuel, lancé à la main pour
  vérifier ponctuellement que les 5 adapters fonctionnent encore.
- `tsc --noEmit` comme gate de base avant tout commit.

## Risques connus (non résolus par ce document)

- **ToS / légal** : Beatport limite explicitement l'usage commercial de ses
  données (approbation écrite requise) ; Amazon Music et Traxsource n'ont
  pas d'API publique auto-inscriptible ; Bandcamp n'a aucune API de lecture
  du catalogue. Le choix "fetch en direct, pas d'index stocké" réduit le
  risque par rapport à une copie de base de données, mais ne l'élimine pas.
  Antoine a été informé qu'un avis juridique qualifié reste recommandé avant
  un lancement public, en particulier vu l'intention de commercialiser Sift
  séparément. Ce document ne constitue pas un avis juridique.
- **Fragilité du scraping** : casse à chaque refonte HTML des plateformes
  scrapées ; pas de garantie de continuité de service à long terme sur les 4
  sources scrapées (Apple Music, via API officielle, n'a pas ce risque).
- **Coût Playwright potentiel** : si un ou plusieurs adapters nécessitent un
  navigateur headless, l'hébergement/coût de cette partie reste à valider
  (Vercel serverless mal adapté à Playwright standard).

## Hors scope (différé)

- Routage/intégration avec Sift — décision explicitement reportée par
  Antoine.
- Recherche par lot (plusieurs titres à la fois).
- Index/cache de catalogue persistant.
- Nom final du produit / branding.
