# Design : Synthia (ex-Manager), thème clair / sombre, version professionnelle

Document de design du front, écrit AVANT le code et relu avant chaque changement du front.
Base : `DESIGN-MVP.md` (serveur, comptes, paiement, IA, réseaux) et `docs-front-pwa.md` (PWA, identité du pitch).

## 1. Lecture de la demande

1. **Nom** : le projet s'appelle Cynthia. On garde le son, on change l'écriture pour quelque chose de plus parlant.
2. **Mode clair / sombre** : l'utilisateur peut basculer à la main.
3. **Professionnaliser** : retirer ce qui n'existait que pour la démo, ajouter les fonctions importantes d'une vraie application.

## 2. Nom : Synthia

- Se prononce comme Cynthia. « Synth » (synthétiseur, musique électronique) + « IA » (le moteur de recommandation).
- Wordmark : `SYNTH` + `IA` en couleur d'accent (orange). Même son, deux sens lisibles d'un coup d'œil.
- Marque (icône) : carré arrondi teal avec 5 barres de forme d'onde (égaliseur), au lieu de la note.
- Partout où l'utilisateur lit « Manager » (interface, e-mails, PDF, pages légales, prompts IA, manifest, README) : « Synthia ».
- **Ce qui ne change pas volontairement** (pour ne perdre aucune donnée existante) :
  - clés `localStorage` `mgr:*` (invisibles, des utilisateurs ont déjà des brouillons),
  - nom du fichier de base par défaut `data/manager.db` et le volume Docker `manager-data` (renommer = base vide).
  Les sauvegardes `manager-*.db` restent reconnues. Le nom visible de l'export de données devient `synthia-mes-donnees.json`.

## 3. Identité visuelle

Le deck a quitté le violet (teal + orange + lime). L'application suit, pour une seule identité.

| Rôle | Clair | Sombre |
|---|---|---|
| `--bg` fond | `#F3FAF9` | `#041A19` |
| `--card` cartes | `#FFFFFF` | `#0A2B29` |
| `--tx` texte | `#0B2220` | `#EAFBF8` |
| `--mut` texte discret | `#4B6B68` | `#93B8B3` |
| `--bd` bordures | `#D3E8E5` | `#17413E` |
| `--stg` fond hors cadre téléphone | `#E4F1EF` | `#021110` |
| `--pri` / `--pri2` boutons, puces actives | `#0F766E` → `#0D8077` | idem |
| `--pt` texte, icônes, liens accentués | `#0F766E` | `#5EEAD4` |
| `--ac` accent chaud (texte) | `#C2410C` | `#FFA45C` |
| `--lime` | `#D8FF3E`, **uniquement** sur fond sombre ou en fond de bouton avec texte sombre | idem |
| `--ok` / `--err` | `#15803D` / `#B91C1C` | `#4ADE80` / `#F87171` |

- Aucune couleur en dur dans les composants : tout passe par ces variables (sauf le bandeau « hero », toujours sombre dans les deux thèmes).
- Contrastes visés : texte courant ≥ 4,5:1, gros texte et éléments d'interface ≥ 3:1. Vérifiés par script (section 9).
- Hero : fond `linear-gradient(160deg,#0F3F3B,#041A19)` + lueur orange en haut à droite. Titres en capitales condensées, comme le pitch.
- Illustration de l'accueil et graphiques recolorés (teal, orange). Courbes en `var(--pt)`, objectifs en pointillés `var(--mut)`.

## 4. Mode clair / sombre

- **Trois états** mémorisés : *Auto* (suit le système, défaut), *Clair*, *Sombre*. Un clic fait tourner Auto → Clair → Sombre.
- Clé de stockage `pwa-theme` (hors du préfixe `mgr:`, donc « Effacer mes données » ne la supprime pas).
- Appliqué par un petit script dans `<head>` **avant** le premier affichage (pas de flash blanc) : `data-theme="light|dark"` sur `<html>`, rien en Auto.
- `color-scheme` suit le thème (champs de formulaire, barres de défilement). `theme-color` du navigateur mis à jour.
- Emplacement du bouton, même logique que « Mode PC / Mobile » :
  - PC : menu latéral, au-dessus du bouton de mode.
  - Mobile : en-tête, à côté de la roue des paramètres (icône seule, 3 icônes : lune / soleil / écran).
  - Mobile sur grand écran (cadre téléphone) : coin haut droit, à côté du bouton de mode.
  - Aussi dans Paramètres > Apparence (texte explicite « Automatique / Clair / Sombre »).
- Accessibilité : `aria-label` dit l'état courant et l'action (« Thème : automatique. Passer en clair »).

## 5. Retrait de ce qui n'existait que pour la démo

