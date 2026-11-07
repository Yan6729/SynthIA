'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { start } = require('./helpers');
const { createStripeClient } = require('../server/pay/stripe');
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
  assert.match(page.text, /\$9\.00/);
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

test('Stripe : création de session en dollars, relecture, webhook signé (valide, périmé, falsifié, rejoué)', async () => {
  const SECRET = 'whsec_test_secret';
  const seen = [];
  let sess = { id: 'cs_test_42', payment_status: 'unpaid', status: 'open', amount_total: 900, currency: 'usd' };
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      seen.push({ m: req.method, u: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], ct: req.headers['content-type'], form: b ? Object.fromEntries(new URLSearchParams(b)) : null });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_test_42', url: 'https://checkout.stripe.com/c/pay/cs_test_42' }));
      if (req.method === 'GET' && req.url === '/v1/checkout/sessions/cs_test_42') return res.end(JSON.stringify(sess));
      res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'No such session' } }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const apiBase = `http://127.0.0.1:${fake.address().port}`;

  const cfg = loadConfig({ PAY_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET });
  const pay = createStripeClient(cfg, { apiBase });
  const s = await start({}, { pay });
  const c = await user(s);

  const r = await c.post('/api/pay/checkout', { offer: 'PREMIUM' });
  assert.equal(r.status, 200);
  assert.equal(r.json.url, 'https://checkout.stripe.com/c/pay/cs_test_42');
  const create = seen.find((x) => x.m === 'POST');
  assert.equal(create.auth, 'Bearer sk_test_x');
  assert.equal(create.ct, 'application/x-www-form-urlencoded');
  assert.equal(create.idem, `synthia-checkout-${r.json.paymentId}`);
  assert.equal(create.form.mode, 'payment');
  assert.equal(create.form['line_items[0][price_data][currency]'], 'usd');
  assert.equal(create.form['line_items[0][price_data][unit_amount]'], '900'); // 9,00 $ en cents
  assert.equal(create.form.customer_email, 'a@b.co');
  assert.match(create.form.success_url, /\/api\/pay\/return\?p=\d+$/);
  assert.match(create.form.cancel_url, /\/\?paid=failed$/);
  const row = s.db.prepare('SELECT amount, currency, provider, provider_tx FROM payments').get();
  assert.deepEqual({ ...row }, { amount: 900, currency: 'USD', provider: 'stripe', provider_tx: 'cs_test_42' });

  const sign = (payload, { t = Math.floor(Date.now() / 1000), secret = SECRET } = {}) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_42' } } });
  const hook = (hdr, body = payload) => fetch(s.base + '/api/pay/webhook', { method: 'POST', headers: { 'stripe-signature': hdr, 'content-type': 'application/json' }, body });
  assert.equal((await hook('t=1,v1=deadbeef')).status, 400);                              // signature mal formée
  assert.equal((await hook(sign(payload, { secret: 'whsec_autre' }))).status, 400);       // mauvaise clé
  assert.equal((await hook(sign(payload).replace(/.$/, (ch) => (ch === '0' ? '1' : '0')))).status, 400); // un caractère changé
  assert.equal((await hook(sign(payload), payload.replace('cs_test_42', 'cs_test_43'))).status, 400);     // corps falsifié
  assert.equal((await hook(sign(payload, { t: Math.floor(Date.now() / 1000) - 3600 }))).status, 400);     // horodatage périmé
  assert.equal((await hook(sign(payload))).status, 200);
  assert.equal(premium(s), 0); // webhook valide mais la relecture dit « unpaid » : rien n'est activé
  sess = { ...sess, payment_status: 'paid', status: 'complete' };
  assert.equal((await hook(sign(payload))).status, 200);
  const p1 = premium(s);
  assert.ok(p1 > Date.now() + 29 * 86400000);
  assert.equal((await hook(sign(payload))).status, 200); // rejoué
  assert.equal(premium(s), p1);
  const other = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_inconnue' } } });
  assert.equal((await hook(sign(other), other)).status, 200); // session qui n'est pas la nôtre : ignorée
  const noise = JSON.stringify({ type: 'charge.succeeded', data: { object: { id: 'cs_test_42' } } });
  assert.equal((await hook(sign(noise), noise)).status, 200); // autre type d'événement : ignoré
  assert.equal(premium(s), p1);
  await s.close(); fake.close();
});

