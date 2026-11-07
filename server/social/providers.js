'use strict';
const { pkceChallenge } = require('../crypto');

/* TikTok, Instagram (connexion Instagram Business) et YouTube : code d'autorisation, lecture seule.
   Les URL de base sont réglables (tests avec faux serveurs). Portées et approbation d'application : à valider chez chaque plateforme. */

async function http(method, url, { headers = {}, form, json } = {}, timeoutMs = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const h = { ...headers };
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    if (json) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    const r = await fetch(url, { method, headers: h, body, signal: ctl.signal });
    const txt = await r.text();
    let data = null; try { data = JSON.parse(txt); } catch (e) { /* non JSON */ }
    if (!r.ok) { const err = new Error(`HTTP ${r.status}`); err.status = r.status; err.body = txt.slice(0, 200); throw err; }
    return data;
  } finally { clearTimeout(timer); }
}

const num = (x) => (x === undefined || x === null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const inSeconds = (s) => (num(s) ? Date.now() + Number(s) * 1000 : null);

const tiktok = {
  label: 'TikTok',
  pkce: false,
  authUrl(c, { redirectUri, state }) {
    const q = new URLSearchParams({ client_key: c.id, scope: 'user.info.basic,user.info.stats,video.list', response_type: 'code', redirect_uri: redirectUri, state });
    return `${c.authUrl}?${q}`;
  },
  async exchange(c, { code, redirectUri }) {
    const j = await http('POST', `${c.base}/v2/oauth/token/`, { form: { client_key: c.id, client_secret: c.secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri } });
    if (!j?.access_token) throw new Error('TikTok : pas de jeton');
    return { access: j.access_token, refresh: j.refresh_token || null, expiresAt: inSeconds(j.expires_in) };
  },
  async refresh(c, { refresh }) {
    const j = await http('POST', `${c.base}/v2/oauth/token/`, { form: { client_key: c.id, client_secret: c.secret, grant_type: 'refresh_token', refresh_token: refresh } });
    return { access: j.access_token, refresh: j.refresh_token || refresh, expiresAt: inSeconds(j.expires_in) };
  },
  async stats(c, { access }) {
    const h = { authorization: `Bearer ${access}` };
    const j = await http('GET', `${c.base}/v2/user/info/?fields=open_id,display_name,follower_count,likes_count,video_count`, { headers: h });
    const u = j?.data?.user;
    if (!u) throw new Error('TikTok : profil introuvable');
    let v = null; // vues = somme des 20 dernières vidéos (approximation) ; null si la portée video.list est refusée
    try {
      const vl = await http('POST', `${c.base}/v2/video/list/?fields=id,view_count`, { headers: h, json: { max_count: 20 } });
      const vids = vl?.data?.videos;
      if (Array.isArray(vids)) v = vids.reduce((a, x) => a + (num(x.view_count) || 0), 0);
    } catch (e) { /* saisie manuelle de secours côté front */ }
    return { extId: u.open_id, name: u.display_name, f: num(u.follower_count), v, l: num(u.likes_count), p: num(u.video_count) };
  },
};

const instagram = {
  label: 'Instagram',
  pkce: false,
  authUrl(c, { redirectUri, state }) {
    const q = new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri, response_type: 'code', scope: 'instagram_business_basic,instagram_business_manage_insights', state });
    return `${c.authUrl}?${q}`;
  },
  async exchange(c, { code, redirectUri }) {
    let j = await http('POST', `${c.base}/oauth/access_token`, { form: { client_id: c.id, client_secret: c.secret, grant_type: 'authorization_code', redirect_uri: redirectUri, code } });
    if (Array.isArray(j?.data)) j = j.data[0];
    if (!j?.access_token) throw new Error('Instagram : pas de jeton');
    const ll = await http('GET', `${c.graph}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: c.secret, access_token: j.access_token })}`);
    return { access: ll?.access_token || j.access_token, refresh: null, expiresAt: inSeconds(ll?.expires_in) };
  },
  async refresh(c, { access }) { // le jeton longue durée se renouvelle lui-même
    const j = await http('GET', `${c.graph}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: access })}`);
    return { access: j.access_token, refresh: null, expiresAt: inSeconds(j.expires_in) };
  },
  async stats(c, { access }) {
    const j = await http('GET', `${c.graph}/me?${new URLSearchParams({ fields: 'user_id,username,followers_count,media_count', access_token: access })}`);
    if (!j) throw new Error('Instagram : profil introuvable');
    return { extId: String(j.user_id || j.id || ''), name: j.username ? '@' + j.username : null, f: num(j.followers_count), v: null, l: null, p: num(j.media_count) };
  },
};

const youtube = {
  label: 'YouTube',
  pkce: true,
  authUrl(c, { redirectUri, state, verifier }) {
    const q = new URLSearchParams({
      client_id: c.id, redirect_uri: redirectUri, response_type: 'code', state,
      scope: 'https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent',
      code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256',
    });
    return `${c.authUrl}?${q}`;
  },
  async exchange(c, { code, redirectUri, verifier }) {
    const j = await http('POST', `${c.base}/token`, { form: { code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier } });
    if (!j?.access_token) throw new Error('YouTube : pas de jeton');
    return { access: j.access_token, refresh: j.refresh_token || null, expiresAt: inSeconds(j.expires_in) };
  },
  async refresh(c, { refresh }) {
    const j = await http('POST', `${c.base}/token`, { form: { client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token', refresh_token: refresh } });
    return { access: j.access_token, refresh, expiresAt: inSeconds(j.expires_in) };
  },
  async stats(c, { access }) {
    const j = await http('GET', `${c.api}/youtube/v3/channels?part=snippet,statistics&mine=true`, { headers: { authorization: `Bearer ${access}` } });
    const ch = j?.items?.[0];
    if (!ch) throw new Error('YouTube : aucune chaîne sur ce compte');
    const s = ch.statistics || {};
    return { extId: ch.id, name: ch.snippet?.title || null, f: s.hiddenSubscriberCount ? null : num(s.subscriberCount), v: num(s.viewCount), l: null, p: num(s.videoCount) };
  },
};

module.exports = { PROVIDERS: { tiktok, instagram, youtube } };
