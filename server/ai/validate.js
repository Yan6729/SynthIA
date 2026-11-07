'use strict';
/* La sortie d'un modèle n'est jamais crue sur parole. */

function extractJson(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch (e) { /* on tente de retrouver un bloc JSON dans le texte */ }
  const m = t.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* abandon */ } }
  return null;
}

/* Texte affichable : sans balise, sans espaces superflus, borné. */
function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function validatePlan(raw, knownIds) {
  const j = extractJson(raw);
  if (!Array.isArray(j)) return [];
  const known = new Set(knownIds.map(String));
  const seen = new Set();
  const out = [];
  for (const e of j) {
    if (!e || typeof e !== 'object') continue;
    const id = e.id;
    if ((typeof id !== 'number' && typeof id !== 'string') || !known.has(String(id)) || seen.has(String(id))) continue;
    const text = cleanText(e.text, 600);
    if (!text) continue;
    seen.add(String(id));
    out.push({ id, text });
  }
  return out;
}

function validateAdvice(raw) {
  const j = extractJson(raw);
  const arr = Array.isArray(j) ? j : Array.isArray(j?.tips) ? j.tips : [];
  return arr.map((t) => cleanText(t, 400)).filter(Boolean).slice(0, 5);
}

module.exports = { extractJson, cleanText, validatePlan, validateAdvice };