test('Stripe : mauvaise devise ou montant chez Stripe → refusé ; session expirée → refusée ; erreur API → 502', async () => {
  for (const sess of [{ payment_status: 'paid', amount_total: 900, currency: 'eur' }, { payment_status: 'paid', amount_total: 100, currency: 'usd' }, { payment_status: 'unpaid', status: 'expired', amount_total: 900, currency: 'usd' }]) {
    const fake = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.method === 'POST' ? { id: 'cs_1', url: 'https://x/y' } : { id: 'cs_1', ...sess })); });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    const pay = createStripeClient(loadConfig({ PAY_MODE: 'stripe', STRIPE_SECRET_KEY: 'k' }), { apiBase: `http://127.0.0.1:${fake.address().port}` });
    const s = await start({}, { pay });
    const c = await user(s);
    const r = await c.post('/api/pay/checkout', { offer: 'PREMIUM' });
    assert.equal((await c.get('/api/pay/return?p=' + r.json.paymentId)).headers.get('location'), '/?paid=failed');
    assert.equal(premium(s), 0);
    await s.close(); fake.close();
  }
  const down = http.createServer((req, res) => { res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { message: 'Invalid API Key' } })); });
  await new Promise((r) => down.listen(0, '127.0.0.1', r));
  const s = await start({}, { pay: createStripeClient(loadConfig({ PAY_MODE: 'stripe', STRIPE_SECRET_KEY: 'k' }), { apiBase: `http://127.0.0.1:${down.address().port}` }) });
  const c = await user(s);
  const r = await c.post('/api/pay/checkout', { offer: 'PREMIUM' });
  assert.equal(r.status, 502);
  assert.equal(s.db.prepare('SELECT status FROM payments').get().status, 'failed');
  await s.close(); down.close();
});

test('configuration : prix en dollars lu en cents, plancher Stripe, clés exigées en production', () => {
  const { validateConfig } = require('../server/config');
  assert.equal(loadConfig({}).pay.price, 900);
  assert.equal(loadConfig({ PREMIUM_PRICE_USD: '12.5' }).pay.price, 1250);
  assert.equal(loadConfig({ PREMIUM_PRICE_USD: '0.10' }).pay.price, 900); // sous 0,50 $ : valeur par défaut
  assert.equal(loadConfig({ PREMIUM_PRICE_USD: 'abc' }).pay.price, 900);
  const prod = { NODE_ENV: 'production', APP_URL: 'https://m.example', TOKEN_KEY: Buffer.alloc(32).toString('base64'), MAIL_MODE: 'resend', RESEND_API_KEY: 'r', MAIL_FROM: 'a@b.co' };
  assert.ok(validateConfig(loadConfig({ ...prod, PAY_MODE: 'stripe' })).some((e) => /STRIPE_SECRET_KEY/.test(e)));
  assert.ok(validateConfig(loadConfig({ ...prod, PAY_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x' })).some((e) => /STRIPE_WEBHOOK_SECRET/.test(e)));
  assert.ok(validateConfig(loadConfig({ ...prod, PAY_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'w' })).some((e) => /clé de test/.test(e)));
  assert.deepEqual(validateConfig(loadConfig({ ...prod, PAY_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'w' })), []);
  assert.ok(validateConfig(loadConfig({ PAY_MODE: 'fedapay' })).some((e) => /PAY_MODE inconnu/.test(e)));
});

test('montant différent chez le fournisseur → refusé', async () => {
  const pay = {
    mode: 'stripe',
    createCheckout: async () => ({ txId: 'T1', url: 'https://x/y' }),
    getTransaction: async () => ({ status: 'approved', amount: 100, currency: 'USD' }),
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
