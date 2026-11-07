'use strict';
/* Petits utilitaires HTTP écrits à la main : cookies, limitation de débit, en-têtes, CSRF. */

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    const k = p.slice(0, i).trim();
    if (k && !(k in out)) { try { out[k] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* ignoré */ } }
  });
  return out;
}

function cookieMiddleware(req, res, next) { req.cookies = parseCookies(req.headers.cookie); next(); }

function setCookie(res, name, value, { maxAgeSec, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function securityHeaders(cfg) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // le front de l'équipe contient un script inline (dette notée dans DESIGN-MVP.md)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // feuille de style des polices Google, chargée seulement si l'utilisateur en choisit une
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:", // vidéo choisie pour le thème : lue dans le navigateur, jamais envoyée
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp,
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (cfg.prod) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

function rateLimit({ max, windowMs, key = (req) => req.ip, now = Date.now }) {
  const hits = new Map();
  let last = now();
  return (req, res, next) => {
    const t = now();
    if (t - last > windowMs) { for (const [k, v] of hits) if (v.reset <= t) hits.delete(k); last = t; }
    const k = key(req);
    let h = hits.get(k);
    if (!h || h.reset <= t) { h = { n: 0, reset: t + windowMs }; hits.set(k, h); }
    h.n++;
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - t) / 1000)));
      return res.status(429).json({ error: 'trop_de_requetes', message: 'Trop de tentatives, réessaie dans quelques minutes.' });
    }
    next();
  };
}

/* Requêtes qui modifient l'état : JSON obligatoire (un <form> ne peut pas en envoyer) et Origin identique s'il est présent. */
function csrfGuard(cfg, { formPaths = [/^\/pay\/simulate\//] } = {}) {
  return (req, res, next) => {
    const origin = new URL(cfg.appUrl).origin;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const o = req.headers.origin;
    if (o && o !== origin) return res.status(403).json({ error: 'origine_refusee' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'origine_refusee' });
    if (formPaths.some((re) => re.test(req.path))) return next(); // formulaire HTML de la page de paiement simulé (Origin déjà vérifié)
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return res.status(415).json({ error: 'json_requis' });
    }
    next();
  };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { parseCookies, cookieMiddleware, setCookie, securityHeaders, rateLimit, csrfGuard, wrap };
