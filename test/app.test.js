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
  const idx = await c.get('/');
  assert.equal(idx.status, 200);
  assert.match(idx.text, /Manager/);
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
