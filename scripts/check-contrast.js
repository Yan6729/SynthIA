'use strict';
/* Vérifie les contrastes WCAG des paires de couleurs du thème (DESIGN-SYNTHIA.md, section 3). Usage : node scripts/check-contrast.js */
const L = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const T = {
  clair: { bg: '#F3FAF9', card: '#FFFFFF', tx: '#0B2220', mut: '#4B6B68', pt: '#0F766E', ac: '#C2410C', ok: '#15803D', err: '#B91C1C', pri: '#0F766E', pri2: '#0D8077' },
  sombre: { bg: '#041A19', card: '#0A2B29', tx: '#EAFBF8', mut: '#93B8B3', pt: '#5EEAD4', ac: '#FFA45C', ok: '#4ADE80', err: '#F87171', pri: '#0F766E', pri2: '#0D8077' },
};
let bad = 0;
const chk = (name, fg, bg, min) => { const r = ratio(fg, bg); const ok = r >= min; if (!ok) bad++; console.log((ok ? 'ok  ' : 'ÉCHEC'), r.toFixed(2).padStart(5), `(min ${min})`, name); };
for (const [n, t] of Object.entries(T)) {
  for (const bg of ['bg', 'card']) for (const fg of ['tx', 'mut', 'pt', 'ac', 'ok', 'err']) chk(`${n} : ${fg} sur ${bg}`, t[fg], t[bg], 4.5);
  chk(`${n} : texte blanc sur bouton (pri)`, '#FFFFFF', t.pri, 4.5);
  chk(`${n} : texte blanc sur bouton (pri2)`, '#FFFFFF', t.pri2, 4.5);
}
chk('lime : texte foncé sur bouton lime', '#041A19', '#D8FF3E', 4.5);
chk('lime sur hero sombre', '#D8FF3E', '#0F3F3B', 4.5);
chk('blanc sur hero (côté clair du dégradé)', '#FFFFFF', '#0F3F3B', 4.5);
chk('bandeau hors ligne : blanc sur #9A3412', '#FFFFFF', '#9A3412', 4.5);
chk('toast : blanc sur #0B2220', '#FFFFFF', '#0B2220', 4.5);
process.exit(bad ? 1 : 0);
