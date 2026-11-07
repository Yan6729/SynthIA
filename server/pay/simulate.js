'use strict';
/* Paiement simulé pour développer sans clé. Interdit en production (voir validateConfig). */
function createSimulateClient(cfg) {
  const txs = new Map();
  let n = 1000;
  return {
    mode: 'simulate',
    txs,
    async createCheckout({ amount, callbackUrl }) {
      const txId = 'sim_' + (++n);
      txs.set(txId, { status: 'pending', amount, callbackUrl });
      return { txId, url: `${cfg.appUrl}/api/pay/simulate/${txId}` };
    },
    async getTransaction(txId) {
      const t = txs.get(txId);
      if (!t) throw new Error('transaction inconnue');
      return { status: t.status, amount: t.amount };
    },
    parseWebhook() { throw new Error('pas de webhook en simulation'); },
    decide(txId, status) { const t = txs.get(txId); if (!t) return null; t.status = status; return t.callbackUrl; },
  };
}
module.exports = { createSimulateClient };
