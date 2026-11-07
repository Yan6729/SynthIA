'use strict';
const express = require('express');
const { wrap } = require('../http');
const { createFedaPayClient } = require('./fedapay');
const { createSimulateClient } = require('./simulate');

const PAID = new Set(['approved', 'transferred']);
const DAY = 86400000;

function mount(deps, overrides = {}) {
  const { cfg, db } = deps;
  const client = overrides.pay || (cfg.pay.mode === 'fedapay' ? createFedaPayClient(cfg) : createSimulateClient(cfg));
  deps.pay = client;

  const q = {
    insert: db.prepare('INSERT INTO payments (user_id, offer, amount, provider, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    setTx: db.prepare('UPDATE payments SET provider_tx = ? WHERE id = ?'),
    byId: db.prepare('SELECT * FROM payments WHERE id = ?'),
    byTx: db.prepare('SELECT * FROM payments WHERE provider = ? AND provider_tx = ?'),
    setStatus: db.prepare("UPDATE payments SET status = ? WHERE id = ? AND status != 'approved'"),
    approve: db.prepare("UPDATE payments SET status = 'approved', paid_at = ? WHERE id = ? AND status != 'approved'"),
    user: db.prepare('SELECT premium_until FROM users WHERE id = ?'),
    setPremium: db.prepare('UPDATE users SET premium_until = ? WHERE id = ?'),
  };

  /* Relit la transaction chez le fournisseur et applique le résultat. Idempotent : un paiement n'active PREMIUM qu'une fois. */
  async function settle(payment) {
    if (payment.status === 'approved') return 'approved';
    const tx = await client.getTransaction(payment.provider_tx);
    if (PAID.has(tx.status)) {
      if (tx.amount !== payment.amount) { console.error('[paiement] montant inattendu', payment.id, tx.amount); q.setStatus.run('mismatch', payment.id); return 'mismatch'; }
      db.transaction(() => {
        const r = q.approve.run(Date.now(), payment.id);
        if (r.changes === 0) return false; // déjà traité (retour + webhook en parallèle)
        const u = q.user.get(payment.user_id);
        q.setPremium.run(Math.max(Date.now(), u.premium_until) + cfg.pay.days * DAY, payment.user_id);
        return true;
      })();
      return 'approved';
    }
    q.setStatus.run(tx.status, payment.id);
    return tx.status;
  }
  deps.settlePayment = settle;

  // Webhook : corps brut obligatoire pour la signature. Il sert de déclencheur, la vérité vient de getTransaction.
  deps.rawMounts.push((app) => {
    app.post('/api/pay/webhook', express.raw({ type: '*/*', limit: '100kb' }), wrap(async (req, res) => {
      let ev;
      try { ev = client.parseWebhook(req.body, req.headers['x-fedapay-signature']); } catch (e) { return res.status(400).json({ error: 'signature_invalide' }); }
      if (!ev.txId) return res.status(200).json({ ignored: true });
      const p = q.byTx.get(client.mode, ev.txId);
      if (!p) return res.status(200).json({ ignored: true }); // transaction qui n'est pas la nôtre
      try { await settle(p); } catch (e) { console.error('[paiement] webhook', e.message); return res.status(500).json({ error: 'verification_impossible' }); } // FedaPay réessaiera
      res.json({ ok: true });
    }));
  });

  deps.routes.push((app) => {
    app.post('/api/pay/checkout', deps.requireUser, wrap(async (req, res) => {
      if (req.body?.offer !== 'PREMIUM') return res.status(400).json({ error: 'offre_inconnue' });
      const amount = cfg.pay.price;
      const id = q.insert.run(req.user.id, 'PREMIUM', amount, client.mode, 'pending', Date.now()).lastInsertRowid;
      try {
        const out = await client.createCheckout({
          amount, description: 'Synthia PREMIUM (30 jours)', email: req.user.email,
          callbackUrl: `${cfg.appUrl}/api/pay/return?p=${id}`,
        });
        q.setTx.run(out.txId, id);
        res.json({ url: out.url, paymentId: Number(id) });
      } catch (e) {
        console.error('[paiement] checkout', e.message);
        q.setStatus.run('failed', id);
        res.status(502).json({ error: 'paiement_indisponible', message: 'Le service de paiement ne répond pas, réessaie dans un instant.' });
      }
    }));

    // Retour du navigateur après paiement : on ne croit PAS les paramètres de l'URL, on relit la transaction.
    app.get('/api/pay/return', wrap(async (req, res) => {
      const p = q.byId.get(Number(req.query.p));
      if (!req.user) return res.redirect('/?paid=login');
      if (!p || p.user_id !== req.user.id || !p.provider_tx) return res.redirect('/?paid=error');
      try {
        const st = await settle(p);
        res.redirect(st === 'approved' ? '/?paid=ok' : st === 'pending' ? '/?paid=pending' : '/?paid=failed');
      } catch (e) {
        console.error('[paiement] retour', e.message);
        res.redirect('/?paid=pending'); // le webhook terminera
      }
    }));

    if (client.mode === 'simulate') {
      app.get('/api/pay/simulate/:tx', (req, res) => {
        const t = client.txs.get(req.params.tx);
        if (!t) return res.status(404).send('Transaction inconnue');
        res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paiement (simulation)</title>
<body style="font-family:system-ui;max-width:380px;margin:12vh auto;padding:0 16px;text-align:center">
<h1 style="font-size:20px">Paiement simulé</h1><p>Synthia PREMIUM, <b>${Number(t.amount)} FCFA</b></p>
<p style="font-size:13px;color:#666">Mode développement : aucun argent n’est débité.</p>
<form method="post" action="/api/pay/simulate/${encodeURIComponent(req.params.tx)}/decide" style="display:grid;gap:8px;margin-top:20px">
<button name="status" value="approved" style="padding:12px;font-size:16px">Payer</button>
<button name="status" value="declined" style="padding:12px;font-size:16px">Refuser</button></form></body>`);
      });
      app.post('/api/pay/simulate/:tx/decide', express.urlencoded({ extended: false }), (req, res) => {
        const status = req.body?.status === 'approved' ? 'approved' : 'declined';
        const back = client.decide(req.params.tx, status);
        if (!back) return res.status(404).send('Transaction inconnue');
        res.redirect(back);
      });
    }
  });
}

module.exports = { mount };
