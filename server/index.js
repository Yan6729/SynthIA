'use strict';
const fs = require('fs');
const path = require('path');

// .env minimal (sans dépendance) : les variables déjà définies gagnent.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const { loadConfig, validateConfig } = require('./config');
const { buildDeps } = require('./deps');
const { createApp } = require('./app');

const cfg = loadConfig();
const errs = validateConfig(cfg);
if (errs.length) { console.error('Configuration invalide :\n - ' + errs.join('\n - ')); process.exit(1); }

const app = createApp(buildDeps(cfg));
app.listen(cfg.port, () => console.log(`Synthia sur ${cfg.appUrl} (port ${cfg.port}, paiement : ${cfg.pay.mode})`));
