'use strict';
/* Client FedaPay (SDK officiel). Interface commune avec la simulation :
   createCheckout → {txId, url} · getTransaction → {status, amount} · parseWebhook → {name, txId}. */
const { FedaPay, Transaction, Webhook } = require('fedapay');

function createFedaPayClient(cfg, { apiBase } = {}) {
  FedaPay.setApiKey(cfg.pay.fedapay.key);
  FedaPay.setEnvironment(cfg.pay.fedapay.env);
  if (apiBase) FedaPay.setApiBase(apiBase);

  return {
    mode: 'fedapay',
    async createCheckout({ amount, description, callbackUrl, email }) {
      const tx = await Transaction.create({
        description,
        amount,
        currency: { iso: 'XOF' },
        callback_url: callbackUrl,
        customer: { email },
      });
      const tok = await tx.generateToken();
      if (!tok || !tok.url) throw new Error('FedaPay : pas d’URL de paiement');
      return { txId: String(tx.id), url: tok.url };
    },
    async getTransaction(txId) {
      const tx = await Transaction.retrieve(txId);
      return { status: String(tx.status), amount: Number(tx.amount) };
    },
    parseWebhook(rawBody, signature) {
      const secret = cfg.pay.fedapay.webhookSecret;
      if (!secret) throw new Error('FEDAPAY_WEBHOOK_SECRET manquant');
      const ev = Webhook.constructEvent(rawBody.toString('utf8'), signature || '', secret); // lève si signature ou horodatage invalide
      const ent = ev.entity || ev['v1/transaction'] || ev.object || {};
      const id = ent.id ?? ent.transaction_id;
      return { name: String(ev.name || ''), txId: id != null ? String(id) : null };
    },
  };
}

module.exports = { createFedaPayClient };
