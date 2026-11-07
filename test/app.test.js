'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

test('healthz, en-têtes de sécurité, front servi', async () => {
  const s = await start();
  const c = s.client();
  const h = await c.get('/healthz');
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.match(h.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(h.headers.get('content-security-policy'), /media-src 'self' blob:/);
  const idx = await c.get('/');
  assert.equal(idx.status, 200);
  assert.match(idx.text, /Synthia/);
  await s.close();
});

test('CSRF : POST sans JSON ou avec une autre origine refusé', async () => {
  const s = await start();
  const c = s.client();
  let r = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(r.status, 415);
  r = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
  await s.close();
});

test('JSON invalide → 400, route inconnue → 404', async () => {
  const s = await start();
  let r = await fetch(s.base + '/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oups' });
  assert.equal(r.status, 400);
  r = await fetch(s.base + '/api/inconnue');
  assert.equal(r.status, 404);
  await s.close();
});

test('CSRF : Origin identique à APP_URL accepté', async () => {
  const s = await start();
  const r = await fetch(s.base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', origin: s.base }, body: JSON.stringify({ email: 'o@b.co', password: 'motdepasse1' }) });
  assert.equal(r.status, 201);
  await s.close();
});

test('healthz teste la base ; les journaux ne contiennent ni query ni données', async () => {
  const lines = [];
  const orig = console.log; console.log = (l) => lines.push(String(l));
  const s = await start({ LOG_REQUESTS: '1' });
  const c = s.client();
  await c.get('/api/me?secret=abc');
  console.log = orig;
  assert.ok(lines.some((l) => JSON.parse(l).p === '/api/me'));
  assert.ok(!lines.join('').includes('secret'));
  s.db.close();
  assert.equal((await c.get('/healthz')).status, 503);
  await new Promise((r) => s.close().then(r).catch(r));
});

test('/api/me : adresse de contact seulement si elle est valide', async () => {
  const a = await start({ SUPPORT_EMAIL: 'aide@synthia.app' });
  assert.equal((await a.client().get('/api/me')).json.features.support, 'aide@synthia.app');
  await a.close();
  const b = await start({ SUPPORT_EMAIL: 'pas une adresse<script>' });
  assert.equal((await b.client().get('/api/me')).json.features.support, null);
  await b.close();
  const c = await start({});
  assert.equal((await c.client().get('/api/me')).json.features.support, null);
  await c.close();
});
