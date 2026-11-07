'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

test('inscription, session, /api/me, déconnexion', async () => {
  const s = await start();
  const c = s.client();
  assert.equal((await c.get('/api/me')).json.user, null);
  const r = await c.post('/api/auth/register', { email: 'Zeynab@Test.com ', password: 'motdepasse1' });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.email, 'zeynab@test.com');
  assert.equal(r.json.user.offer, 'FREE');
  const me = await c.get('/api/me');
  assert.equal(me.json.user.email, 'zeynab@test.com');
  const row = s.db.prepare('SELECT pass_hash FROM users').get();
  assert.match(row.pass_hash, /^scrypt\$/);
  assert.ok(!row.pass_hash.includes('motdepasse1'));
  const tokenInDb = s.db.prepare('SELECT token_hash FROM sessions').get().token_hash;
  assert.ok(!c.cookie.includes(tokenInDb)); // seul le hachage est en base
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).json.user, null);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  await s.close();
});

test('validation : e-mail, mot de passe court, doublon', async () => {
  const s = await start();
  const c = s.client();
  assert.equal((await c.post('/api/auth/register', { email: 'pas-un-mail', password: 'motdepasse1' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'a@b.co', password: 'court' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'a@b.co', password: 'motdepasse1' })).status, 201);
  assert.equal((await s.client().post('/api/auth/register', { email: 'A@B.co', password: 'motdepasse2' })).status, 409);
  await s.close();
});

test('connexion : mauvais mot de passe et e-mail inconnu donnent la même réponse', async () => {
  const s = await start();
  await s.client().post('/api/auth/register', { email: 'a@b.co', password: 'motdepasse1' });
  const bad = await s.client().post('/api/auth/login', { email: 'a@b.co', password: 'faux-faux-faux' });
  const unknown = await s.client().post('/api/auth/login', { email: 'x@b.co', password: 'faux-faux-faux' });
  assert.equal(bad.status, 401);
  assert.deepEqual(bad.json, unknown.json);
  const ok = await s.client().post('/api/auth/login', { email: 'a@b.co', password: 'motdepasse1' });
  assert.equal(ok.status, 200);
  await s.close();
});

test('limitation de débit sur la connexion', async () => {
  const s = await start();
  const c = s.client();
  let last;
  for (let i = 0; i < 12; i++) last = await c.post('/api/auth/login', { email: 'a@b.co', password: 'x' + i });
  assert.equal(last.status, 429);
  await s.close();
});

test('session expirée refusée', async () => {
  const s = await start();
  const c = s.client();
  await c.post('/api/auth/register', { email: 'a@b.co', password: 'motdepasse1' });
  s.db.prepare('UPDATE sessions SET expires_at = 1').run();
  assert.equal((await c.get('/api/me')).json.user, null);
  await s.close();
});
