# Design MVP : Manager avec serveur

> Ce document décrit le MVP à l'époque où le projet s'appelait Manager. Le nom, le thème et les fonctions du front sont désormais décrits dans `DESIGN-SYNTHIA.md`.

## Lecture de la demande

Passer de la maquette PWA (tout en `localStorage`, tout simulé) à un vrai MVP :
comptes + base de données, textes et conseils par l'IA (Claude, Gemini ou Grok au choix),
paiement Mobile Money en sandbox, connexion réelle aux réseaux (OAuth).
Le front de l'équipe (plan par règles, écrans, PDF, hors-ligne) reste la base. On ajoute un serveur
et on branche le front dessus, sans casser le mode « invité » de la démo.

## 1. Architecture

```
navigateur (PWA, public/)  ──HTTPS──►  Express (server/)  ──►  SQLite (data/manager.db)
                                          ├─► IA : Anthropic / Gemini / xAI (clés côté serveur)
                                          ├─► FedaPay (sandbox) : paiement + webhook
                                          └─► TikTok / Instagram / YouTube : OAuth + stats
```

- Node 22, Express, `better-sqlite3`, SDK `fedapay`. Pas d'autre dépendance (cookies, limitation de débit, en-têtes : écrits à la main).
- `createApp(deps)` reçoit la config, la base et les clients externes → tests avec de faux fournisseurs, sans réseau.
- Le serveur sert aussi `public/` (même origine, donc cookies de session sans CORS).

## 2. Modèle de données (SQLite, migrations numérotées)

| Table | Colonnes principales |
|---|---|
| `users` | id, email (unique, minuscule), pass_hash (scrypt), premium_until, ai_provider, created_at |
| `sessions` | token_hash (sha-256), user_id, expires_at |
| `user_state` | user_id, key, json, updated_at, clé primaire (user_id, key) |
| `payments` | id, user_id, offer, amount, provider, provider_tx, status, created_at, paid_at |
| `social_accounts` | user_id, platform, ext_id, name, access_enc, refresh_enc, expires_at, status, last_sync |
| `social_snapshots` | id, user_id, platform, taken_at, f, v, l, p |
| `oauth_states` | state, user_id, platform, verifier, expires_at |
| `ai_usage` | user_id, day, count |

`user_state` reprend les clés `localStorage` du front : `prof, st, plan, done, res, soc, demo, reco, arch, seen`.
**`offer` n'y est pas** : l'offre se déduit de `users.premium_until` (le client ne peut pas se passer en PREMIUM).

## 3. API

| Route | Rôle |
|---|---|
| `POST /api/auth/register`, `login`, `logout` | e-mail + mot de passe (8 caractères min.), cookie `sid` HttpOnly, SameSite=Lax |
| `GET /api/me` | utilisateur, offre, `premium_until`, fournisseurs IA disponibles, mode paiement, réseaux configurés |
| `GET /api/state`, `PUT /api/state/:key` | état de l'utilisateur (clés autorisées seulement, 256 Ko max par clé) |
| `PUT /api/me/ai` | choix du fournisseur IA (`claude`, `gemini`, `grok`) parmi ceux configurés |
| `POST /api/ai/plan` | corps `{profil, actions}` → `[{id,text}]` (contrat déjà attendu par le front). PREMIUM |
| `POST /api/ai/advice` | corps `{profil, week, results}` → `{tips:[…]}`. PREMIUM |
| `POST /api/pay/checkout` | crée la transaction FedaPay, renvoie `{url}` (ou la page de simulation en dev) |
| `GET /api/pay/return` | retour après paiement : **vérifie le statut chez FedaPay**, active PREMIUM, redirige vers `/?paid=1` |
| `POST /api/pay/webhook` | webhook signé (corps brut + `x-fedapay-signature`), idempotent |
| `GET /api/social` | comptes connectés + dernier relevé + historique |
| `GET /api/social/:p/connect` | renvoie l'URL d'autorisation (state + PKCE sauvés en base) |
| `GET /oauth/callback/:p` | échange du code contre jeton côté serveur, chiffre, stocke, premier relevé |
| `POST /api/social/:p/sync`, `DELETE /api/social/:p` | relevé manuel, déconnexion (supprime les jetons) |
| `GET /healthz` | santé |

## 4. IA

