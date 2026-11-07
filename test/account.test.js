'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

function fakeMailer() { const sent = []; return { sent, mode: 'fake', send: async (m) => { sent.push(m); } }; }
const tokenOf = (m, kind) => m.text.match(new RegExp(`\\?${kind}=([\\w-]+)`))[1];
async function setup(env = {}) {
  const mailer = fakeMailer();
  const s = await start(env, { mailer });
  const c = s.client();
  await c.post('/api/auth/register', { email: 'a@b.co', password: 'motdepasse1' });
  await new Promise((r) => setTimeout(r, 20));
  return { s, c, mailer };
}

test('inscription : e-mail de vérification, lien à usage unique', async () => {
  const { s, c, mailer } = await setup();
  assert.equal(mailer.sent.length, 1);
  assert.equal((await c.get('/api/me')).json.user.emailVerified, false);
  const tok = tokenOf(mailer.sent[0], 'verify');
  assert.equal((await s.client().post('/api/auth/verify', { token: tok })).status, 200);
  assert.equal((await c.get('/api/me')).json.user.emailVerified, true);
  assert.equal((await s.client().post('/api/auth/verify', { token: tok })).status, 400); // déjà utilisé
  assert.equal((await c.post('/api/auth/verify/send')).json.already, true);
  await s.close();
});

test('mot de passe oublié : même réponse, lien 1 h, change le mot de passe et coupe les sessions', async () => {
  const { s, c, mailer } = await setup();
  const known = await s.client().post('/api/auth/forgot', { email: 'a@b.co' });
  const unknown = await s.client().post('/api/auth/forgot', { email: 'inconnu@b.co' });
  assert.deepEqual(known.json, unknown.json);
  assert.equal(mailer.sent.length, 2); // vérification + reset, rien pour l'inconnu
  const tok = tokenOf(mailer.sent[1], 'reset');
  assert.equal((await s.client().post('/api/auth/reset', { token: tok, password: 'court' })).status, 400);
  assert.equal((await s.client().post('/api/auth/reset', { token: tok, password: 'nouveaumdp9' })).status, 200);
  assert.equal((await c.get('/api/me')).json.user, null); // ancienne session coupée
  assert.equal((await s.client().post('/api/auth/login', { email: 'a@b.co', password: 'motdepasse1' })).status, 401);
  assert.equal((await s.client().post('/api/auth/login', { email: 'a@b.co', password: 'nouveaumdp9' })).status, 200);
  assert.equal((await s.client().post('/api/auth/reset', { token: tok, password: 'autremdp123' })).status, 400); // rejoué
  await s.close();
});

test('lien expiré refusé ; un nouveau lien annule le précédent', async () => {
  const { s, mailer } = await setup();
  await s.client().post('/api/auth/forgot', { email: 'a@b.co' });
  const t1 = tokenOf(mailer.sent[1], 'reset');
  await s.client().post('/api/auth/forgot', { email: 'a@b.co' });
  assert.equal((await s.client().post('/api/auth/reset', { token: t1, password: 'nouveaumdp9' })).status, 400);
  s.db.prepare('UPDATE email_tokens SET expires_at = 1').run();
  const t2 = tokenOf(mailer.sent[2], 'reset');
  assert.equal((await s.client().post('/api/auth/reset', { token: t2, password: 'nouveaumdp9' })).status, 400);
  await s.close();
});

test('export : mes données sans jetons ni hachage', async () => {
  const { s, c } = await setup();
  await c.put('/api/state/prof', { value: { artist: 'Zeynab' } });
  const r = await c.get('/api/me/export');
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.equal(r.json.account.email, 'a@b.co');
  assert.equal(r.json.state.prof.artist, 'Zeynab');
  assert.ok(!JSON.stringify(r.json).includes('scrypt'));
  assert.equal((await s.client().get('/api/me/export')).status, 401);
  await s.close();
});

