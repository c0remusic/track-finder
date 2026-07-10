# Rafraîchissement UI/UX + dark mode + identité — design

## Contexte

Demande directe d'Antoine (2026-07-10, tard le soir, "je corrigerai demain") :
rechercher les ressources shadcn pertinentes, améliorer l'UI/UX/design,
ajouter des animations JS "un peu cool", une identité de marque sobre mais
cool, un bascule dark mode, auditer le tout, travailler en autonomie sans
demander d'avis intermédiaire et choisir moi-même les versions/solutions
recommandées. Décisions ci-dessous actées seul, à corriger/valider demain.

État de départ : page fonctionnelle mais nue — titre/description restés au
défaut "Create Next App" (jamais personnalisés), favicon Next.js par défaut,
5 SVG de démo Next.js inutilisés dans `public/`, thème shadcn 100% niveaux
de gris (`--primary`/`--accent`/etc. tous en oklch chroma 0), aucune
variable dark mode branchée (le CSS `.dark` existe déjà dans `globals.css`
depuis l'init shadcn mais rien ne bascule la classe), état "pending" d'un
provider affiché en simple texte "Recherche…", aucune animation.

## Recherche (shadcn)

Pattern officiel confirmé via `ui.shadcn.com/docs/dark-mode/next` (pas
deviné) : `ThemeProvider` (wrapper client de `next-themes`), `<html
suppressHydrationWarning>`, provider avec `attribute="class"`
`defaultTheme="system"` `enableSystem` `disableTransitionOnChange`.
`next-themes@0.4.6` (dernière version publiée, vérifié `npm view`).

Pas de nouveau composant shadcn installé au-delà de l'existant
(badge/button/card/input) — le bouton de bascule dark mode et le skeleton
de chargement sont assez simples pour rester inline (Tailwind
`animate-pulse` + icônes lucide déjà en dépendance) plutôt que d'ajouter
`switch`/`dropdown-menu`/`skeleton` pour un seul usage chacun (YAGNI).

## Décisions

- **Dark mode** : `next-themes` + `ThemeProvider` (pattern officiel
  ci-dessus). Toggle simple 2 états (pas de menu système/clair/sombre à 3
  options — over-engineered pour la demande "pouvoir basculer"), icône
  soleil/lune (lucide `Sun`/`Moon`), `defaultTheme="system"` comme valeur
  initiale respectée au premier chargement.
- **Identité de marque, sobre** : un seul accent chromatique (indigo/violet
  `oklch`, cohérent clair/sombre) appliqué à `--primary`/`--ring`/liens —
  le reste de la palette reste neutre (gris), pas de arc-en-ciel. Un petit
  monogramme SVG (deux disques qui se chevauchent, évoque vinyle/recherche)
  à côté du titre "Track finder", réutilisé comme favicon
  (`app/icon.tsx`, généré via `next/og` `ImageResponse` — évite de gérer un
  fichier `.ico` binaire à la main). Titre/description de page réels dans
  `app/layout.tsx` (`metadata`), remplaçant le défaut "Create Next App".
- **Nettoyage** : suppression des 5 SVG de démo Next.js dans `public/`
  (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) —
  vérifié inutilisés (`grep` sur `app/`, `components/`, `lib/`).
- **Animations "JS" (`motion`, ex-Framer Motion, `12.42.2`, vérifié `npm
  view`)** : réservées à des moments qui ont un vrai bénéfice UX, pas
  décoratif partout —
  - Apparition en cascade des 5 lignes de résultat (`AchatSection`) au lieu
    d'un pop-in instantané.
  - Transition de hauteur/opacité de chaque ligne quand son statut passe de
    `pending` à son état final (`found`/`not_found`/`error`) — actuellement
    un remplacement de texte instantané.
  - Micro-interaction sur le bouton de recherche (état pressed/loading).
  Pas d'animation sur le header/logo/toggle (repos visuel, pas de
  mouvement perpétuel — cohérent avec "sobre").
- **État "pending" → skeleton** au lieu du texte "Recherche…" — un bloc
  `animate-pulse` (Tailwind natif, pas de dépendance) à la place du futur
  lien/badge, feedback visuel plus clair qu'une recherche est en cours par
  ligne (les providers arrivent en flux SSE à des vitesses différentes).
- **État vide (avant toute recherche)** : actuellement juste le formulaire
  + le footer, rien entre les deux. Ajout d'un sous-titre sobre sous le
  titre expliquant ce que fait l'outil en une phrase — pas d'illustration
  ni de hero complexe (reste minimal).
- **Accessibilité** : région `aria-live="polite"` autour de la liste de
  résultats (les mises à jour arrivent en flux SSE sans interaction
  utilisateur ultérieure — un lecteur d'écran doit les annoncer). Pas
  d'autre changement a11y identifié comme cassé à l'audit (voir section
  Audit).

## Hors scope (différé, pas oublié)

- Logos réels par plateforme (Beatport/Traxsource/etc.) — risque de
  marque/droit d'auteur à évaluer, hors scope d'une session nocturne
  autonome ; icône générique conservée à la place si besoin visuel (pas
  ajoutée finalement, le texte seul reste assez lisible).
- Historique de recherche, favoris, partage, tri/filtrage des providers —
  aucun n'a été demandé, ajout aurait été une fonctionnalité spéculative
  hors du périmètre "améliorer l'UI/UX/design existant".
- Menu dark/light/system à 3 états — toggle binaire suffit à la demande
  explicite ("pouvoir basculer").

## Audit (à faire après implémentation)

- `npx tsc --noEmit`, `npm run build`, `npm run test` — gate obligatoire
  avant tout commit (déjà la convention du repo).
- Vérification visuelle en direct (clair + sombre, desktop + mobile) via
  le navigateur de preview — pas seulement le typecheck.
- Une passe de revue de code (agent dédié, lecture seule) sur l'ensemble du
  diff avant de considérer le chantier terminé, vu qu'aucun humain ne
  relira avant demain matin.
