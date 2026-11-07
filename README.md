# Synthia : MVP

Application de plan de promotion musicale pour artistes émergents (hackathon IA & Musique, SIMA 2026).
Le front est la PWA de l'équipe (`public/`), le serveur ajoute **comptes, base de données, IA, paiement Mobile Money et connexion aux réseaux**.

- Front : PWA (hors-ligne, installable), mode PC / mobile, plan par règles, bilan, export PDF.
- Serveur : Node 22, Express, SQLite (`better-sqlite3`), SDK `fedapay`.
- Détails d'architecture : [`DESIGN-MVP.md`](DESIGN-MVP.md). Front d'origine : [`docs-front-pwa.md`](docs-front-pwa.md).

## Lancer en local

```bash
npm install                 # .npmrc : better-sqlite3 utilise ses binaires précompilés, pas de compilateur requis
cp .env.example .env        # puis remplir ce qui vous intéresse
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → TOKEN_KEY
npm start                   # http://localhost:3000
```

Sans aucune clé, tout fonctionne sauf l'IA et les réseaux : paiement en **simulation** de développement (`PAY_MODE=simulate`, interdit en production), réseaux affichés « bientôt disponible » (saisie manuelle des chiffres possible).

### Scripts de lancement (installent les dépendances, créent `.env`, démarrent le serveur)

| Système | Commande |
|---|---|
| Windows | double-clic sur `scripts\start-windows.bat` |
| macOS | `./scripts/start-mac.sh` (ou double-clic sur `scripts/start-mac.command`) |
| Ubuntu / Debian | `./scripts/start-ubuntu.sh` |

Si Node 22+ manque, le script propose de l'installer (winget, Homebrew ou NodeSource) et attend ta réponse. `.env` est créé une seule fois, avec une `TOKEN_KEY` générée.

### Docker

```bash
node scripts/setup.js        # crée .env (TOKEN_KEY) ; ou : cp .env.example .env
docker compose up --build    # http://localhost:3000, base SQLite dans le volume « manager-data » (nom gardé de l'ancien nom du projet, pour ne perdre aucune donnée)
```

