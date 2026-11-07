'use strict';
/* Trois adaptateurs, une seule interface : complete({system, user}) → texte.
   Formats d'après les documentations officielles ; les noms de modèles sont réglables par variable d'environnement. */

async function postJson(url, headers, body, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
    return JSON.parse(txt);
  } finally { clearTimeout(timer); }
}

function makeProvider(name, p, timeoutMs) {
  switch (name) {
    case 'claude':
      return async ({ system, user }) => {
        const j = await postJson(`${p.base}/v1/messages`, { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
          { model: p.model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }, timeoutMs);
        return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      };
    case 'gemini':
      return async ({ system, user }) => {
        const j = await postJson(`${p.base}/v1beta/models/${encodeURIComponent(p.model)}:generateContent`, { 'x-goog-api-key': p.key },
          { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1500 } }, timeoutMs);
        return (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
      };
    case 'grok':
      return async ({ system, user }) => {
        const j = await postJson(`${p.base}/v1/chat/completions`, { authorization: `Bearer ${p.key}` },
          { model: p.model, max_tokens: 1500, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, timeoutMs);
        return j.choices?.[0]?.message?.content || '';
      };
    default:
      throw new Error('fournisseur inconnu : ' + name);
  }
}

/* Registre : { names(), complete(name, req) }. Les tests le remplacent par un faux. */
function buildRegistry(cfg) {
  const impls = {};
  for (const [name, p] of Object.entries(cfg.ai.providers)) if (p.key) impls[name] = makeProvider(name, p, cfg.ai.timeoutMs);
  return {
    names: () => Object.keys(impls),
    complete: (name, req) => { if (!impls[name]) throw new Error('fournisseur non configuré : ' + name); return impls[name](req); },
  };
}

module.exports = { buildRegistry, makeProvider };
