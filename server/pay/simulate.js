'use strict';
/* Paiement simulé pour développer sans clé. Interdit en production (voir validateConfig). */
function createSimulateClient(cfg) {
  const txs = new Map();
  let n = 1000;
  return {
    mode: 'simulate',
    txs,
    async createCheckout({ amount, currency, callbackUrl }) {
      const txId = 'sim_' + (++n);
      txs.set(txId, { status: 'pending', amount, currency, callbackUrl });
      return { txId, url: `${cfg.appUrl}/api/pay/simulate/${txId}` };
    },
    async getTransaction(txId) {
      const t = txs.get(txId);
      if (!t) throw new Error('transaction inconnue');
      return { status: t.status, amount: t.amount, currency: t.currency };
    },
    parseWebhook() { throw new Error('pas de webhook en simulation'); },
    decide(txId, status) { const t = txs.get(txId); if (!t) return null; t.status = status; return t.callbackUrl; },
  };
}
module.exports = { createSimulateClient };
