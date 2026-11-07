# Design : Manager v2 en PWA, avec bouton de mode et identité du pitch

## Lecture de la demande

- `Manager_v2.html` = la nouvelle base fonctionnelle de l'équipe (plan personnalisé, réseaux, bilan, PDF, paramètres).
  Rien de sa logique, de ses données ou de ses écrans ne change.
- `MANAGER_pitch.pptx` = le pitch. Il montre l'identité visuelle à reprendre (accent jaune-vert, titres en capitales
  condensées) et confirme les offres : FREE 0 FCFA, PREMIUM 5 000 FCFA/mois (déjà identiques dans v2).
- On remet par-dessus : la PWA et le bouton « Mode PC / Mode mobile » de la version précédente.

## 1. Bouton de mode

- Libellé : « Mode PC » quand on est en mobile, « Mode mobile » quand on est en PC. Icône écran / téléphone.
- PC : dans le menu latéral, au-dessus de « Réinitialiser la démonstration ».
- Mobile (vrai téléphone) : dans l'en-tête, à gauche de la roue des paramètres. L'en-tête peut passer sur 2 lignes
  sur un écran très étroit.
- Mobile sur grand écran : dans le coin haut droit de la page, hors du cadre téléphone.
- Choix gardé dans le navigateur sous une clé à part (`pwa-view`), pour que « Réinitialiser la démonstration » ne l'efface
  pas. Premier affichage : PC à partir de 1024 px, sinon mobile.

## 2. Mise en page

- Mode PC : la mise en page de v2 telle quelle (menu latéral de 16 rem, contenu jusqu'à 72 rem, colonnes).
- Mode mobile sur écran de 600 px ou plus : cadre de téléphone centré (24 rem de large, 52 rem de haut au maximum,
  sans dépasser l'écran). Le défilement, la barre d'onglets, les fenêtres et les messages restent dans le cadre.
- Mode mobile sur téléphone (moins de 600 px) : plein écran, comme v2.
- Mode PC sur téléphone : la page prend une largeur de 1100 px (comme « version pour ordinateur »).
- Les mises en page ne dépendent plus de la largeur de la fenêtre mais du mode choisi, sinon le cadre téléphone
  afficherait des colonnes de bureau. À remplacer : les classes `sm:grid-cols-*` de l'accueil, les hauteurs et
  largeurs en `vh` / `vw` des fenêtres (passent en pourcentage), et le retour en haut de page (vers le cadre).

## 3. PWA

- Identique à la version précédente : manifest, service worker (mise en cache de tout au premier chargement),
  icônes, bouton « Installer » visible seulement quand le navigateur le propose.
- Plus aucun CDN : React, ReactDOM, htm, **jsPDF** (export PDF de PREMIUM, qui marche donc hors-ligne) et le CSS
  Tailwind compilé sont des fichiers locaux.
- Icône : note blanche remplacée par la note jaune-vert du pitch.

## 4. Identité du pitch (limitée aux moments de marque)

Couleurs du pitch : jaune-vert `#D8FF3E`, texte clair `#F4F1FF`, fond sombre `#0B0816`, magenta `#C026D3`, rose `#E879F9`.

- Accueil, bandeau sombre : petite ligne « Pour les artistes émergents » en jaune-vert, titre en capitales condensées
  avec « entendue. » en jaune-vert, bouton principal « Commencer gratuitement » jaune-vert avec texte sombre.
- Section « Comment ça marche » → « Ta promo, en 3 pistes », numéros 01 / 02 / 03 en magenta, comme la slide 6.
- Carte « Pensé pour l'Afrique » → « Pensé pour les artistes africains », comme la slide 7.
- Le jaune-vert n'est utilisé que sur fond sombre ou en fond de bouton avec texte sombre (contraste suffisant).
  Il n'apparaît jamais comme texte sur fond blanc.
- Le reste de l'application (menus, formulaires, cartes, boutons violets) ne change pas.

## 5. Ce qui ne change pas

Logique du plan, données de démonstration, connexions réseaux de démonstration, bilan, offres et prix, paiement
simulé, textes hors accueil. Le fichier du pitch n'est pas modifié.
