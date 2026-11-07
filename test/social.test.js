'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { start } = require('./helpers');
const { decrypt } = require('../server/crypto');
const { pkceChallenge } = require('../server/crypto');

/* Faux TikTok + Instagram + YouTube dans un seul serveur local, qui enregistre ce qu'il reçoit. */
async function fakePlatforms() {
  const seen = [];
  let ytExpire = false;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      seen.push({ m: req.method, path: url.pathname, q: Object.fromEntries(url.searchParams), h: req.headers, body: b });
      res.setHeader('content-type', 'application/json');
      const J = (o, s = 200) => { res.statusCode = s; res.end(JSON.stringify(o)); };
      switch (url.pathname) {
        case '/tt/v2/oauth/token/': return J({ access_token: 'TT_ACCESS', refresh_token: 'TT_REFRESH', expires_in: 86400 });
        case '/tt/v2/user/info/': return J({ data: { user: { open_id: 'tt_1', display_name: 'Zeynab TT', follower_count: 3200, likes_count: 4100, video_count: 24 } } });
        case '/tt/v2/video/list/': return J({ data: { videos: [{ id: 'a', view_count: 1000 }, { id: 'b', view_count: 500 }] } });
        case '/ig/oauth/access_token': return J({ access_token: 'IG_SHORT', user_id: 99 });
        case '/ig/access_token': return J({ access_token: 'IG_LONG', expires_in: 5184000 });
        case '/ig/me': return J({ user_id: '99', username: 'zeynabkora', followers_count: 1450, media_count: 31 });
        case '/yt/token': return J({ access_token: 'YT_ACCESS', refresh_token: 'YT_REFRESH', expires_in: ytExpire ? 60 : 3600 });
        case '/yt-api/youtube/v3/channels': return req.headers.authorization === 'Bearer BAD' ? J({}, 401)
          : J({ items: [{ id: 'UC1', snippet: { title: 'Zeynab Kora' }, statistics: { subscriberCount: '620', viewCount: '9400', videoCount: '9' } }] });
        default: return J({ error: 'inconnu' }, 404);
      }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { seen, base, close: () => srv.close(), setExpire: (v) => (ytExpire = v) };
}

async function setup() {
  const fp = await fakePlatforms();
  const s = await start({
    TIKTOK_CLIENT_KEY: 'tk', TIKTOK_CLIENT_SECRET: 'ts', TIKTOK_BASE: fp.base + '/tt', TIKTOK_AUTH_URL: 'https://tiktok.example/auth',
    INSTAGRAM_CLIENT_ID: 'ig', INSTAGRAM_CLIENT_SECRET: 'is', INSTAGRAM_BASE: fp.base + '/ig', INSTAGRAM_GRAPH: fp.base + '/ig', INSTAGRAM_AUTH_URL: 'https://ig.example/auth',
    YOUTUBE_CLIENT_ID: 'yk', YOUTUBE_CLIENT_SECRET: 'ys', YOUTUBE_BASE: fp.base + '/yt', YOUTUBE_API: fp.base + '/yt-api', YOUTUBE_AUTH_URL: 'https://google.example/auth',
  });
  const c = s.client();
  await c.post('/api/auth/register', { email: 'a@b.co', password: 'motdepasse1' });
  return { fp, s, c, done: async () => { await s.close(); fp.close(); } };
}

async function connect(c, p) {
  const r = await c.get(`/api/social/${p}/connect`);
  assert.equal(r.status, 200);
  const u = new URL(r.json.url);
  const cb = await c.get(`/oauth/callback/${p}?code=CODE123&state=${u.searchParams.get('state')}`);
  return { auth: u, cb };
}

test('/api/me annonce les réseaux configurés', async () => {
  const { s, c, done } = await setup();
  assert.deepEqual((await c.get('/api/me')).json.features.social.sort(), ['instagram', 'tiktok', 'youtube']);
  await done();
});

test('TikTok : URL d\'autorisation, échange de code côté serveur, jetons chiffrés, relevé', async () => {
  const { fp, s, c, done } = await setup();
  const { auth, cb } = await connect(c, 'tiktok');
  assert.equal(auth.origin + auth.pathname, 'https://tiktok.example/auth');
  assert.equal(auth.searchParams.get('client_key'), 'tk');
  assert.equal(auth.searchParams.get('response_type'), 'code');
  assert.equal(auth.searchParams.get('redirect_uri'), `${s.cfg.appUrl}/oauth/callback/tiktok`);
  assert.equal(cb.headers.get('location'), '/?social=ok&p=tiktok');
  const tok = fp.seen.find((x) => x.path === '/tt/v2/oauth/token/');
  assert.match(tok.body, /client_secret=ts/); assert.match(tok.body, /code=CODE123/);
  const row = s.db.prepare('SELECT * FROM social_accounts').get();
  assert.ok(!row.access_enc.includes('TT_ACCESS'));
  assert.equal(decrypt(row.access_enc, s.cfg.tokenKey), 'TT_ACCESS');
  assert.equal(decrypt(row.refresh_enc, s.cfg.tokenKey), 'TT_REFRESH');
  const soc = (await c.get('/api/social')).json.accounts.tiktok;
  assert.equal(soc.name, 'Zeynab TT');
  assert.deepEqual(soc.hist.map(({ f, v, l, p }) => ({ f, v, l, p })), [{ f: 3200, v: 1500, l: 4100, p: 24 }]);
  assert.ok(!JSON.stringify(soc).includes('TT_ACCESS')); // jamais de jeton vers le navigateur
  await done();
});

