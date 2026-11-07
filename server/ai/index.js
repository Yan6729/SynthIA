'use strict';
const { wrap } = require('../http');
const { buildRegistry } = require('./providers');
const { cleanProfil, planPrompt, advicePrompt } = require('./prompts');
const { validatePlan, validateAdvice, cleanText } = require('./validate');

function mount(deps, overrides = {}) {
  const { cfg, db } = deps;
  const registry = overrides.ai || buildRegistry(cfg);
  deps.ai = registry;

  const q = {
    usage: db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?'),
    bump: db.prepare(`INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)
                      ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`),
    setProv: db.prepare('UPDATE users SET ai_provider = ? WHERE id = ?'),
  };
  const today = () => new Date().toISOString().slice(0, 10);

  function chosen(user) {
    const names = registry.names();
    if (user.ai_provider && names.includes(user.ai_provider)) return user.ai_provider;
    if (names.includes(cfg.ai.default)) return cfg.ai.default;
    return names[0] || null;
  }

  /* Contrôles communs : PREMIUM, fournisseur disponible, quota. Renvoie le fournisseur ou répond lui-même. */
  function gate(req, res) {
    if (req.user.premium_until <= Date.now()) { res.status(402).json({ error: 'premium_requis', message: 'Les textes et conseils IA font partie de PREMIUM.' }); return null; }
    const name = chosen(req.user);
    if (!name) { res.status(503).json({ error: 'ia_indisponible', message: 'Aucun fournisseur IA n’est configuré.' }); return null; }
    const used = q.usage.get(req.user.id, today())?.count || 0;
    if (used >= cfg.ai.dailyQuota) { res.status(429).json({ error: 'quota_ia', message: 'Limite quotidienne atteinte, reviens demain.' }); return null; }
    q.bump.run(req.user.id, today());
    return name;
  }

  deps.routes.push((app) => {
    app.put('/api/me/ai', deps.requireUser, (req, res) => {
      const p = req.body?.provider;
      if (p !== null && !registry.names().includes(p)) return res.status(400).json({ error: 'fournisseur_inconnu' });
      q.setProv.run(p, req.user.id);
      res.json({ ok: true, provider: p });
    });

    app.post('/api/ai/plan', deps.requireUser, wrap(async (req, res) => {
      const actions = Array.isArray(req.body?.actions) ? req.body.actions.slice(0, 60) : null;
      if (!actions || !actions.length) return res.status(400).json({ error: 'actions_manquantes' });
      const clean = actions.filter((a) => a && (typeof a.id === 'number' || typeof a.id === 'string'))
        .map((a) => ({ id: a.id, ch: cleanText(a.ch, 40), what: cleanText(a.what, 160), text: cleanText(a.text, 600) }));
      const name = gate(req, res); if (!name) return;
      try {
        const raw = await registry.complete(name, planPrompt(cleanProfil(req.body.profil), clean));
        res.json(validatePlan(raw, clean.map((a) => a.id)));
      } catch (e) {
        console.error('[ia] plan', name, e.message);
        res.json([]); // le front garde les textes du moteur à règles
      }
    }));

    app.post('/api/ai/advice', deps.requireUser, wrap(async (req, res) => {
      const week = Number(req.body?.week);
      if (!Number.isInteger(week) || week < 1 || week > 8) return res.status(400).json({ error: 'semaine_invalide' });
      const results = JSON.stringify(req.body?.results ?? null);
      if (results.length > 4000) return res.status(413).json({ error: 'trop_gros' });
      const name = gate(req, res); if (!name) return;
      try {
        const raw = await registry.complete(name, advicePrompt(cleanProfil(req.body.profil), week, JSON.parse(results)));
        res.json({ tips: validateAdvice(raw), provider: name });
      } catch (e) {
        console.error('[ia] conseils', name, e.message);
        res.json({ tips: [], provider: name });
      }
    }));
  });
}

module.exports = { mount };
