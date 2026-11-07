'use strict';
/* GET /api/me : ce que le front doit savoir pour s'adapter (utilisateur, offre, fonctions disponibles). */
function mount(deps) {
  const { cfg } = deps;
  deps.routes.push((app) => {
    app.get('/api/me', (req, res) => {
      const features = {
        ai: Object.entries(cfg.ai.providers).filter(([, p]) => p.key).map(([k]) => k),
        aiDefault: cfg.ai.default,
        payMode: cfg.pay.mode,
        price: cfg.pay.price,
        social: cfg.tokenKey ? Object.entries(cfg.social).filter(([, p]) => p.id && p.secret).map(([k]) => k) : [],
      };
      res.json({ user: req.user ? deps.userView(req.user) : null, features });
    });
  });
}
module.exports = { mount };
