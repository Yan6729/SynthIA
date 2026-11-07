'use strict';
/* Test de bout en bout : vrai serveur Synthia + vrai front dans Chromium, fournisseurs externes remplacés par un faux serveur local.
   Lancer : npm run e2e   (Playwright et Chromium doivent être installés) */
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const { loadConfig } = require('../server/config');
const { buildDeps } = require('../server/deps');
const { createApp } = require('../server/app');
const { openDb } = require('../server/db');

const mails = []; // e-mails « envoyés » pendant le test
const db = openDb(':memory:');

function fakeWorld() {
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const J = (o, s = 200) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      // IA (format Anthropic Messages)
      if (url.pathname === '/ai/v1/messages') {
        const body = JSON.parse(b);
        const data = JSON.parse(body.messages[0].content.split('<donnees>')[1].split('</donnees>')[0]);
        if (body.system.includes('"tips"')) return J({ content: [{ type: 'text', text: JSON.stringify({ tips: ['Poste ton teaser à 19 h', 'Réponds aux commentaires', 'Propose un duo'] }) }] });
        return J({ content: [{ type: 'text', text: JSON.stringify(data.actions.map((a) => ({ id: a.id, text: `Texte IA pour l'action ${a.id}` }))) }] });
      }
      // TikTok : page d'autorisation qui accepte tout de suite, puis jeton + profil
      if (url.pathname === '/tt/auth') return (res.statusCode = 302, res.setHeader('location', `${url.searchParams.get('redirect_uri')}?code=OKCODE&state=${url.searchParams.get('state')}`), res.end());
      if (url.pathname === '/tt/v2/oauth/token/') return J({ access_token: 'TT', refresh_token: 'TTR', expires_in: 86400 });
      if (url.pathname === '/tt/v2/user/info/') return J({ data: { user: { open_id: 'o1', display_name: 'Zeynab TT', follower_count: 3200, likes_count: 4100, video_count: 24 } } });
      if (url.pathname === '/tt/v2/video/list/') return J({ data: { videos: [{ view_count: 1000 }, { view_count: 500 }] } });
      J({ error: 'inconnu' }, 404);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const world = await fakeWorld();
  const W = `http://127.0.0.1:${world.address().port}`;
  const env = {
    NODE_ENV: 'test', PAY_MODE: 'simulate', TOKEN_KEY: crypto.randomBytes(32).toString('base64'),
    ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE: W + '/ai',
    TIKTOK_CLIENT_KEY: 'tk', TIKTOK_CLIENT_SECRET: 'ts', TIKTOK_BASE: W + '/tt', TIKTOK_AUTH_URL: W + '/tt/auth',
  };
  const cfg = loadConfig(env);
  const app = createApp(buildDeps(cfg, { db, mailer: { mode: 'test', send: async (m) => { mails.push(m); } } }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  cfg.appUrl = base;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const step = (n) => console.log('✓', n);
  const text = (t) => page.getByText(t, { exact: false }).first();
  const stateOnServer = async () => (await page.evaluate(() => fetch('/api/state').then((r) => r.json()))).state;

  await page.goto(base);
  await page.getByRole('button', { name: 'Paramètres' }).first().click();

  // 1. inscription
  await page.getByRole('button', { name: 'Créer un compte' }).first().click();
  await page.getByLabel('Adresse e-mail').fill('zeynab@test.com');
  await page.getByLabel(/Mot de passe/).fill('motdepasse1');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await text('zeynab@test.com · offre FREE').waitFor();
  step('inscription, compte affiché (FREE)');

  // 2. artiste d'exemple → état synchronisé sur le serveur
  await page.getByRole('button', { name: 'Charger l’exemple' }).click();
  await page.getByRole('button', { name: 'Charger l’artiste d’exemple' }).or(page.locator('[role=alertdialog] button.btn:not(.btn2)')).first().click();
  await page.waitForTimeout(1500);
  let st = await stateOnServer();
  assert.equal(st.prof.artist, 'Zeynab Kora');
  step('profil sauvegardé côté serveur');

  // 3. persistance : on vide le navigateur, l'état revient du compte
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('mgr:prof') || '{}'))).artist, 'Zeynab Kora');
  step('état restauré depuis le compte après effacement du navigateur');

  // 4. IA refusée en FREE : le plan reste celui des règles
  await page.getByRole('button', { name: 'Mes plans' }).first().click();
  await page.getByRole('button', { name: /Générer mon plan/ }).click();
  await page.getByText('Semaine 1', { exact: false }).first().waitFor();
  assert.equal(await page.getByText('Texte rédigé par IA').count(), 0);
  step('plan FREE sans texte IA');

  // 5. paiement simulé → PREMIUM
  await page.getByRole('button', { name: 'Offres' }).first().click();
  await page.getByRole('button', { name: 'Payer avec Mobile Money' }).click();
  await page.waitForURL(/\/api\/pay\/simulate\//);
  await page.getByRole('button', { name: 'Payer', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await text('PREMIUM actif jusqu’au').waitFor();
  const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
  assert.equal(me.user.offer, 'PREMIUM');
  assert.ok(!page.url().includes('paid='), 'adresse nettoyée');
  step('paiement simulé → PREMIUM actif');

  // 6. régénération : textes écrits par l'IA (faux Anthropic)
  await page.getByRole('button', { name: 'Mes plans' }).first().click();
  await page.getByRole('button', { name: 'Régénérer' }).click();
  await page.getByText('Texte rédigé par IA').first().waitFor({ timeout: 10000 });
  assert.match(await page.locator('body').innerText(), /Texte IA pour l'action/);
  step('textes IA dans le plan');

  // 7. conseils IA dans le suivi
  await page.getByRole('button', { name: 'Suivi' }).first().click();
  await page.getByRole('button', { name: /Générer le plan de la semaine suivante/ }).click();
  await page.getByText('✨ Poste ton teaser à 19 h').waitFor({ timeout: 10000 });
  step('conseils IA ajoutés à l’analyse');

  // 8. connexion TikTok réelle (OAuth contre faux TikTok)
  await page.getByRole('button', { name: 'Tableau de bord' }).first().click();
  await page.getByRole('button', { name: 'Connecter TikTok' }).click();
  await page.waitForURL((u) => u.pathname === '/' && u.hostname === '127.0.0.1' && u.port === String(server.address().port));
  await text('Zeynab TT').waitFor();
  assert.match(await page.locator('body').innerText(), /TikTok · connecté/);
  const accts = (await page.evaluate(() => fetch('/api/social').then((r) => r.json()))).accounts;
  assert.equal(accts.tiktok.hist[0].v, 1500);
  step('TikTok connecté via OAuth, statistiques affichées');

  // 9. déconnexion : le navigateur est nettoyé
  await page.getByRole('button', { name: 'Paramètres' }).first().click();
  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('mgr:prof') || '{}'))).artist || '', ''); // plus aucune donnée du compte sur l'appareil
  assert.equal((await page.evaluate(() => fetch('/api/me').then((r) => r.json()))).user, null);
  step('déconnexion et nettoyage du navigateur');

  // 10. mot de passe oublié par l'interface, avec le lien reçu par e-mail
  await page.getByRole('button', { name: 'Paramètres' }).first().click();
  await page.getByRole('button', { name: 'Me connecter' }).first().click();
  await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click();
  await page.getByLabel('Adresse e-mail').fill('zeynab@test.com');
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await text('Si un compte existe avec cette adresse').waitFor();
  const resetMail = mails.filter((m) => /nouveau mot de passe/i.test(m.subject)).pop();
  assert.ok(resetMail, 'e-mail de réinitialisation envoyé');
  await page.goto(resetMail.text.match(/https?:\/\/\S+reset=\S+/)[0].replace(/^https?:\/\/[^/]+/, base));
  await page.getByLabel(/Nouveau mot de passe/).fill('nouveaumdp9');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await text('Mot de passe changé').waitFor();
  assert.ok(!page.url().includes('reset='), 'adresse nettoyée');
  step('mot de passe oublié → lien e-mail → nouveau mot de passe');

  // 11. connexion avec le nouveau mot de passe, puis suppression du compte
  await page.getByLabel('Adresse e-mail').fill('zeynab@test.com');
  await page.getByLabel(/Mot de passe/).fill('nouveaumdp9');
  await page.getByRole('button', { name: 'Me connecter' }).last().click();
  await text('zeynab@test.com · offre').waitFor();
  assert.equal(await page.getByText('Adresse non confirmée').count(), 0); // le lien de réinitialisation a prouvé l'e-mail
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
  await page.getByLabel('Ton mot de passe').fill('nouveaumdp9');
  await page.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await page.waitForTimeout(1500);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM social_accounts').get().n, 0);
  assert.equal(db.prepare('SELECT user_id FROM payments').get().user_id, null);
  step('compte supprimé (paiement conservé sans lien)');

  await browser.close(); server.close(); world.close();
  if (errors.length) { console.error('Erreurs navigateur :\n' + errors.join('\n')); process.exit(1); }
  console.log('\nE2E OK');
})().catch((e) => { console.error('ÉCHEC E2E :', e); process.exit(1); });
