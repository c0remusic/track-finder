# Architecture — track-finder

> Produit par une analyse git forensics (co-changement de fichiers sur les
> 80 derniers commits, graphe d'imports, mapping test↔source) plutôt que
> par intuition — méthode reprise des grandes lignes de l'outil `sourcebook`
> (voir memory), sans installer l'outil lui-même.

## Ce que ça doit couvrir maintenant

**Centre de gravité réel du code** (pas supposé — mesuré) : `lib/browser-fetch.ts`
est le fichier le plus modifié du repo (15 commits sur 80) et le plus
importé (orchestrateur + `google-search.ts` + 3 providers Playwright). Toute
modification de ce fichier a un rayon d'impact large — c'est le vrai composant
critique, plus que `route.ts` qui l'appelle.

**Frontière client/server** : `app/page.tsx` et `components/AchatSection.tsx`
n'importent aujourd'hui que `lib/providers/names.ts` (liste plate, zéro
import) et `lib/providers/types.ts` (types uniquement, erased au build) —
jamais `lib/providers/index.ts` ni un provider directement. Cette frontière
est **actuellement respectée mais pas mécaniquement garantie** : rien
n'empêche un futur edit d'importer `lib/providers/index.ts` (ou
`amazon-music.ts`, qui tire `playwright-core`/`@sparticuz/chromium`) dans un
composant client, ce qui ferait planter le bundle. Voir "future needs" plus
bas — c'est le premier point à corriger.

**Couplage confirmé par co-changement** : `route.ts` ↔ `browser-fetch.ts` ↔
leurs tests bougent quasi toujours ensemble (3-6 co-occurrences sur 80
commits) — c'est le vrai noyau architectural, pas un détail d'implémentation.
`CLAUDE.md` ↔ `docs/INDEX.json` co-changent aussi systématiquement,
confirmant que la discipline de mise à jour de l'index est bien suivie.

**Trous de couverture test réels** (mesurés, pas supposés) : `lib/cache.ts`,
`lib/google-search.ts`, `lib/providers/index.ts`, `lib/rate-limit.ts`,
`lib/relevance.ts`, `lib/utils.ts` n'ont aucun fichier de test dédié.
`lib/relevance.ts` (filtre anti-faux-positif, cause du bug Bandcamp
"sven dose all in") et `lib/rate-limit.ts` (cause d'un 500 réel en prod) sont
les deux plus préoccupants : ce sont des modules déjà responsables
d'incidents documentés dans `CLAUDE.md`, et ils restent non testés.

## Ce que ça devra couvrir plus tard

- **Un 6e provider** (ou plus) : le pattern actuel (`lib/providers/{name}.ts`
  + entrée dans `names.ts` + `index.ts`) scale sans refonte tant que le
  nouveau provider suit la checklist de `.claude/rules/providers.md`. Pas de
  changement structurel anticipé nécessaire.
- **Retour de la metadata dans le flux de recherche** (voir section Différé
  du CLAUDE.md) — `ProviderResult.metadata` existe déjà côté contrat, donc le
  point d'extension est prêt ; seul l'affichage/déclenchement reste à faire
  le jour où ça revient.
- **Frontière client/server enforced** : passer de "convention respectée
  par chance" à "garantie par tooling" — voir la règle ESLint ajoutée dans
  `.claude/rules/providers.md`.

## Ce que ça ne couvre pas (hors scope assumé)

Pas de base de données, pas d'auth utilisateur, pas de compte — le seul état
est le cache (`lib/cache.ts`) et le rate limiting (Upstash, optionnel,
fail-open). Toute proposition d'ajouter une couche de persistance
utilisateur devrait repasser par une vraie passe `brainstorming`+`architect`,
pas être ajoutée incrémentalement.
