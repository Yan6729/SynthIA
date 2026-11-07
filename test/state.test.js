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
