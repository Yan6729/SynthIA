'use strict';
const { loadConfig } = require('../server/config');
const { openDb } = require('../server/db');
const { buildDeps } = require('../server/deps');
const { createApp } = require('../server/app');
const crypto = require('crypto');

/* Lance une vraie appli sur un port libre, base en mémoire, avec un client HTTP qui garde le cookie. */
async function start(envExtra = {}, overrides = {}) {
  const env = {
    NODE_ENV: 'test', APP_URL: 'http://localhost', PAY_MODE: 'simulate',
    TOKEN_KEY: crypto.randomBytes(32).toString('base64'), ...envExtra,
  };
  const cfg = loadConfig(env);
  const db = openDb(':memory:');
  const deps = buildDeps(cfg, { db, ...overrides });
  const app = createApp(deps);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  cfg.appUrl = base; // pour Origin et les redirections
  return { base, cfg, db, deps, close: () => new Promise((r) => server.close(r)), client: () => client(base) };
}

function client(base) {
  let cookie = '';
  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.getSetCookie?.() || [];
    for (const c of sc) { const kv = c.split(';')[0]; if (kv.endsWith('=') ) cookie = ''; else cookie = kv; }
    let json = null; const txt = await res.text();
    try { json = JSON.parse(txt); } catch (e) { /* pas du JSON */ }
    return { status: res.status, json, text: txt, headers: res.headers };
  }
  return { get: (u, h) => call('GET', u, undefined, h), post: (u, b, h) => call('POST', u, b ?? {}, h), put: (u, b, h) => call('PUT', u, b ?? {}, h), del: (u) => call('DELETE', u), raw: call, get cookie() { return cookie; } };
}

module.exports = { start };
