'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

async function logged(s, email = 'a@b.co') {
  const c = s.client();
  await c.post('/api/auth/register', { email, password: 'motdepasse1' });
  return c;
}

test('état : lecture/écriture par utilisateur, isolé', async () => {
  const s = await start();
  const a = await logged(s, 'a@b.co'), b = await logged(s, 'b@b.co');
  assert.equal((await s.client().get('/api/state')).status, 401);
  assert.equal((await a.put('/api/state/prof', { value: { artist: 'Zeynab' } })).status, 200);
  assert.deepEqual((await a.get('/api/state')).json.state, { prof: { artist: 'Zeynab' } });
  assert.deepEqual((await b.get('/api/state')).json.state, {});
  await s.close();
});

test('état : clé interdite (offer), trop gros, valeur manquante', async () => {
  const s = await start();
  const a = await logged(s);
  assert.equal((await a.put('/api/state/offer', { value: 'PREMIUM' })).status, 400);
  assert.equal((await a.put('/api/state/prof', {})).status, 400);
  const big = 'x'.repeat(300 * 1024);
  assert.equal((await a.put('/api/state/prof', { value: big })).status, 413);
  await s.close();
});

test('import des données d\'invité : une seule fois, sans écraser', async () => {
  const s = await start();
  const a = await logged(s);
  await a.put('/api/state/prof', { value: { artist: 'Serveur' } });
  const r = await a.post('/api/state/import', { state: { prof: { artist: 'Invité' }, plan: [1], offer: 'PREMIUM', hack: 1 } });
  assert.equal(r.json.imported, 1); // seulement plan
  const st = (await a.get('/api/state')).json.state;
  assert.equal(st.prof.artist, 'Serveur');
  assert.deepEqual(st.plan, [1]);
  assert.ok(!('offer' in st) && !('hack' in st));
  await s.close();
});

test('avatar : null, préréglé ou petit JPEG seulement ; tout le reste est refusé', async () => {
  const s = await start();
  const c = s.client();
  await c.post('/api/auth/register', { email: 'a@b.co', password: 'motdepasse1' });
  const put = (value) => c.put('/api/state/avatar', { value });
  const jpeg = 'data:image/jpeg;base64,' + Buffer.alloc(3000, 7).toString('base64');
  assert.equal((await put(null)).status, 200);
  assert.equal((await put({ t: 'p', id: 'vinyl' })).status, 200);
  assert.equal((await put({ t: 'u', d: jpeg })).status, 200);
  assert.deepEqual((await c.get('/api/state')).json.state.avatar, { t: 'u', d: jpeg });
  for (const bad of [
    'x', 42, [], {}, { t: 'p' }, { t: 'p', id: 'Vinyl' }, { t: 'p', id: '../x' }, { t: 'p', id: 'vinyl', extra: 1 },
    { t: 'u', d: 'javascript:alert(1)' }, { t: 'u', d: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
    { t: 'u', d: 'data:image/png;base64,AAAA' }, { t: 'u', d: 'data:image/jpeg;base64,AA"onerror="x' },
    { t: 'u', d: 'data:image/jpeg;base64,' + 'A'.repeat(100001) }, { t: 'u', d: jpeg, x: 1 },
  ]) assert.equal((await put(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  assert.deepEqual((await c.get('/api/state')).json.state.avatar, { t: 'u', d: jpeg }); // les refus n'ont rien changé
  // import d'invité : un avatar invalide est ignoré, les autres clés passent
  const c2 = s.client();
  await c2.post('/api/auth/register', { email: 'z@b.co', password: 'motdepasse1' });
  const r = await c2.post('/api/state/import', { state: { avatar: { t: 'u', d: 'data:text/html;base64,AAAA' }, seen: { a: 1 } } });
  assert.equal(r.json.imported, 1);
  assert.equal((await c2.get('/api/state')).json.state.avatar, undefined);
  await s.close();
});
