'use strict';
const { randomToken, sha256, hashPassword, verifyPassword, burnPassword } = require('./crypto');
const { setCookie, rateLimit, wrap } = require('./http');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const COOKIE = 'sid';

function userView(u) {
  const now = Date.now();
  return { id: u.id, email: u.email, emailVerified: !!u.email_verified, offer: u.premium_until > now ? 'PREMIUM' : 'FREE', premiumUntil: u.premium_until > now ? u.premium_until : null, aiProvider: u.ai_provider || null };
}

function mount(deps) {
  const { cfg, db } = deps;
  const q = {
    byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    insert: db.prepare('INSERT INTO users (email, pass_hash, created_at) VALUES (?, ?, ?)'),
    session: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionGet: db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
    sessionDel: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };
  const secure = cfg.prod;
  const maxAge = cfg.sessionDays * 86400;

  function open(res, userId) {
    const tok = randomToken(32);
    q.session.run(sha256(tok), userId, Date.now() + maxAge * 1000);
    setCookie(res, COOKIE, tok, { maxAgeSec: maxAge, secure });
    q.purge.run(Date.now());
  }

  /* Charge req.user si le cookie correspond à une session valide. */
  deps.loadUser = (req, res, next) => {
    req.user = null;
    const tok = req.cookies && req.cookies[COOKIE];
    if (tok) {
      const s = q.sessionGet.get(sha256(tok));
      if (s && s.expires_at > Date.now()) req.user = q.byId.get(s.user_id) || null;
    }
    next();
  };
  deps.requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'non_connecte', message: 'Connecte-toi pour continuer.' }));
  deps.freshUser = (id) => q.byId.get(id);
  deps.userView = userView;

  deps.routes.push((app) => {
    const login = rateLimit({ max: 10, windowMs: 15 * 60 * 1000 });
    app.use('/api', deps.loadUser);

    app.post('/api/auth/register', login, wrap(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const pw = String(req.body?.password || '');
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email_invalide', message: 'Adresse e-mail invalide.' });
      if (pw.length < 8 || pw.length > 200) return res.status(400).json({ error: 'mot_de_passe_court', message: 'Mot de passe : 8 caractères minimum.' });
      if (q.byEmail.get(email)) return res.status(409).json({ error: 'email_pris', message: 'Un compte existe déjà avec cette adresse.' });
      const info = q.insert.run(email, hashPassword(pw), Date.now());
      open(res, info.lastInsertRowid);
      if (deps.afterRegister) Promise.resolve(deps.afterRegister(q.byId.get(info.lastInsertRowid))).catch(() => {});
      res.status(201).json({ user: userView(q.byId.get(info.lastInsertRowid)) });
    }));

    app.post('/api/auth/login', login, wrap(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const pw = String(req.body?.password || '');
      const u = q.byEmail.get(email);
      const ok = u ? verifyPassword(pw, u.pass_hash) : (burnPassword(pw), false);
      if (!ok) return res.status(401).json({ error: 'identifiants', message: 'E-mail ou mot de passe incorrect.' });
      open(res, u.id);
      res.json({ user: userView(u) });
    }));

    app.post('/api/auth/logout', (req, res) => {
      const tok = req.cookies && req.cookies[COOKIE];
      if (tok) q.sessionDel.run(sha256(tok));
      setCookie(res, COOKIE, '', { maxAgeSec: 0, secure });
      res.json({ ok: true });
    });
  });
}

module.exports = { mount, userView };