- Trois adaptateurs derrière une même interface `complete({system, user}) → texte` : Anthropic Messages, Gemini `generateContent`, xAI (compatible OpenAI `chat/completions`).
- Le serveur envoie le profil et la liste d'actions du plan par règles. L'IA ne **décide** pas du plan : elle **réécrit les textes** (posts, légendes, messages) et donne des **conseils** pour le bilan.
- Sortie demandée en JSON, **validée** : ids connus seulement, texte non vide, 600 caractères max, pas de HTML. Tout ce qui est invalide est ignoré.
- Repli : si le fournisseur échoue, répond lentement (timeout 20 s) ou n'est pas configuré, le serveur renvoie `[]` / des conseils par règles. Le front garde alors le texte du moteur à règles (c'est déjà son comportement).
- Quota : 30 appels IA par jour et par utilisateur (configurable). Badge « ✨ IA » sur les textes réécrits.
- Les champs libres du profil sont envoyés comme données (délimités), jamais comme instructions.

## 5. Paiement (FedaPay sandbox)

- Offre unique : PREMIUM 5 000 FCFA, 30 jours, empilables.
- Flux : `checkout` → transaction + token → l'utilisateur paie sur la page FedaPay (Mobile Money) → retour `/api/pay/return?id=…` → le serveur **relit la transaction** chez FedaPay, `approved` → `premium_until += 30 j`.
- Webhook : filet de sécurité, signature vérifiée par le SDK avec le secret du webhook, traitement idempotent (statut `approved` déjà appliqué = rien).
- Le front ne peut jamais déclarer « payé ». Le retour avec `?paid=1` ne fait que rafraîchir `/api/me`.
- `PAY_MODE=simulate` (interdit en production) : page de paiement locale pour développer sans clé.

## 6. Réseaux (OAuth réel)

- Code d'autorisation + `state` (+ PKCE pour Google). Mot de passe jamais vu par Manager. Lecture seule.
- Jetons chiffrés en AES-256-GCM (clé `TOKEN_KEY`, 32 octets en base64), jamais renvoyés au navigateur.
- Données récupérées : abonnés (f), vues (v), likes (l), publications (p). Ce qu'une API ne donne pas reste `null` et le front garde sa saisie manuelle de secours.
- Un relevé est enregistré à la connexion, puis à chaque « Actualiser » (limité à 1 par heure et par réseau).
- Réseau non configuré (pas de clé) : le bouton propose le mode démo, comme aujourd'hui.

## 7. Sécurité

