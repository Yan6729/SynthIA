'use strict';
/* Envoi d'e-mails : « console » (dev : le message est écrit dans les journaux) ou « resend » (API HTTP Resend, format à vérifier avec ta clé). */
function createMailer(cfg) {
  if (cfg.mail.mode === 'resend') {
    return {
      mode: 'resend',
      async send({ to, subject, text }) {
        const r = await fetch(`${cfg.mail.base}/emails`, {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.mail.key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: cfg.mail.from, to: [to], subject, text }),
        });
        if (!r.ok) throw new Error(`mail HTTP ${r.status}`);
      },
    };
  }
  return { mode: 'console', async send({ to, subject, text }) { console.log(`[mail:console] à ${to} · ${subject}\n${text}\n`); } };
}
module.exports = { createMailer };
