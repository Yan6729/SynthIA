'use strict';
const express = require('express');
const http = require('./http');

/* createApp reçoit tout ce qui touche l'extérieur (config, base, IA, paiement, réseaux) : les tests injectent de faux clients. */
function createApp(deps) {
  const { cfg } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.prod ? 1 : false);
  app.locals.deps = deps;

  // Journal : une ligne JSON par requête, sans query string, sans IP, sans corps (pas de données personnelles).
  if (cfg.logRequests) {
    app.use((req, res, next) => {
      const t0 = process.hrtime.bigint();
      res.on('finish', () => {
        if (req.path === '/healthz') return;
        console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: req.path, s: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6) }));
      });
      next();
    });
  }
  app.use(http.securityHeaders(cfg));
  app.use(http.cookieMiddleware);

  // Le webhook a besoin du corps brut pour vérifier la signature : monté avant express.json.
  for (const mount of deps.rawMounts || []) mount(app);

  app.use(express.json({ limit: '512kb' }));
  app.use('/api', http.csrfGuard(cfg));
  app.use('/api', http.rateLimit({ max: 300, windowMs: 15 * 60 * 1000 }));

  app.get('/healthz', (req, res) => {
    try { deps.db.prepare('SELECT 1').get(); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false }); }
  });

  for (const mount of deps.routes || []) mount(app);

  app.use('/api', (req, res) => res.status(404).json({ error: 'introuvable' }));

  app.use(express.static(cfg.publicDir, {
    setHeaders(res, file) {
      if (file.endsWith('sw.js') || file.endsWith('index.html')) res.set('Cache-Control', 'no-cache');
    },
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'trop_gros' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'json_invalide' });
    console.error('[erreur]', req.method, req.path, err.message);
    res.status(500).json({ error: 'erreur_serveur' });
  });
  return app;
}

module.exports = { createApp };
