'use strict';
/* Test de bout en bout : vrai serveur Synthia + vrai front dans Chromium, fournisseurs externes remplacés par un faux serveur local.
   Lancer : npm run e2e   (Playwright et Chromium doivent être installés) */
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
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

  // 2. création du profil par le formulaire → état synchronisé sur le serveur
  await page.getByRole('button', { name: 'Profil' }).first().click();
  await page.getByLabel('Nom d’artiste').fill('Zeynab Kora');
  await page.getByLabel('Titre de la chanson').fill('Soleil de Cotonou');
  await page.getByLabel('Date de sortie souhaitée').fill('2026-12-04');
  await page.getByRole('button', { name: 'TikTok', exact: true }).click();
  await page.getByRole('button', { name: 'Créer mon profil' }).click();
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

  // 6b. fonctions du plan : agenda .ics, WhatsApp, texte modifiable
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Agenda/ }).click()]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(dl.suggestedFilename(), /^Synthia-agenda-.*\.ics$/);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/END:VEVENT/g) || []).length);
  assert.ok((ics.match(/BEGIN:VEVENT/g) || []).length >= 13);
  assert.match(ics, /DTSTART:20261123T180000/); // semaine 1, lundi, 18 h (sortie le 4 décembre 2026)
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lignes pliées à 75 octets');
  step('agenda .ics valide');
  assert.match(await page.getByRole('link', { name: /WhatsApp/ }).first().getAttribute('href'), /^https:\/\/wa\.me\/\?text=/);
  await page.getByRole('button', { name: 'Modifier le texte' }).first().click();
  await page.getByLabel('Texte à publier').fill('Mon texte à moi 🎶');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await text('Texte modifié').waitFor();
  await text('Mon texte à moi').waitFor();
  await page.getByRole('button', { name: 'Régénérer' }).click();
  await text('Tu as modifié des textes').waitFor(); // confirmation avant d'écraser un texte retouché
  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.getByRole('button', { name: 'Rétablir l’original' }).click();
  assert.equal(await page.getByText('Texte modifié').count(), 0);
  step('WhatsApp, texte modifiable, confirmation avant régénération');

  // 6c. thème : bascule, mémorisé après rechargement, appliqué sans flash
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
  await page.getByRole('button', { name: /^Thème : automatique/ }).first().click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light');
  await page.getByRole('button', { name: /^Thème : clair/ }).first().click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bgDark, 'rgb(11, 8, 22)'); // violet d'origine, sombre
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  await page.getByRole('button', { name: /^Thème : sombre/ }).first().click(); // retour en automatique
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('pwa-theme')), null);
  step('thème clair / sombre / automatique, mémorisé');

  // 6c2. palettes : violet par défaut, teal au choix, thème tiré d'une image ou d'une vidéo
  const lumOf = (c) => { const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratioOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-pal')), 'violet');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pri').trim()), '#7C3AED');
  await page.getByRole('button', { name: 'Paramètres' }).first().click();
  await page.getByRole('radio', { name: 'Teal' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-pal')), 'teal');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-pal')), 'teal'); // mémorisée
  await page.getByRole('button', { name: 'Paramètres' }).first().click();
  await page.getByRole('radio', { name: 'Violet' }).click();
  assert.equal(await page.getByRole('radio', { name: /Personnalisée/ }).count(), 0); // pas de thème perso tant qu'il n'y a pas de fichier
  // fichier qui n'est ni image ni vidéo : refusé, rien ne change
  await page.setInputFiles('#theme-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') });
  await text('Choisis une image ou une vidéo').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('pwa-custom')), null);
  // images pièges : le thème obtenu doit rester lisible dans les deux modes
  const IMGS = { jaune: [['#FFE600']], blanc: [['#FAFAFA']], noir: [['#050505']], gris: [['#808080']], rouge: [['#FF0000']], bicolore: [['#1E40FF', 0.7], ['#FF8A00', 0.3]], neon: [['#39FF14']] };
  for (const [name, cols] of Object.entries(IMGS)) {
    const png = await page.evaluate(async (cs) => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); let y = 0; for (const [col, w = 1] of cs) { x.fillStyle = col; const h = Math.round(64 * w); x.fillRect(0, y, 64, h); y += h; } x.fillStyle = cs[cs.length - 1][0]; x.fillRect(0, y, 64, 64); const b = await new Promise((r) => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await b.arrayBuffer())); }, cols);
    await page.setInputFiles('#theme-file', { name: name + '.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.getByRole('radio', { name: /Personnalisée/ }).waitFor();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-pal') === 'custom');
    const c = await page.evaluate(() => JSON.parse(localStorage.getItem('pwa-custom')));
    const bad = [];
    for (const mode of ['light', 'dark']) {
      const m = c[mode];
      for (const [f, g, min] of [['--tx', '--bg', 7], ['--tx', '--card', 7], ['--mut', '--bg', 4.5], ['--mut', '--card', 4.5], ['--pt', '--bg', 4.5], ['--pt', '--card', 4.5], ['--ac', '--bg', 4.5], ['--ac', '--card', 4.5], ['--ok', '--card', 4.5], ['--err', '--card', 4.5], ['#FFFFFF', '--pri', 4.5], ['#FFFFFF', '--pri2', 4.5], ['#FFFFFF', '--hero-b', 4.5], ['#D8FF3E', '--hero-b', 4.5], ['--hs1', '--hero-b', 4.5], ['#FFFFFF', '--toast', 4.5]]) {
        const r = ratioOf(f[0] === '#' ? f : m[f], g[0] === '#' ? g : m[g]);
        if (r < min) bad.push(`${mode} ${f}/${g} = ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(bad, [], `contrastes insuffisants pour l'image « ${name} »`);
  }
  // le thème obtenu est bien appliqué (variables en ligne), y compris l'image du bandeau, et suit le mode
  const applied = await page.evaluate(() => ({ pri: document.documentElement.style.getPropertyValue('--pri'), img: document.documentElement.style.getPropertyValue('--hero-img').slice(0, 30), c: JSON.parse(localStorage.getItem('pwa-custom')) }));
  assert.ok(applied.img.startsWith('url("data:image/jpeg;base64,'), 'miniature appliquée au bandeau');
  assert.equal(applied.pri, applied.c.light.pri || applied.c.light['--pri']);
  await page.getByRole('button', { name: /^Thème : automatique/ }).first().click(); // clair
  await page.getByRole('button', { name: /^Thème : clair/ }).first().click(); // sombre
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg')), applied.c.dark['--bg']);
  await page.getByRole('button', { name: /^Thème : sombre/ }).first().click(); // automatique
  // vidéo : une courte vidéo enregistrée dans le navigateur (WebM) donne un thème
  const webm = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); const st = c.captureStream(10), rec = new MediaRecorder(st, { mimeType: 'video/webm' }), parts = []; rec.ondataavailable = (e) => parts.push(e.data); const done = new Promise((r) => (rec.onstop = r)); rec.start(); for (let i = 0; i < 12; i++) { x.fillStyle = '#E11D48'; x.fillRect(0, 0, 64, 64); await new Promise((r) => setTimeout(r, 100)); } rec.stop(); await done; return Array.from(new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer())); });
  await page.setInputFiles('#theme-file', { name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(webm) });
  await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('pwa-custom')).sw[0] !== undefined && document.body.innerText.includes('Thème créé') } catch (e) { return false } }, null, { timeout: 15000 });
  step('palettes : violet par défaut, teal, thème image et vidéo lisible dans les deux modes');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-pal')), 'custom'); // thème perso rechargé avant l'affichage
  await page.getByRole('button', { name: 'Paramètres' }).first().click();
  await page.getByRole('button', { name: 'Retirer mon thème' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-pal')), 'violet');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--pri')), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('pwa-custom')), null);
  step('thème personnalisé retiré, retour au violet');

  // 6d. hors ligne : bandeau, puis retour
  await ctx.setOffline(true);
  await text('Hors ligne').waitFor();
  await ctx.setOffline(false);
  await page.waitForFunction(() => !document.body.innerText.includes('Hors ligne :'));
  step('bandeau hors ligne');

  // 7. conseils IA dans le suivi
  await page.getByRole('button', { name: 'Suivi' }).first().click();
  await page.getByRole('button', { name: /Générer le plan de la semaine suivante/ }).click();
  await page.getByText('✨ Poste ton teaser à 19 h').waitFor({ timeout: 10000 });
  step('conseils IA ajoutés à l’analyse');

  // 8. connexion TikTok réelle (OAuth contre faux TikTok)
  await page.getByRole('button', { name: 'Tableau de bord' }).first().click();
  await text('Pour bien démarrer').waitFor(); // démarrage guidé tant que toutes les étapes ne sont pas faites
  await page.getByRole('button', { name: 'Connecter TikTok' }).click();
  await page.waitForURL((u) => u.pathname === '/' && u.hostname === '127.0.0.1' && u.port === String(server.address().port));
  await text('Zeynab TT').waitFor();
  assert.match(await page.locator('body').innerText(), /TikTok · connecté/);
  assert.match(await page.locator('body').innerText(), /Instagram · bientôt disponible/);
  assert.doesNotMatch(await page.locator('body').innerText(), /démo|démonstration|fictif|simulé/i);
  const accts = (await page.evaluate(() => fetch('/api/social').then((r) => r.json()))).accounts;
  assert.equal(accts.tiktok.hist[0].v, 1500);
  step('TikTok connecté via OAuth, statistiques affichées');

  // 8b. page Aide et sécurité du compte
  await page.getByRole('button', { name: 'Aide' }).first().click();
  await text('Comment Synthia construit mon plan').waitFor();
  assert.equal(await page.getByRole('link', { name: /@/ }).count(), 0); // pas de SUPPORT_EMAIL : pas de lien de contact
  await page.getByRole('button', { name: 'Paramètres' }).first().click();
  await page.getByRole('button', { name: 'Changer mon mot de passe' }).click();
  await page.getByLabel('Mot de passe actuel', { exact: true }).fill('faux-mot-de-passe');
  await page.getByLabel(/Nouveau mot de passe/).fill('motdepasse2');
  await page.getByRole('button', { name: 'Changer', exact: true }).click();
  await text('mot de passe actuel est incorrect').waitFor();
  await page.getByLabel('Mot de passe actuel', { exact: true }).fill('motdepasse1');
  await page.getByRole('button', { name: 'Changer', exact: true }).click();
  await text('Mot de passe changé').waitFor();
  step('aide, changement de mot de passe');

  // 9. déconnexion : le navigateur est nettoyé
  await page.getByRole('button', { name: 'Paramètres' }).first().click();
  await page.getByRole('button', { name: 'Me déconnecter', exact: true }).click();
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