- scrypt (N=16384) + sel par mot de passe, comparaison en temps constant, message d'erreur identique pour e-mail inconnu / mauvais mot de passe.
- Cookie de session : jeton aléatoire 32 octets, seul son hachage est en base, `Secure` en production.
- Protection CSRF : cookie SameSite=Lax + les requêtes qui modifient exigent `Content-Type: application/json` et un `Origin` identique à `APP_URL`.
- Limitation de débit en mémoire : connexion 10 / 15 min / IP, API générale 300 / 15 min / IP.
- En-têtes : `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, CSP (le front contient du script inline : `'unsafe-inline'` pour le script, noté comme dette).
- Corps JSON limité à 512 Ko, requêtes SQL toutes paramétrées, aucune clé API dans le front.

## 8. Changements du front (public/index.html)

Seulement ce qui est nécessaire, le reste ne bouge pas.

1. **Couche de stockage** : `useLS` garde `localStorage` (mode invité). Connecté, il lit l'état serveur au démarrage et envoie les changements (anti-rebond 600 ms) vers `PUT /api/state/:key`.
2. **Écran « Compte »** dans Paramètres : créer un compte / se connecter / se déconnecter. À la première connexion, les données d'invité du navigateur sont proposées à l'import (une fois).
3. **Offre** : `offer` vient de `/api/me`, plus de `localStorage`. En invité, tout reste FREE. Le bouton « Payer » devient « Passer à PREMIUM » → `checkout` → redirection FedaPay. L'ancienne fenêtre de paiement simulé est supprimée.
4. **IA** : `AI_CFG.endpoint='/api/ai/plan'` activé quand connecté et PREMIUM. Choix du fournisseur dans Paramètres. Conseils IA dans Suivi (« Analyse de la semaine »), en plus des règles.
5. **Réseaux** : si le serveur indique le réseau configuré, « Connecter » ouvre l'URL d'autorisation ; au retour, `GET /api/social` remplit `soc`. Sinon mode démo actuel.
6. **Service worker** : `/api/*` et `/oauth/*` ne passent jamais par le cache (réseau seulement). Version du cache incrémentée.

## 9. Ce qui ne se teste pas ici (à dire clairement)

Pas de clé réelle dans cet environnement : IA, FedaPay et OAuth sont testés contre de **faux serveurs locaux** qui reproduisent les formats documentés. Le premier vrai test avec de vraies clés se fait chez vous (checklist dans le README). Les points non confirmés (noms de modèles Gemini / Grok, périmètres d'approbation d'application TikTok / Instagram) sont réglables par variables d'environnement.

## 10. Tests

- `node --test` : auth, état, IA (faux fournisseurs, sortie invalide, repli, quota), paiement (retour vérifié, webhook, idempotence, faux paiement), OAuth (state, chiffrement, échange avec faux fournisseur).
- Playwright : inscription, plan, passage PREMIUM en simulation, texte IA, connexion réseau mockée, rechargement.

## 11. Écrans du front (précisions avant codage)

**Paramètres → carte « Mon compte »** (première carte)
- Invité : deux onglets « Créer un compte » / « Me connecter », champs e-mail + mot de passe (8 caractères min.), un bouton, erreur sous les champs. Phrase : « Sans compte, tes données restent dans ce navigateur. »
- Connecté : e-mail, offre (et date de fin si PREMIUM), bouton « Me déconnecter » (efface les données locales de l'appareil puis recharge). Si PREMIUM et plusieurs fournisseurs IA : puces « Claude / Gemini / Grok » pour choisir.
- Après une connexion : si le compte est vide et que le navigateur contient déjà un profil ou un plan → fenêtre « Importer les données de ce navigateur dans ton compte ? » (Importer, ou Plus tard). Si le compte contient déjà des données, elles remplacent celles du navigateur. « Plus tard » laisse les données du navigateur telles quelles (elles se synchronisent au fil des modifications).

**Offres** : le bouton PREMIUM lance le paiement (invité → message « Crée un compte » + ouverture de Paramètres). Texte sous le titre : « mode test, aucun argent réel » en simulation, « paiement sécurisé FedaPay » sinon. Si PREMIUM : « Actif jusqu'au … ». La fenêtre de paiement simulé de la maquette est supprimée.

**Retours de redirection** : `/?paid=ok|pending|failed|error|login` → message + rafraîchit l'offre + ouvre Offres. `/?social=ok|denied|error&p=…` → message + recharge les réseaux + ouvre le Tableau de bord. L'adresse est nettoyée ensuite.

**Réseaux** : réseau configuré sur le serveur + connecté → redirection vers la plateforme ; sinon fenêtre de mode démo existante. Un compte réel affiche « connecté », « Actualiser » appelle le serveur (1 relevé / heure), un champ vide reste en saisie manuelle.

**Suivi** : après l'analyse par règles, si PREMIUM + IA disponible, ajout de lignes « ✨ … » (conseils IA) ; mention « ✨ Conseils IA en cours… » pendant l'appel.

**Plan** : textes réécrits par l'IA = `ai:true`, avec la pastille déjà prévue par la maquette.

## 12. Lot 1 bêta : écrans du compte (précisions avant codage)

Tout se passe dans **Paramètres → Mon compte** et au chargement de la page. Aucun nouvel onglet.

**Invité**
- Sous le formulaire : lien « Mot de passe oublié ? » → remplace le formulaire par un champ e-mail + bouton « Envoyer le lien ». Réponse affichée : « Si un compte existe avec cette adresse, un e-mail vient d'être envoyé. » Lien « Retour ».
- Mention sous le bouton de création : « En créant un compte, tu acceptes les conditions d'utilisation et la politique de confidentialité » (deux liens, ouverts dans un nouvel onglet).

**Connecté**
- Si l'e-mail n'est pas vérifié : ligne « Adresse non confirmée » + bouton « Renvoyer l'e-mail » (jamais bloquant).
- Bouton « Télécharger mes données » (fichier JSON).
- Zone « Supprimer mon compte » : bouton rouge discret → fenêtre de confirmation avec champ mot de passe, texte « Ton profil, ton plan, tes relevés et tes connexions seront effacés. Les paiements restent enregistrés sans ton nom. » → boutons Annuler / Supprimer définitivement. Après succès : données locales effacées, rechargement.
- Liens en bas de la carte : Conditions · Confidentialité.

**Liens reçus par e-mail**
- `/?verify=JETON` : confirmation silencieuse, message « Adresse confirmée ✓ », adresse nettoyée, ouverture de Paramètres.
- `/?reset=JETON` : ouvre Paramètres avec la carte « Nouveau mot de passe » (un champ, 8 caractères min.). Succès : message, formulaire de connexion affiché. Lien invalide : message d'erreur et retour au formulaire « Mot de passe oublié ».