`docker-compose.yml` tourne en mode développement (paiement simulé possible). Pour un vrai déploiement : `NODE_ENV=production`, `APP_URL` en https, `PAY_MODE=fedapay` dans `.env`, derrière un proxy HTTPS.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `APP_URL` | Adresse publique (https en production). Sert aux redirections de paiement et OAuth |
| `TOKEN_KEY` | Clé AES-256 (32 octets base64) qui chiffre les jetons des réseaux. Obligatoire en production |
| `DB_PATH` | Fichier SQLite (sur un volume persistant) |
| `SUPPORT_EMAIL` | Adresse de contact affichée dans la page Aide (facultatif ; sans elle, la page n'affiche pas de lien de contact) |
| `MAIL_MODE`, `RESEND_API_KEY`, `MAIL_FROM` | E-mails de vérification et de mot de passe oublié. `console` écrit le lien dans les logs (dev) ; obligatoire en `resend` en production. Format de l'API Resend à vérifier avec ta clé |
| `LOG_REQUESTS` | `1` : une ligne JSON par requête, sans IP ni données |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | IA Claude (modèle par défaut `claude-sonnet-5-5`) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | IA Gemini (`generateContent`) |
| `XAI_API_KEY` / `XAI_MODEL` | IA Grok (API compatible OpenAI, `https://api.x.ai`) |
| `AI_DEFAULT`, `AI_DAILY_QUOTA` | Fournisseur par défaut, appels IA par jour et par utilisateur (30) |
| `PAY_MODE` | `simulate` (dev) ou `fedapay` (interdit : `simulate` en production) |
| `FEDAPAY_SECRET_KEY`, `FEDAPAY_ENV`, `FEDAPAY_WEBHOOK_SECRET` | FedaPay (`sandbox` ou `live`) |
| `PREMIUM_PRICE` | Prix en FCFA (5000) |
| `TIKTOK_CLIENT_KEY/SECRET`, `INSTAGRAM_CLIENT_ID/SECRET`, `YOUTUBE_CLIENT_ID/SECRET` | Un réseau sans clé s'affiche « bientôt disponible » |

Les adresses des API externes se changent aussi par variable (`*_BASE`, `*_AUTH_URL`), utile pour les tests.

## Tests

```bash
npm test      # 43 tests serveur (node:test), aucun accès réseau
npm run e2e   # parcours complet dans Chromium (Playwright requis), fournisseurs externes simulés
```

## Brancher les vraies clés (checklist)

Tout ce qui touche un service externe a été testé **contre des faux serveurs locaux** qui reproduisent les formats des documentations. Le premier essai avec de vraies clés est à faire par vous :

1. **FedaPay** : créer un compte sandbox, mettre `FEDAPAY_SECRET_KEY`, `PAY_MODE=fedapay`. Dans le tableau de bord FedaPay, ajouter le webhook `https://VOTRE_URL/api/pay/webhook` (événements `transaction.*`) et copier son secret (`wh_sandbox_…`) dans `FEDAPAY_WEBHOOK_SECRET`. Faire un paiement test : le retour doit afficher « PREMIUM activé ».
2. **IA** : mettre au moins une clé. À vérifier : les noms de modèle Gemini (`GEMINI_MODEL`) et Grok (`XAI_MODEL`) changent vite, ajuster selon la console de chaque fournisseur.
3. **Réseaux** : créer une application chez chaque plateforme, y déclarer l'URL de redirection `APP_URL/oauth/callback/tiktok` (idem `instagram`, `youtube`).
   - TikTok : produit Login Kit, portées `user.info.basic`, `user.info.stats`, `video.list`. Les vues sont la somme des 20 dernières vidéos (approximation).
   - Instagram : connexion Instagram Business, compte professionnel (créateur ou entreprise) obligatoire. Vues et likes ne sont pas relevés (saisie manuelle dans l'app).
   - YouTube : API Data v3, portée `youtube.readonly`. Écran de consentement Google à configurer.
   - Les plateformes exigent en général une **revue d'application** avant d'ouvrir l'accès à d'autres comptes que ceux de l'équipe : prévoir du temps après le hackathon.

## Exploitation (bêta)

- **Sauvegarde** : `npm run backup` copie la base à chaud dans `backups/` (14 copies gardées). Exemple de cron : `0 3 * * * cd /app && npm run backup`. Copie ce dossier hors de la machine.
- **Santé** : `GET /healthz` répond 200 si la base est lisible, 503 sinon.
- **Pages légales** : `public/legal/` contient des **brouillons** (conditions, confidentialité) avec des champs `[À COMPLÉTER]`. À faire relire avant de lancer.
- **CI** : `.github/workflows/ci.yml` lance les tests et le parcours e2e à chaque push.
- Feuille de route : [`ROADMAP-BETA.md`](ROADMAP-BETA.md).

## Déploiement

Docker : voir plus haut (`docker compose`), ou `docker build -t synthia . && docker run -p 3000:3000 -v manager-data:/data --env-file .env synthia`.
Mettre un proxy HTTPS devant (le cookie de session est `Secure` en production, `trust proxy` est activé).
Une seule instance : la base est un fichier SQLite et la limitation de débit est en mémoire.

## Sécurité, en bref

Mots de passe scrypt, sessions à jeton aléatoire (seul le hachage est en base), cookie HttpOnly + SameSite=Lax, contrôle d'Origin et JSON obligatoire sur les écritures, limitation de débit, jetons des réseaux chiffrés AES-GCM et jamais renvoyés au navigateur, `state` OAuth à usage unique, paiement **toujours revérifié auprès de FedaPay** (le navigateur ne peut pas déclarer « payé »), sortie de l'IA validée, données utilisateur envoyées à l'IA comme données et non comme consignes.

## Limites connues (MVP)

- La CSP autorise le script inline : le front de l'équipe est un seul fichier HTML. À extraire plus tard.
- L'export PDF et le blocage des fonctions PREMIUM du plan (campagnes multiples) restent appliqués côté navigateur. Côté serveur, seuls l'IA, l'offre et le paiement sont protégés.
- Pas de réinitialisation de mot de passe par e-mail, pas de suppression de compte en libre-service, pas de vérification d'e-mail.
- Synchronisation : le dernier appareil qui écrit gagne (pas de fusion).
- Les invités n'ont que l'offre FREE ; le paiement exige un compte.


## Synthia (ex-Manager) : nom, thème, fonctions

Détails et décisions : `DESIGN-SYNTHIA.md`.

- **Nom** : Synthia (se prononce comme Cynthia ; « synth » + « IA »). Le projet s'appelait Manager.
  Gardés volontairement pour ne rien casser : le fichier de base par défaut `data/manager.db`, le volume Docker `manager-data`, les clés `mgr:*` du navigateur et les sauvegardes `manager-*.db`.
- **Thème** : mode automatique (système), clair ou sombre ; palette **violet** (défaut, celle de l'app de l'équipe), **teal**, ou **personnalisée** : l'utilisateur importe une image ou une vidéo et Synthia en tire ses couleurs (teinte dominante + accent), avec correction automatique pour garder des contrastes ≥ 4,5:1. Le fichier est lu dans le navigateur, jamais envoyé ni gardé ; seules les couleurs (et une miniature pour le bandeau) restent dans le navigateur. `node scripts/check-contrast.js` vérifie les palettes fixes, l'e2e vérifie la palette personnalisée image par image.
- **Fonctions** : export du plan vers l'agenda (.ics), partage WhatsApp, texte d'action modifiable, démarrage guidé, page Aide, changement de mot de passe, déconnexion de tous les appareils, écran de secours et bandeau hors ligne.
- **Retiré** : artiste d'exemple, mode démo, faux comptes de réseaux sociaux, délai artificiel.
- `SUPPORT_EMAIL` : adresse de contact de la page Aide.