test('Instagram : jeton court → jeton longue durée, v et l restent null (saisie manuelle)', async () => {
  const { s, c, done } = await setup();
  const { cb } = await connect(c, 'instagram');
  assert.equal(cb.headers.get('location'), '/?social=ok&p=instagram');
  assert.equal(decrypt(s.db.prepare('SELECT access_enc a FROM social_accounts').get().a, s.cfg.tokenKey), 'IG_LONG');
  const h = (await c.get('/api/social')).json.accounts.instagram.hist[0];
  assert.deepEqual({ f: h.f, v: h.v, l: h.l, p: h.p }, { f: 1450, v: null, l: null, p: 31 });
  await done();
});

test('YouTube : PKCE S256 envoyé puis code_verifier correspondant', async () => {
  const { fp, c, done } = await setup();
  const { auth } = await connect(c, 'youtube');
  const challenge = auth.searchParams.get('code_challenge');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const tok = fp.seen.find((x) => x.path === '/yt/token');
  const verifier = new URLSearchParams(tok.body).get('code_verifier');
  assert.equal(pkceChallenge(verifier), challenge);
  assert.equal((await c.get('/api/social')).json.accounts.youtube.name, 'Zeynab Kora');
  await done();
});

test('state : inconnu, rejoué, ou d\'un autre utilisateur → refusé', async () => {
  const { s, c, done } = await setup();
  const r = await c.get('/api/social/tiktok/connect');
  const state = new URL(r.json.url).searchParams.get('state');
  assert.equal((await c.get('/oauth/callback/tiktok?code=X&state=faux')).headers.get('location'), '/?social=error&p=tiktok');
  const other = s.client();
  await other.post('/api/auth/register', { email: 'z@b.co', password: 'motdepasse1' });
  assert.equal((await other.get(`/oauth/callback/tiktok?code=X&state=${state}`)).headers.get('location'), '/?social=error&p=tiktok');
  // le state a été consommé même par la tentative refusée : impossible à rejouer
  assert.equal((await c.get(`/oauth/callback/tiktok?code=X&state=${state}`)).headers.get('location'), '/?social=error&p=tiktok');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM social_accounts').get().n, 0);
  assert.equal((await s.client().get('/oauth/callback/tiktok?code=X&state=' + state)).headers.get('location'), '/?social=error&p=tiktok');
  await done();
});

test('refus de l\'utilisateur sur la plateforme → ?social=denied', async () => {
  const { c, done } = await setup();
  const r = await c.get('/api/social/tiktok/connect');
  const state = new URL(r.json.url).searchParams.get('state');
  assert.equal((await c.get(`/oauth/callback/tiktok?error=access_denied&state=${state}`)).headers.get('location'), '/?social=denied&p=tiktok');
  await done();
});

test('réseau non configuré → 404 ; connexion requise', async () => {
  const s = await start();
  const c = s.client();
  assert.equal((await c.get('/api/social/tiktok/connect')).status, 401);
  await c.post('/api/auth/register', { email: 'a@b.co', password: 'motdepasse1' });
  assert.equal((await c.get('/api/social/tiktok/connect')).status, 404);
  assert.equal((await c.get('/api/social/inconnu/connect')).status, 404);
  await s.close();
});

test('relevé : une fois par heure, puis OK ; déconnexion supprime jetons et relevés', async () => {
  const { s, c, done } = await setup();
  await connect(c, 'youtube');
  assert.equal((await c.post('/api/social/youtube/sync')).status, 429);
  s.db.prepare('UPDATE social_accounts SET last_sync = ?').run(Date.now() - 2 * 3600000);
  const r = await c.post('/api/social/youtube/sync');
  assert.equal(r.status, 200);
  assert.equal(r.json.accounts.youtube.hist.length, 2);
  assert.equal((await c.del('/api/social/youtube')).status, 200);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM social_accounts').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM social_snapshots').get().n, 0);
  await done();
});

test('jeton qui expire bientôt → renouvelé avant le relevé ; jeton refusé → connexion_expiree', async () => {
  const { fp, s, c, done } = await setup();
  await connect(c, 'youtube');
  s.db.prepare('UPDATE social_accounts SET last_sync = 0, expires_at = ?').run(Date.now() + 1000);
  assert.equal((await c.post('/api/social/youtube/sync')).status, 200);
  assert.ok(fp.seen.some((x) => x.path === '/yt/token' && /grant_type=refresh_token/.test(x.body)));
  // jeton révoqué côté Google
  const { encrypt } = require('../server/crypto');
  s.db.prepare('UPDATE social_accounts SET last_sync = 0, expires_at = NULL, access_enc = ?').run(encrypt('BAD', s.cfg.tokenKey));
  const r = await c.post('/api/social/youtube/sync');
  assert.equal(r.status, 502); assert.equal(r.json.error, 'connexion_expiree');
  assert.equal((await c.get('/api/social')).json.accounts.youtube.status, 'expired');
  await done();
});
