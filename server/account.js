'use strict';
const { wrap, rateLimit, setCookie } = require('./http');
const { randomToken, sha256, hashPassword, verifyPassword } = require('./crypto');
const { createMailer } = require('./mailer');

const HOUR = 3600000;

function mount(deps, overrides = {}) {
  const { cfg, db } = deps;
  const mailer = overrides.mailer || createMailer(cfg);
  deps.mailer = mailer;
  const q = {
    byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    addTok: db.prepare('INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)'),
    getTok: db.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND kind = ?'),
    delTok: db.prepare('DELETE FROM email_tokens WHERE token_hash = ?'),
    delUserTok: db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?'),
    verified: db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?'),
    setPass: db.prepare('UPDATE users SET pass_hash = ?, email_verified = 1 WHERE id = ?'),
    setPassOnly: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
    delSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    delOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    delUser: db.prepare('DELETE FROM users WHERE id = ?'),
    state: db.prepare('SELECT key, json FROM user_state WHERE user_id = ?'),
    pays: db.prepare('SELECT offer, amount, currency, provider, status, created_at, paid_at FROM payments WHERE user_id = ? ORDER BY id'),
    socials: db.prepare('SELECT platform, name, status, last_sync FROM social_accounts WHERE user_id = ?'),
    snaps: db.prepare('SELECT platform, taken_at, f, v, l, p FROM social_snapshots WHERE user_id = ? ORDER BY taken_at'),
  };

  async function sendToken(user, kind) {
    q.delUserTok.run(user.id, kind); // un seul lien valide à la fois
    const tok = randomToken(32);
    q.addTok.run(sha256(tok), user.id, kind, Date.now() + (kind === 'reset' ? HOUR : 24 * HOUR));
    const link = `${cfg.appUrl}/?${kind}=${tok}`;
    const text = kind === 'reset'
      ? `Bonjour,\n\nPour choisir un nouveau mot de passe Synthia, ouvre ce lien (valable 1 heure) :\n${link}\n\nSi tu n'as rien demandé, ignore ce message : ton mot de passe ne change pas.`
      : `Bonjour,\n\nConfirme ton adresse e-mail Synthia avec ce lien (valable 24 heures) :\n${link}\n`;
    await mailer.send({ to: user.email, subject: kind === 'reset' ? 'Synthia : nouveau mot de passe' : 'Synthia : confirme ton adresse e-mail', text });
  }
  deps.afterRegister = (user) => sendToken(user, 'verify');

  const useToken = (raw, kind) => {
    const t = q.getTok.get(sha256(String(raw || '')), kind);
    if (!t || t.expires_at < Date.now()) return null;
    q.delTok.run(t.token_hash);
    return q.byId.get(t.user_id);
  };

  deps.routes.push((app) => {
    const strictOf = () => rateLimit({ max: 10, windowMs: 15 * 60 * 1000 });

    // Réponse identique que l'adresse existe ou non (pas d'énumération de comptes).
    app.post('/api/auth/forgot', strictOf(), wrap(async (req, res) => {
      const u = q.byEmail.get(String(req.body?.email || '').trim().toLowerCase());
      if (u) { try { await sendToken(u, 'reset'); } catch (e) { console.error('[mail] reset', e.message); } }
      res.json({ ok: true, message: 'Si un compte existe avec cette adresse, un e-mail vient d’être envoyé.' });
    }));

    app.post('/api/auth/reset', strictOf(), wrap((req, res) => {
      const pw = String(req.body?.password || '');
      if (pw.length < 8 || pw.length > 200) return res.status(400).json({ error: 'mot_de_passe_court', message: 'Mot de passe : 8 caractères minimum.' });
      const u = useToken(req.body?.token, 'reset');
      if (!u) return res.status(400).json({ error: 'lien_invalide', message: 'Ce lien est invalide ou expiré. Redemande un e-mail.' });
      db.transaction(() => { q.setPass.run(hashPassword(pw), u.id); q.delSessions.run(u.id); })(); // déconnecte les autres appareils
      res.json({ ok: true });
    }));

    // Changer son mot de passe depuis le compte : l'ancien est exigé, les autres appareils sont déconnectés.
    app.post('/api/me/password', deps.requireUser, rateLimit({ max: 10, windowMs: 15 * 60 * 1000, key: (r) => 'pw' + r.user.id }), wrap((req, res) => {
      const cur = String(req.body?.current || '');
      const next = String(req.body?.next || '');
      if (!verifyPassword(cur, req.user.pass_hash)) return res.status(403).json({ error: 'mot_de_passe_incorrect', message: 'Le mot de passe actuel est incorrect.' });
      if (next.length < 8 || next.length > 200) return res.status(400).json({ error: 'mot_de_passe_court', message: 'Mot de passe : 8 caractères minimum.' });
      if (next === cur) return res.status(400).json({ error: 'identique', message: 'Choisis un mot de passe différent de l’actuel.' });
      const mine = sha256(String(req.cookies?.sid || ''));
      db.transaction(() => { q.setPassOnly.run(hashPassword(next), req.user.id); q.delOtherSessions.run(req.user.id, mine); })();
      res.json({ ok: true });
    }));

    // Déconnexion de tous les appareils, y compris celui-ci.
    app.post('/api/auth/logout-all', deps.requireUser, wrap((req, res) => {
      q.delSessions.run(req.user.id);
      setCookie(res, 'sid', '', { maxAgeSec: 0, secure: cfg.prod });
      res.json({ ok: true });
    }));

    app.post('/api/auth/verify', strictOf(), wrap((req, res) => {
      const u = useToken(req.body?.token, 'verify');
      if (!u) return res.status(400).json({ error: 'lien_invalide', message: 'Ce lien est invalide ou expiré.' });
      q.verified.run(u.id);
      res.json({ ok: true });
    }));

    app.post('/api/auth/verify/send', deps.requireUser, rateLimit({ max: 3, windowMs: HOUR, key: (r) => 'u' + r.user.id }), wrap(async (req, res) => {
      if (req.user.email_verified) return res.json({ ok: true, already: true });
      try { await sendToken(req.user, 'verify'); } catch (e) { console.error('[mail] verify', e.message); return res.status(502).json({ error: 'mail_indisponible', message: 'L’e-mail n’a pas pu partir, réessaie plus tard.' }); }
      res.json({ ok: true });
    }));

    app.get('/api/me/export', deps.requireUser, (req, res) => {
      const u = req.user, state = {};
      for (const r of q.state.all(u.id)) { try { state[r.key] = JSON.parse(r.json); } catch (e) { /* ignorée */ } }
      res.set('Content-Disposition', 'attachment; filename="synthia-mes-donnees.json"');
      res.json({
        exportedAt: new Date().toISOString(),
        account: { email: u.email, emailVerified: !!u.email_verified, createdAt: u.created_at, premiumUntil: u.premium_until || null, aiProvider: u.ai_provider },
        state, payments: q.pays.all(u.id), socialAccounts: q.socials.all(u.id), socialSnapshots: q.snaps.all(u.id),
      });
    });

    // Suppression : mot de passe exigé. Paiements gardés mais détachés du compte ; jetons réseaux, état, sessions supprimés.
    app.post('/api/me/delete', deps.requireUser, rateLimit({ max: 5, windowMs: 15 * 60 * 1000, key: (r) => 'd' + r.user.id }), wrap((req, res) => {
      if (!verifyPassword(String(req.body?.password || ''), req.user.pass_hash)) return res.status(403).json({ error: 'identifiants', message: 'Mot de passe incorrect.' });
      q.delUser.run(req.user.id);
      setCookie(res, 'sid', '', { maxAgeSec: 0, secure: cfg.prod });
      res.json({ ok: true });
    }));
  });
}
module.exports = { mount };