test('suppression : mot de passe exigé, tout part sauf les paiements (détachés)', async () => {
  const { s, c } = await setup();
  await c.put('/api/state/prof', { value: { artist: 'Z' } });
  const uid = s.db.prepare('SELECT id FROM users').get().id;
  s.db.prepare("INSERT INTO payments (user_id, offer, amount, provider, provider_tx, status, created_at) VALUES (?, 'PREMIUM', 5000, 'fedapay', 'T9', 'approved', 1)").run(uid);
  s.db.prepare("INSERT INTO social_accounts (user_id, platform, access_enc) VALUES (?, 'tiktok', 'x')").run(uid);
  assert.equal((await c.post('/api/me/delete', { password: 'mauvais-mdp' })).status, 403);
  assert.equal((await c.post('/api/me/delete', { password: 'motdepasse1' })).status, 200);
  const n = (t) => s.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  assert.deepEqual([n('users'), n('sessions'), n('user_state'), n('social_accounts'), n('email_tokens')], [0, 0, 0, 0, 0]);
  const pay = s.db.prepare('SELECT user_id, amount, currency FROM payments').get();
  assert.deepEqual(pay, { user_id: null, amount: 5000, currency: 'XOF' }); // l’historique en FCFA reste tel quel
  assert.equal((await c.get('/api/me')).json.user, null);
  await s.close();
});

test('production : MAIL_MODE=console refusé', () => {
  const { loadConfig, validateConfig } = require('../server/config');
  const errs = validateConfig(loadConfig({ NODE_ENV: 'production', APP_URL: 'https://m.example', PAY_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_live_k', STRIPE_WEBHOOK_SECRET: 'w', TOKEN_KEY: Buffer.alloc(32).toString('base64') }));
  assert.ok(errs.some((e) => /MAIL_MODE/.test(e)));
});

test('changer le mot de passe : ancien exigé, autres appareils coupés, celui-ci reste connecté', async () => {
  const { s, c } = await setup();
  const other = s.client();
  await other.post('/api/auth/login', { email: 'a@b.co', password: 'motdepasse1' });
  assert.equal((await other.get('/api/me')).json.user.email, 'a@b.co');
  assert.equal((await c.post('/api/me/password', { current: 'faux', next: 'nouveaumdp9' })).status, 403);
  assert.equal((await c.post('/api/me/password', { current: 'motdepasse1', next: 'court' })).status, 400);
  assert.equal((await c.post('/api/me/password', { current: 'motdepasse1', next: 'motdepasse1' })).status, 400);
  assert.equal((await s.client().post('/api/me/password', { current: 'motdepasse1', next: 'nouveaumdp9' })).status, 401); // non connecté
  assert.equal((await c.post('/api/me/password', { current: 'motdepasse1', next: 'nouveaumdp9' })).status, 200);
  assert.equal((await c.get('/api/me')).json.user.email, 'a@b.co'); // cet appareil reste connecté
  assert.equal((await other.get('/api/me')).json.user, null); // l'autre est coupé
  assert.equal((await s.client().post('/api/auth/login', { email: 'a@b.co', password: 'motdepasse1' })).status, 401);
  assert.equal((await s.client().post('/api/auth/login', { email: 'a@b.co', password: 'nouveaumdp9' })).status, 200);
  assert.equal((await c.get('/api/me')).json.user.emailVerified, false); // ne confirme pas l'e-mail à la place de l'utilisateur
  await s.close();
});

test('déconnexion de tous les appareils', async () => {
  const { s, c } = await setup();
  const other = s.client();
  await other.post('/api/auth/login', { email: 'a@b.co', password: 'motdepasse1' });
  assert.equal((await s.client().post('/api/auth/logout-all')).status, 401);
  assert.equal((await c.post('/api/auth/logout-all')).status, 200);
  assert.equal((await c.get('/api/me')).json.user, null);
  assert.equal((await other.get('/api/me')).json.user, null);
  await s.close();
});
