'use strict';
const { wrap } = require('./http');

/* Clés reprises du localStorage du front. `offer` n'y est volontairement pas : l'offre vient de la base. */
const KEYS = ['prof', 'st', 'plan', 'done', 'res', 'soc', 'demo', 'reco', 'arch', 'seen', 'avatar'];

/* L'avatar est affiché dans un <img> : on n'accepte que null, un préréglé (identifiant court) ou un JPEG en base64 de taille bornée. */
const AVATAR_MAX = 100000;
function avatarOk(v) {
  if (v === null) return true;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v.t === 'i') return Object.keys(v).length === 1;
  if (v.t === 'p') return Object.keys(v).length === 2 && typeof v.id === 'string' && /^[a-z]{2,12}$/.test(v.id);
  if (v.t === 'u') return Object.keys(v).length === 2 && typeof v.d === 'string' && v.d.length <= AVATAR_MAX && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v.d);
  return false;
}
const VALID = { avatar: avatarOk };
const MAX_BYTES = 256 * 1024;

function mount(deps) {
  const { db } = deps;
  const q = {
    all: db.prepare('SELECT key, json FROM user_state WHERE user_id = ?'),
    set: db.prepare(`INSERT INTO user_state (user_id, key, json, updated_at) VALUES (?, ?, ?, ?)
                     ON CONFLICT(user_id, key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`),
    delAll: db.prepare('DELETE FROM user_state WHERE user_id = ?'),
  };

  deps.routes.push((app) => {
    app.get('/api/state', deps.requireUser, (req, res) => {
      const state = {};
      for (const r of q.all.all(req.user.id)) { try { state[r.key] = JSON.parse(r.json); } catch (e) { /* ligne corrompue ignorée */ } }
      res.json({ state });
    });

    app.put('/api/state/:key', deps.requireUser, wrap((req, res) => {
      const { key } = req.params;
      if (!KEYS.includes(key)) return res.status(400).json({ error: 'cle_inconnue' });
      if (!req.body || !('value' in req.body)) return res.status(400).json({ error: 'valeur_manquante' });
      if (VALID[key] && !VALID[key](req.body.value)) return res.status(400).json({ error: 'valeur_invalide' });
      const json = JSON.stringify(req.body.value);
      if (json === undefined || Buffer.byteLength(json) > MAX_BYTES) return res.status(413).json({ error: 'trop_gros' });
      q.set.run(req.user.id, key, json, Date.now());
      res.json({ ok: true });
    }));

    /* Import unique des données d'invité (plusieurs clés d'un coup, sans écraser ce qui existe déjà côté serveur). */
    app.post('/api/state/import', deps.requireUser, wrap((req, res) => {
      const incoming = req.body?.state;
      if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'etat_manquant' });
      const have = new Set(q.all.all(req.user.id).map((r) => r.key));
      let n = 0;
      db.transaction(() => {
        for (const k of KEYS) {
          if (!(k in incoming) || have.has(k)) continue;
          if (VALID[k] && !VALID[k](incoming[k])) continue;
          const json = JSON.stringify(incoming[k]);
          if (json === undefined || Buffer.byteLength(json) > MAX_BYTES) continue;
          q.set.run(req.user.id, k, json, Date.now()); n++;
        }
      })();
      res.json({ imported: n });
    }));

    app.delete('/api/state', deps.requireUser, (req, res) => { q.delAll.run(req.user.id); res.json({ ok: true }); });
  });
}

module.exports = { mount, KEYS };
