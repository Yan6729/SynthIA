'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const head = html.slice(html.indexOf('window.LANGS='), html.indexOf('window.__loc=') + 'window.__loc=window.LOCALES[window.__lang]||\'fr-FR\';'.length);

/* Exécute le script de tête avec un navigateur factice : langue choisie, dictionnaire éventuel. */
function boot({ stored = null, nav = 'fr-FR', dict = null } = {}) {
  const written = [];
  const ctx = { navigator: { language: nav, languages: [nav] }, localStorage: { getItem: () => stored }, document: { documentElement: { setAttribute: (k, v) => { ctx.attr = [k, v]; } }, write: (s) => written.push(s) } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(head.replace('window.__L=null;', 'window.__L=null;' + (dict ? 'window.__L=' + JSON.stringify(dict) + ';' : '')), ctx);
  return { ctx, written, t: ctx.t };
}

test('langue : choix mémorisé, sinon langue du navigateur si livrée, sinon français', () => {
  assert.equal(boot({ stored: 'en' }).ctx.__lang, 'en');
  assert.equal(boot({ stored: 'xx', nav: 'pt-BR' }).ctx.__lang, 'pt');   // valeur piégée ignorée, navigateur utilisé
  assert.equal(boot({ nav: 'ja-JP' }).ctx.__lang, 'fr');                 // langue non livrée → français
  assert.equal(boot({ stored: '"><script>' }).ctx.__lang, 'fr');
  const b = boot({ stored: 'es' });
  assert.deepEqual(b.ctx.attr, ['lang', 'es']);
  assert.match(b.written[0], /^<script src="i18n\/es\.js"><\/script>$/);
  assert.equal(boot({ stored: 'fr' }).written.length, 0);                // le français n'a pas de dictionnaire
  assert.equal(boot({ stored: 'fon' }).ctx.__loc, 'fr-FR');
  assert.equal(boot({ stored: 'en' }).ctx.__loc, 'en-US');
});

test('t : traduction exacte, repli sur le français, phrases à trous', () => {
  const { t } = boot({ stored: 'en', dict: { 'Mes plans': 'My plans', 'Bonjour {0}, bienvenue sur {1}': 'Hello {0}, welcome to {1}', 'Semaine {0}': 'Week {0}' } });
  assert.equal(t('Mes plans'), 'My plans');
  assert.equal(t('Texte inconnu'), 'Texte inconnu');                     // jamais de clé vide ni de crash
  assert.equal(t('Bonjour {0}, bienvenue sur {1}', 'Zeynab', 'Synthia'), 'Hello Zeynab, welcome to Synthia');
  assert.equal(t('Inconnu {0}', 5), 'Inconnu 5');
  assert.equal(t('Semaine {0}', 3), 'Week 3');
  assert.equal(t(undefined), undefined);
  assert.equal(t(42), 42);
});

test('t : une phrase déjà assemblée (plan stocké en français) est traduite grâce aux clés à trous', () => {
  const { t } = boot({ stored: 'en', dict: {
    'Ton projet est un {0} : montrer plusieurs titres donne des raisons de revenir.': 'Your project is a {0}: showing several tracks gives people reasons to come back.',
    'Un échange de visibilité avec un créateur de {0} te fait découvrir à son public gratuitement.': 'A visibility swap with a creator from {0} introduces you to their audience for free.',
    'Coupé-décalé': 'Coupé-décalé (en)', 'Album': 'Album',
    'Écoutes de « {0} » et {1}': '{1} and listens of “{0}”',
  } });
  assert.equal(t('Ton projet est un Album : montrer plusieurs titres donne des raisons de revenir.'), 'Your project is a Album: showing several tracks gives people reasons to come back.');
  assert.equal(t('Un échange de visibilité avec un créateur de Cotonou te fait découvrir à son public gratuitement.'), 'A visibility swap with a creator from Cotonou introduces you to their audience for free.');
  assert.equal(t('Écoutes de « Mon titre » et Coupé-décalé'), 'Coupé-décalé (en) and listens of “Mon titre”'); // les valeurs insérées sont elles-mêmes traduites
  assert.equal(t('Phrase sans modèle'), 'Phrase sans modèle');
});

test('t : caractères spéciaux dans les clés, retours à la ligne, pas de capture gloutonne', () => {
  const { t } = boot({ stored: 'en', dict: { 'Prix ($) : {0} + (taxes) [a.b]': 'Price ($): {0} + (tax) [a.b]', 'Lundi {0}': 'Monday {0}' } });
  assert.equal(t('Prix ($) : 9 + (taxes) [a.b]'), 'Price ($): 9 + (tax) [a.b]');
  assert.equal(t('Prix ($) : x + (taxes) [axb]'), 'Prix ($) : x + (taxes) [axb]');   // le point est littéral
  assert.equal(t('Lundi a\nb'), 'Monday a\nb');
});