| Élément actuel | Décision |
|---|---|
| Artiste d'exemple (Zeynab Kora), `ST_EX`, `RES0`, drapeau `demo`, bandeaux « Mode démo », « Données fictives » | Supprimés. `DEF0` ne sert plus que de valeurs par défaut neutres (genre, langue, réseaux, budget). |
| « Réinitialiser la démonstration » | Remplacé par **Mes données** dans Paramètres : « Repartir de zéro » (efface profil, plan et suivi de ce navigateur, avec confirmation). Un compte connecté garde ses données serveur, sauf suppression du compte. |
| Faux réseaux sociaux (`DEMO`, `mkHist`, fenêtre de consentement fictive, « Simuler une actualisation ») | Supprimés. Un réseau non configuré côté serveur affiche **« Bientôt disponible »** (bouton désactivé) ; la saisie manuelle des chiffres reste. |
| `OA_CFG` / `startOAuth` côté navigateur | Supprimés (le serveur fait déjà tout le flux). |
| Délai artificiel de 900 ms avant le plan | Supprimé. L'écran d'attente ne s'affiche que pendant l'appel réel (IA Premium). |
| Textes « L'IA sera branchée », « IA à connecter », « quand les intégrations seront disponibles » | Réécrits au présent (« Textes rédigés par IA »). |
| « Comment Manager gagne de l'argent » | Devient « Pourquoi Premium ? » |
| `Paramètres : Outils pour présenter en démonstration` | « Compte, apparence et données ». |
| Mode de paiement `simulate` du serveur | **Reste** pour le développement (interdit en production par `validateConfig`) ; la bannière « Mode test » s'affiche seulement dans ce cas. |
| Clé serveur `demo` dans l'état synchronisé | Ignorée côté front, tolérée côté serveur (anciens comptes). |

## 6. Fonctions ajoutées

Choisies pour leur valeur réelle pour un artiste, leur testabilité, et parce qu'elles ne demandent ni nouveau service payant ni clé externe.

1. **Agenda (.ics)** : bouton « Ajouter à mon agenda » dans Mon plan. Un événement par action avec rappel 1 h avant, dates calculées depuis la date de sortie. Fonctionne hors ligne, pour tous les utilisateurs.
2. **Partage WhatsApp** : à côté de « copier », un bouton qui ouvre `wa.me` avec le texte (le réseau le plus utilisé du public cible).
3. **Texte modifiable** : le texte d'une action peut être retouché (zone éditable, « Rétablir »). Mémorisé avec le plan, jamais écrasé par un « Régénérer » sans confirmation.
4. **Démarrage guidé** : liste de 4 étapes sur le tableau de bord (profil, audience, plan, premier résultat) avec progression, masquable.
5. **Sécurité du compte** (serveur + écran) : changer le mot de passe (ancien requis, les autres sessions sont fermées), « Me déconnecter partout ».
6. **Page Aide** : FAQ (comment est fait le plan, données et confidentialité, Premium, réseaux), liens légaux, contact (`SUPPORT_EMAIL`, repli : texte sans lien).
7. **Robustesse** : écran d'erreur de secours (si un écran plante, message + « Recharger », les données ne sont pas perdues) et bandeau « Hors ligne » (les saisies restent en local, la synchro reprend seule).

Hors périmètre, notées dans la feuille de route : rappels par e-mail ou notification push (demandent une tâche planifiée serveur), objectifs de vues adaptés à l'audience, import automatique des relevés, multilingue (fon, yoruba), analyse de la concurrence.

## 7. Écrans touchés

- **Tous** : variables de thème, wordmark, boutons.
- **Accueil** : texte Synthia, illustration recolorée.
- **Tableau de bord** : carte « Démarrage » (nouveau), plus de bandeaux démo, réseaux « Bientôt disponible ».
- **Mes plans** : boutons Agenda, WhatsApp, édition du texte.
- **Paramètres** : sections Compte (+ sécurité), Apparence, Mes données.
- **Aide** (nouveau) : entrée dans le menu latéral et dans l'en-tête mobile (via Paramètres, pour ne pas surcharger la barre du bas à 4 onglets).
- **Pages légales, e-mails, PDF, manifest, SW** : nom Synthia, cache `synthia-1`.

## 8. Ce qui ne change pas

Logique du plan, moteur de règles, budgets, offres et prix (FREE 0 FCFA, PREMIUM 5 000 FCFA/mois), flux de paiement FedaPay, IA (Claude, Gemini, Grok), OAuth serveur, bilan, PDF Premium, mode PC / mobile, PWA.

## 9. Vérifications prévues

