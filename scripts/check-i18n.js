'use strict';
/* Contrôle des dictionnaires de langue (public/i18n/<code>.js).
   - mêmes clés dans toutes les langues, marqueurs {0}, {1}… identiques à la clé française ;
   - aucune clé morte (absente de tous les appels _t("…") du front) en avertissement ;
   - chaque texte _t("…") du front a sa traduction (sinon avertissement : il restera en français).
   Utilisation : node scripts/check-i18n.js        (code de sortie 1 en cas d'erreur) */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '../public/i18n');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const ph = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join(',');

const langs = {};
for (const f of fs.readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/.test(x))) {
  const ctx = { window: {} }; ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
  langs[f.slice(0, -3)] = ctx.__L;
}

const IGNORE = new Set(['Texte français']); // exemple dans un commentaire
let errors = 0, warns = 0;
const all = new Set(Object.values(langs).flatMap((d) => Object.keys(d)));

const used = new Set();
const re = /\b_ts?\(\s*(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
let m;
while ((m = re.exec(html))) {
  try { used.add(JSON.parse('"' + m[2].replace(/\\'/g, "'").replace(/"/g, '\\"') + '"')); } catch (e) { used.add(m[2]); }
}

for (const [code, d] of Object.entries(langs)) {
  const keys = Object.keys(d);
  const missing = [...all].filter((k) => !(k in d));
  const empty = keys.filter((k) => !String(d[k]).trim());
  const badPh = keys.filter((k) => ph(k) !== ph(d[k]));
  const uncovered = [...used].filter((k) => !(k in d) && !IGNORE.has(k));
  console.log(`${code}: ${keys.length} textes, ${missing.length} manquants, ${badPh.length} marqueurs différents, ${uncovered.length} appels du front sans traduction`);
  missing.forEach((k) => { console.error(`  [${code}] manquant : ${k}`); errors++; });
  empty.forEach((k) => { console.error(`  [${code}] vide : ${k}`); errors++; });
  badPh.forEach((k) => { console.error(`  [${code}] marqueurs : ${k} → ${d[k]}`); errors++; });
  uncovered.slice(0, 20).forEach((k) => { console.warn(`  [${code}] reste en français : ${k}`); warns++; });
}
const dead = [...all].filter((k) => !used.has(k)).length;
console.log(`${used.size} textes littéraux dans le front ; ${dead} clés de dictionnaire viennent du moteur de plan ou d'assemblages (normal).`);
process.exit(errors ? 1 : 0);
