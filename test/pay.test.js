'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Webhook } = require('fedapay');
const { start } = require('./helpers');
const { createFedaPayClient } = require('../server/pay/fedapay');
const { loadConfig } = require('../server/config');

async function user(s) {
  const c = s.client();
  await c.post('/api/auth/register', { email: 'a@b.co', password: 'motdepasse1' });
  return c;
}
const premium = (s) => s.db.prepare('SELECT premium_until p FROM users').get().p;

/* Parcours simulé de bout en bout : checkout → page de paiement → décision → retour vérifié */
async function pay(s, c, status) {
  const r = await c.post('/api/pay/checkout', { offer: 'PREMIUM' });
  assert.equal(r.status, 200);
  const txId = r.json.url.split('/').pop();
  const page = await c.get(new URL(r.json.url).pathname);
  assert.match(page.text, /5000 FCFA/);
  const d = await fetch(`${s.base}/api/pay/simulate/${txId}/decide`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `status=${status}` });
  assert.equal(d.status, 302);
  const back = new URL(d.headers.get('location'));
  return c.get(back.pathname + back.search);
}

test('paiement simulé approuvé → PREMIUM 30 jours, relecture idempotente', async () => {
  const s = await start();
  const c = await user(s);
  const ret = await pay(s, c, 'approved');
  assert.equal(ret.status, 302);
  assert.equal(ret.headers.get('location'), '/?paid=ok');
  const first = premium(s);
  assert.ok(first > Date.now() + 29 * 86400000);
  assert.equal((await c.get('/api/me')).json.user.offer, 'PREMIUM');
  // rejouer le retour ne prolonge pas une deuxième fois
  const pid = s.db.prepare('SELECT id FROM payments').get().id;
  await c.get('/api/pay/return?p=' + pid);
  assert.equal(premium(s), first);
  await s.close();
});

test('paiement refusé → reste FREE', async () => {
  const s = await start();
  const c = await user(s);
  const ret = await pay(s, c, 'declined');
  assert.equal(ret.headers.get('location'), '/?paid=failed');
  assert.equal((await c.get('/api/me')).json.user.offer, 'FREE');
  await s.close();
});

test('faux retour : jamais PREMIUM sans transaction approuvée chez le fournisseur', async () => {
  const s = await start();
  const c = await user(s);
  const r = await c.post('/api/pay/checkout', { offer: 'PREMIUM' });
  const pid = r.json.paymentId;
  const ret = await c.get(`/api/pay/return?p=${pid}&status=approved&id=sim_1001`); // paramètres truqués
  assert.equal(ret.headers.get('location'), '/?paid=pending');
  assert.equal((await c.get('/api/me')).json.user.offer, 'FREE');
  // le paiement d'un autre utilisateur n'est pas utilisable
  const other = s.client();
  await other.post('/api/auth/register', { email: 'z@b.co', password: 'motdepasse1' });
  assert.equal((await other.get('/api/pay/return?p=' + pid)).headers.get('location'), '/?paid=error');
  assert.equal((await s.client().get('/api/pay/return?p=' + pid)).headers.get('location'), '/?paid=login');
  await s.close();
});

test('checkout : offre inconnue refusée, connexion requise', async () => {
  const s = await start();
  assert.equal((await s.client().post('/api/pay/checkout', { offer: 'PREMIUM' })).status, 401);
  const c = await user(s);
  assert.equal((await c.post('/api/pay/checkout', { offer: 'GRATUIT' })).status, 400);
  await s.close();
});

