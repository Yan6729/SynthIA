'use strict';
const { wrap } = require('../http');
const { randomToken, encrypt, decrypt } = require('../crypto');
const { PROVIDERS } = require('./providers');

const HOUR = 3600000;

function mount(deps, overrides = {}) {
  const { cfg, db } = deps;
  const providers = overrides.socialProviders || PROVIDERS;
  const usable = (p) => !!(cfg.tokenKey && cfg.social[p]?.id && cfg.social[p]?.secret && providers[p]);
  const redirectUri = (p) => `${cfg.appUrl}/oauth/callback/${p}`;

  const q = {
    addState: db.prepare('INSERT INTO oauth_states (state, user_id, platform, verifier, expires_at) VALUES (?, ?, ?, ?, ?)'),
    getState: db.prepare('SELECT * FROM oauth_states WHERE state = ?'),
    delState: db.prepare('DELETE FROM oauth_states WHERE state = ?'),
    purge: db.prepare('DELETE FROM oauth_states WHERE expires_at < ?'),
    upsert: db.prepare(`INSERT INTO social_accounts (user_id, platform, ext_id, name, access_enc, refresh_enc, expires_at, status, last_sync)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?)
                        ON CONFLICT(user_id, platform) DO UPDATE SET ext_id = excluded.ext_id, name = excluded.name, access_enc = excluded.access_enc,
                          refresh_enc = excluded.refresh_enc, expires_at = excluded.expires_at, status = 'ok', last_sync = excluded.last_sync`),
    acct: db.prepare('SELECT * FROM social_accounts WHERE user_id = ? AND platform = ?'),
    accts: db.prepare('SELECT * FROM social_accounts WHERE user_id = ?'),
    tokens: db.prepare('UPDATE social_accounts SET access_enc = ?, refresh_enc = ?, expires_at = ? WHERE user_id = ? AND platform = ?'),
    mark: db.prepare('UPDATE social_accounts SET status = ? WHERE user_id = ? AND platform = ?'),
    synced: db.prepare('UPDATE social_accounts SET last_sync = ?, name = COALESCE(?, name) WHERE user_id = ? AND platform = ?'),
    snap: db.prepare('INSERT INTO social_snapshots (user_id, platform, taken_at, f, v, l, p) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    snaps: db.prepare('SELECT taken_at t, f, v, l, p FROM social_snapshots WHERE user_id = ? AND platform = ? ORDER BY taken_at DESC LIMIT 12'),
    delAcct: db.prepare('DELETE FROM social_accounts WHERE user_id = ? AND platform = ?'),
    delSnaps: db.prepare('DELETE FROM social_snapshots WHERE user_id = ? AND platform = ?'),
  };

  /* Relève les chiffres : renouvelle le jeton s'il expire dans moins d'un jour, enregistre un relevé. */
  async function sync(userId, p) {
    const a = q.acct.get(userId, p);
    if (!a) throw Object.assign(new Error('non connecté'), { code: 'absent' });
    const c = cfg.social[p], prov = providers[p];
    let access = decrypt(a.access_enc, cfg.tokenKey);
    const refresh = a.refresh_enc ? decrypt(a.refresh_enc, cfg.tokenKey) : null;
    try {
      if (a.expires_at && a.expires_at < Date.now() + 86400000 && (refresh || p === 'instagram')) {
        const t = await prov.refresh(c, { access, refresh });
        access = t.access;
        q.tokens.run(encrypt(t.access, cfg.tokenKey), t.refresh ? encrypt(t.refresh, cfg.tokenKey) : null, t.expiresAt, userId, p);
      }
      const s = await prov.stats(c, { access });
      const now = Date.now();
      q.snap.run(userId, p, now, s.f, s.v, s.l, s.p);
      q.synced.run(now, s.name, userId, p);
      return s;
    } catch (e) {
      if (e.status === 401 || e.status === 403 || e.status === 400) q.mark.run('expired', userId, p);
      throw e;
    }
  }

  const view = (userId) => {
    const out = {};
    for (const a of q.accts.all(userId)) {
      out[a.platform] = { live: true, name: a.name, status: a.status, lastSync: a.last_sync, hist: q.snaps.all(userId, a.platform).reverse() };
    }
    return out;
  };

  deps.routes.push((app) => {
    app.get('/api/social', deps.requireUser, (req, res) => res.json({ accounts: view(req.user.id) }));

    app.get('/api/social/:p/connect', deps.requireUser, (req, res) => {
      const p = req.params.p;
      if (!usable(p)) return res.status(404).json({ error: 'reseau_non_configure', message: 'Ce réseau n’est pas encore activé sur ce serveur.' });
      const state = randomToken(24), verifier = providers[p].pkce ? randomToken(48) : null;
      q.purge.run(Date.now());
      q.addState.run(state, req.user.id, p, verifier, Date.now() + 10 * 60 * 1000);
      res.json({ url: providers[p].authUrl(cfg.social[p], { redirectUri: redirectUri(p), state, verifier }) });
    });

    // Retour de la plateforme : navigation top-level, le cookie de session (SameSite=Lax) est bien envoyé.
    app.get('/oauth/callback/:p', deps.loadUser, wrap(async (req, res) => {
      const p = req.params.p;
      const fail = (why) => res.redirect(`/?social=${why}&p=${encodeURIComponent(p)}`);
      if (!usable(p) || !req.user) return fail('error');
      const st = q.getState.get(String(req.query.state || ''));
      if (st) q.delState.run(st.state); // usage unique
      if (!st || st.user_id !== req.user.id || st.platform !== p || st.expires_at < Date.now()) return fail('error');
      if (req.query.error || !req.query.code) return fail('denied');
      try {
        const t = await providers[p].exchange(cfg.social[p], { code: String(req.query.code), redirectUri: redirectUri(p), verifier: st.verifier });
        const s = await providers[p].stats(cfg.social[p], { access: t.access });
        const now = Date.now();
        q.upsert.run(req.user.id, p, s.extId || null, s.name || null, encrypt(t.access, cfg.tokenKey), t.refresh ? encrypt(t.refresh, cfg.tokenKey) : null, t.expiresAt, now);
        q.snap.run(req.user.id, p, now, s.f, s.v, s.l, s.p);
        fail('ok');
      } catch (e) {
        console.error('[réseaux] callback', p, e.message, e.body || '');
        fail('error');
      }
    }));

    app.post('/api/social/:p/sync', deps.requireUser, wrap(async (req, res) => {
      const p = req.params.p;
      const a = q.acct.get(req.user.id, p);
      if (!a) return res.status(404).json({ error: 'non_connecte' });
      if (a.last_sync && Date.now() - a.last_sync < HOUR) return res.status(429).json({ error: 'trop_tot', message: 'Un seul relevé par heure.', retryAt: a.last_sync + HOUR });
      try { await sync(req.user.id, p); res.json({ accounts: view(req.user.id) }); }
      catch (e) {
        console.error('[réseaux] sync', p, e.message);
        res.status(502).json({ error: q.acct.get(req.user.id, p).status === 'expired' ? 'connexion_expiree' : 'reseau_indisponible', message: 'Impossible de relever les chiffres pour le moment.' });
      }
    }));

    app.delete('/api/social/:p', deps.requireUser, (req, res) => {
      db.transaction(() => { q.delAcct.run(req.user.id, req.params.p); q.delSnaps.run(req.user.id, req.params.p); })();
      res.json({ ok: true });
    });
  });
}

module.exports = { mount };
