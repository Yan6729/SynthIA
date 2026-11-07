'use strict';
/* Client Stripe Checkout en REST (aucun SDK). Interface commune avec la simulation :
   createCheckout → {txId, url} · getTransaction → {status, amount, currency} · parseWebhook → {name, txId}.
   Les montants sont en cents. */
const crypto = require('crypto');

const TOLERANCE_S = 300;

function createStripeClient(cfg, { apiBase } = {}) {
  const base = (apiBase || 'https://api.stripe.com').replace(/\/$/, '');
  const { key, webhookSecret } = cfg.pay.stripe;

  async function call(method, path, form, extra = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...extra },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Stripe ${res.status} : ${body?.error?.message || 'erreur'}`);
    return body;
  }

  return {
    mode: 'stripe',
    async createCheckout({ amount, currency, description, callbackUrl, cancelUrl, email, ref }) {
      const s = await call('POST', '/v1/checkout/sessions', {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': String(currency).toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(amount),
        'line_items[0][price_data][product_data][name]': description,
        success_url: callbackUrl,
        cancel_url: cancelUrl || callbackUrl,
        customer_email: email,
        client_reference_id: String(ref),
        'metadata[payment_id]': String(ref),
      }, { 'idempotency-key': `synthia-checkout-${ref}` });
      if (!s.id || !s.url) throw new Error('Stripe : pas d’URL de paiement');
      return { txId: String(s.id), url: s.url };
    },
    /* La vérité vient d'ici, jamais des paramètres du retour ni du seul webhook. */
    async getTransaction(txId) {
      const s = await call('GET', `/v1/checkout/sessions/${encodeURIComponent(txId)}`);
      let status = 'pending';
      if (s.payment_status === 'paid') status = 'approved';
      else if (s.status === 'expired') status = 'declined';
      return { status, amount: Number(s.amount_total), currency: String(s.currency || '').toUpperCase() };
    },
    parseWebhook(rawBody, header) {
      if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET manquant');
      const parts = String(header || '').split(',').map((p) => p.trim().split('='));
      const t = Number((parts.find(([k]) => k === 't') || [])[1]);
      const sigs = parts.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/i.test(v || '')).map(([, v]) => Buffer.from(v, 'hex'));
      if (!Number.isFinite(t) || !sigs.length) throw new Error('signature absente');
      if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) throw new Error('horodatage hors tolérance');
      const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
      const expected = crypto.createHmac('sha256', webhookSecret).update(`${t}.`).update(raw).digest();
      if (!sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(s, expected))) throw new Error('signature invalide');
      const ev = JSON.parse(raw.toString('utf8'));
      const type = String(ev.type || '');
      const obj = ev.data && ev.data.object;
      const txId = type.startsWith('checkout.session.') && obj && obj.id ? String(obj.id) : null;
      return { name: type, txId };
    },
  };
}

module.exports = { createStripeClient, TOLERANCE_S };