test('FedaPay : SDK contre un faux serveur (création, token, relecture) + webhook signé', async () => {
  const SECRET = 'wh_sandbox_test_secret';
  const seen = [];
  let txStatus = 'pending';
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      seen.push({ m: req.method, u: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/transactions') return res.end(JSON.stringify({ 'v1/transaction': { klass: 'v1/transaction', id: 4242, status: 'pending', amount: 5000 } }));
      if (req.url === '/v1/transactions/4242/token') return res.end(JSON.stringify({ token: 'tok_abc', url: 'https://sandbox-process.fedapay.com/tok_abc' }));
      if (req.url === '/v1/transactions/4242') return res.end(JSON.stringify({ 'v1/transaction': { klass: 'v1/transaction', id: 4242, status: txStatus, amount: 5000 } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const apiBase = `http://127.0.0.1:${fake.address().port}`;

  const cfg = loadConfig({ PAY_MODE: 'fedapay', FEDAPAY_SECRET_KEY: 'sk_sandbox_x', FEDAPAY_WEBHOOK_SECRET: SECRET });
  const pay = createFedaPayClient(cfg, { apiBase });
  const s = await start({}, { pay });
  const c = await user(s);

  const r = await c.post('/api/pay/checkout', { offer: 'PREMIUM' });
  assert.equal(r.status, 200);
  assert.equal(r.json.url, 'https://sandbox-process.fedapay.com/tok_abc');
  const create = seen.find((x) => x.m === 'POST' && x.u === '/v1/transactions');
  assert.equal(create.auth, 'Bearer sk_sandbox_x');
  assert.equal(create.body.amount, 5000);
  assert.equal(create.body.currency.iso, 'XOF');
  assert.match(create.body.callback_url, /\/api\/pay\/return\?p=\d+$/);

  // webhook : signature invalide, puis valide mais transaction encore "pending", puis approved
  const payload = JSON.stringify({ name: 'transaction.approved', entity: { id: 4242, klass: 'v1/transaction' } });
  const hook = (hdr, body = payload) => fetch(s.base + '/api/pay/webhook', { method: 'POST', headers: { 'x-fedapay-signature': hdr, 'content-type': 'application/json' }, body });
  assert.equal((await hook('t=1,v1=deadbeef')).status, 400);
  const good = Webhook.generateTestHeaderString({ payload, secret: SECRET });
  assert.equal((await hook(good)).status, 200);
  assert.equal(premium(s), 0); // le webhook seul ne suffit pas : la relecture dit "pending"
  txStatus = 'approved';
  assert.equal((await hook(Webhook.generateTestHeaderString({ payload, secret: SECRET }))).status, 200);
  const p1 = premium(s);
  assert.ok(p1 > Date.now() + 29 * 86400000);
  assert.equal((await hook(Webhook.generateTestHeaderString({ payload, secret: SECRET }))).status, 200); // rejoué
  assert.equal(premium(s), p1);
  // horodatage trop ancien refusé (rejeu)
  const old = Webhook.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal((await hook(old)).status, 400);
  // transaction inconnue : ignorée
  const other = JSON.stringify({ name: 'transaction.approved', entity: { id: 999 } });
  assert.equal((await hook(Webhook.generateTestHeaderString({ payload: other, secret: SECRET }), other)).status, 200);
  assert.equal(premium(s), p1);
  await s.close(); fake.close();
});

test('montant différent chez le fournisseur → refusé', async () => {
  const pay = {
    mode: 'fedapay',
    createCheckout: async () => ({ txId: 'T1', url: 'https://x/y' }),
    getTransaction: async () => ({ status: 'approved', amount: 100 }),
    parseWebhook: () => ({}),
  };
  const s = await start({}, { pay });
  const c = await user(s);
  const r = await c.post('/api/pay/checkout', { offer: 'PREMIUM' });
  const ret = await c.get('/api/pay/return?p=' + r.json.paymentId);
  assert.equal(ret.headers.get('location'), '/?paid=failed');
  assert.equal(premium(s), 0);
  await s.close();
});

test('production : PAY_MODE=simulate refusé par la configuration', () => {
  const { validateConfig } = require('../server/config');
  const errs = validateConfig(loadConfig({ NODE_ENV: 'production', APP_URL: 'https://m.example', PAY_MODE: 'simulate', TOKEN_KEY: Buffer.alloc(32).toString('base64') }));
  assert.ok(errs.some((e) => /simulate/.test(e)));
});