- Script de contraste (WCAG) sur toutes les paires de la section 3, clair et sombre.
- Tests serveur : changement de mot de passe, déconnexion globale, nom dans les e-mails.
- e2e Chromium : bascule de thème (persistance après rechargement), plus aucune mention « démo » à l'écran, export .ics valide, bouton WhatsApp, texte modifiable, aide.
- Captures d'écran clair + sombre, mobile + PC, relues avant livraison.

## 10. Révision : palette par défaut violet, palettes au choix, thème par image ou vidéo

Décision de Yan : la palette par défaut reste le **violet d'origine** de l'app de l'équipe. Le teal / orange que j'avais mis par défaut
(sans qu'on me le demande) devient une palette au choix. Le deck et l'app ne sont donc plus alignés par défaut.

### 10.1 Trois palettes, deux modes chacune

| Palette | Rôle | Source |
|---|---|---|
| **Violet** (défaut) | identité de l'app de l'équipe | valeurs d'origine de `Manager_v2` (fond `#0B0816`, accent `#7C3AED` → `#C026D3`, lime du pitch) |
| **Teal** | identité du deck recoloré | section 3 |
| **Personnalisée** | couleurs tirées d'une image ou d'une vidéo de l'utilisateur | section 10.2 |

Chaque palette existe en clair et en sombre ; le bouton de mode (auto / clair / sombre) reste indépendant du choix de palette.

Valeurs du violet (variables identiques à la section 3) :

| Variable | Clair | Sombre |
|---|---|---|
| `--bg` / `--card` | `#FAF8FF` / `#FFFFFF` | `#0B0816` / `#16102A` |
| `--tx` / `--mut` | `#17112B` / `#6B6588` | `#F4F1FF` / `#A79FC4` |
| `--bd` / `--stg` | `#E6E0F5` / `#E9E5F5` | `#2A2147` / `#05030C` |
| `--pri` → `--pri2` | `#7C3AED` → `#C026D3` | idem |
| `--pt` (texte accentué) | `#7C3AED` | `#B98CFF` |
| `--ac` (accent chaud) | `#A21CAF` | `#F0ABFC` |

### 10.2 Thème personnalisé (image ou vidéo)

- **Entrée** : un fichier image (`image/*`, 15 Mo max) ou vidéo (`video/*`, 80 Mo max). Rien n'est envoyé au serveur : tout se fait dans le navigateur, le fichier n'est pas gardé.
- **Extraction** : l'image (ou une image de la vidéo, prise à la moitié de sa durée, 1 s au plus) est réduite à 48 × 48. Les pixels assez saturés votent pour une teinte (36 classes de 10°, pondérés par la saturation). La teinte gagnante donne la couleur principale, une deuxième teinte à plus de 40° donne l'accent (sinon teinte + 35°). Image presque grise : palette neutre à teinte légère.
- **Construction** : à partir de la teinte et de la saturation (bornée 35 % à 80 %), on dérive les 20 variables du thème, en clair et en sombre.
- **Garantie de lisibilité** : un correcteur de contraste ajuste la luminosité de chaque couleur de texte et de bouton jusqu'à atteindre 4,5:1 (WCAG AA) sur son fond. Une image très claire, très sombre ou très vive ne peut donc pas rendre l'app illisible.
- **Image en fond** : une miniature (JPEG 640 px max) sert de fond du bandeau « hero », sous un voile sombre qui garantit le texte blanc.
- **Stockage** : localStorage de l'appareil (`pwa-pal`, `pwa-custom`), hors du préfixe `mgr:` (« Repartir de zéro » ne l'efface pas). Si le stockage est plein : le thème s'applique pour la session, sans miniature.
- **Retour** : bouton « Retirer mon thème » → palette violet.
- **Application** : le script de tête lit `pwa-pal` et `pwa-custom` avant l'affichage et pose les variables sur `<html>` (pas de flash).

### 10.3 Ce qui devient variable (plus aucune couleur de palette en dur)

Bandeau hero (3 teintes), texte sur hero (2), illustration de l'accueil (4), barres du graphique, anneau de progression, barres d'égaliseur, bulle de message, `theme-color` du navigateur, icône (violet pour la palette par défaut).

### 10.4 Interface

Paramètres > Apparence : « Mode » (automatique / clair / sombre), « Palette » (Violet / Teal / Personnalisée), bouton « Importer une image ou une vidéo », aperçu des couleurs obtenues, « Retirer mon thème ». Messages d'erreur en clair (fichier trop lourd, format non lu, vidéo illisible).

### 10.5 Vérifications

- `scripts/check-contrast.js` couvre violet et teal, clair et sombre.
- e2e : choix de palette mémorisé ; import d'images de test (jaune vif, presque blanc, presque noir, gris, rouge saturé) : toutes les paires texte / fond du thème obtenu ≥ 4,5:1 dans les deux modes ; fichier non image refusé.
