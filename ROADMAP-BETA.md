# Du MVP à une vraie app : feuille de route (lancement bêta)

Cadre choisi : **bêta avec quelques vrais utilisateurs au Bénin**. On vise le solide minimum, pas la perfection.
Priorités demandées : fiabilité prod, vraies clés + revue des plateformes, refonte du front, nouvelles fonctions.

## Principes
- Chaque lot = une série de commits, testée, avec le design écrit **avant** de toucher au front.
- Ce qui dépend de comptes que seul Yan possède (FedaPay live, clés IA, applications TikTok / Meta / Google) est préparé côté code et documenté, jamais simulé comme « fait ».

## Lot 1 : confiance et conformité (code, faisable tout de suite)
1. **E-mail** : vérification d'adresse, mot de passe oublié, via un petit « mailer » (console en dev, Resend en prod).
2. **Données de l'utilisateur** : export JSON, suppression du compte (jetons réseaux et état effacés, paiements anonymisés et conservés).
3. **Pages légales** : conditions d'utilisation et confidentialité (brouillons à faire relire), liens dans l'app. Les plateformes les exigent pour la revue.
4. **Exploitation** : journaux structurés (une ligne JSON par requête, sans données personnelles), sauvegarde de la base, `/healthz` avec test de la base, CI GitHub Actions (tests à chaque push).

## Lot 2 : vraies clés et revue des plateformes (surtout administratif)
- FedaPay : passer en `live` après les tests sandbox, webhook de production.
- IA : choisir le fournisseur par défaut selon coût et qualité en français, fixer les modèles.
- TikTok, Instagram, YouTube : dossier de revue d'application par plateforme (vidéo de démonstration, pages légales, justification des portées).
- Je prépare les textes et captures ; **la soumission se fait avec tes comptes**.

## Lot 3 : base de données et déploiement
- **Bêta : on garde SQLite** sur un volume persistant avec sauvegarde quotidienne (une instance suffit pour quelques dizaines d'utilisateurs). Passer à Postgres coûte cher et n'apporte rien à cette échelle.
- Déclencheur pour migrer vers Postgres : plus d'une instance, ou plus de quelques milliers d'utilisateurs actifs.
- Hébergement : une petite machine avec Docker + proxy HTTPS (Caddy). Détail à choisir avec toi (budget, région).

## Lot 4 : refonte du front (après la bêta, avec design)
- Sortir du fichier HTML unique : Vite + React, composants, tests, CSP stricte (sans script inline).
- Se fait écran par écran, derrière les mêmes routes d'API. Un document de design est écrit et relu avant le premier commit front.

## Lot 5 : fonctions produit (selon retours de la bêta)
Rappels (e-mail / WhatsApp / notifications push, demandent une tâche planifiée serveur), objectifs de vues adaptés à l'audience, statistiques plus riches, plusieurs artistes par compte (manager).

## Ordre proposé
Lot 1 → Lot 3 (déploiement bêta) → Lot 2 en parallèle (délais des plateformes) → retours bêta → Lots 4 et 5.


## Fait depuis (Synthia)

- Rebaptisé Synthia, thème clair / sombre, palette teal / orange / lime.
- Éléments de démonstration retirés, nouvelles fonctions du front (agenda .ics, WhatsApp, textes modifiables, démarrage guidé, Aide), sécurité du compte.
- Reste du lot « refonte du front » : écrans de l'onboarding en plusieurs pas, retours utilisateurs de la bêta.
- Déclencheurs inchangés : domaine, clés FedaPay / IA, dossiers de revue des plateformes, relecture juridique des pages légales (placeholders `[À FAIRE VALIDER]`).
