# Retirer les metadata du flux de recherche actuel — design

## Contexte

Aujourd'hui, `aggregateSearch` ([route.ts](../../../../app/api/search/route.ts)) agrège
les 5 providers en un seul flux SSE et construit `metadata` (bpm/key/genre/label)
à partir des résultats `found` de la même recherche, envoyé dans l'event `done`
aux côtés des liens d'achat. Le frontend ([page.tsx](../../../../app/page.tsx))
affiche les deux en sections empilées sur la même page.

L'utilisateur veut que les metadata deviennent une fonctionnalité séparée à
part entière (recherche indépendante, providers différents de ceux du flux
achat, déclenchement propre), à concevoir dans un futur chantier. En
attendant, il veut d'abord que la recherche "Où acheter" tourne seule et
proprement, sans le poids ni l'affichage des metadata.

## Objectif

Retirer les metadata du flux de recherche et de l'affichage actuels, sans
construire la future recherche séparée maintenant. Le contrat de données par
provider (`ProviderResult.metadata`, `ProviderMetadata`) reste inchangé —
chaque provider continue de remplir ce champ dans son résultat individuel,
il n'est simplement plus agrégé ni affiché pour l'instant. C'est la base de
données dont la future recherche metadata séparée aura besoin.

## Changements

- **`app/api/search/route.ts`** — `aggregateSearch` arrête de construire et
  de renvoyer `metadata` : `buildMetadata`, le type `AggregatedMetadata` et
  le champ `metadata` sur `AggregatedResult` sont supprimés. L'event SSE
  `done` ne porte plus de payload utile (signal de fin de flux uniquement).
- **`app/page.tsx`** — suppression de l'état `metadata`, de l'import et du
  rendu de `MetadataSection`, et de la section "Metadata" de la page. Ne
  reste que la section "Où acheter".
- **`components/MetadataSection.tsx`** — supprimé (inutilisé après ce
  changement ; l'historique git le conserve si besoin pour le futur
  chantier metadata).
- **`lib/providers/types.ts` et chaque provider** — inchangés. `metadata`
  reste rempli par Beatport/Traxsource (bpm/key/genre/label) et Apple Music
  (genre) dans leur `ProviderResult` individuel.

## Tests

- `test/api/search.test.ts` — le test `"merges metadata across found
  providers, keeping conflicting values with their source"` est supprimé
  (il teste `buildMetadata`, qui n'existe plus). Les 5 autres tests
  d'`aggregateSearch` restent inchangés — aucun ne porte sur `metadata`.
- Aucun nouveau test nécessaire : c'est un retrait de fonctionnalité, pas un
  ajout de comportement.

## Hors scope

- La recherche metadata séparée (providers, endpoint, déclenchement à
  l'ouverture d'un onglet, réutilisation ou non du cache existant) — sujet
  d'un futur chantier, décisions déjà esquissées en conversation mais pas
  actées ici.
- Le composant d'onglets (Achat / Metadata) — pas de sens à construire tant
  qu'il n'y a qu'un seul onglet actif.
