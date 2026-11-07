'use strict';
/* Préparation commune aux scripts de lancement : vérifie Node, crée .env avec une TOKEN_KEY si absent. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) { console.error(`Node 22 ou plus est requis (version actuelle : ${process.versions.node}).`); process.exit(2); }

const root = path.join(__dirname, '..');
const env = path.join(root, '.env');
if (!fs.existsSync(env)) {
  const key = crypto.randomBytes(32).toString('base64');
  const txt = fs.readFileSync(path.join(root, '.env.example'), 'utf8').replace(/^TOKEN_KEY=.*$/m, `TOKEN_KEY=${key}`);
  fs.writeFileSync(env, txt);
  console.log('.env créé avec une TOKEN_KEY générée (paiement en simulation, IA et réseaux en démo tant que tu ne mets pas de clés).');
} else if (/^TOKEN_KEY=\s*$/m.test(fs.readFileSync(env, 'utf8'))) {
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^TOKEN_KEY=\s*$/m, `TOKEN_KEY=${key}`));
  console.log('TOKEN_KEY vide dans .env : une clé a été générée.');
}
