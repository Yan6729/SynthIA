'use strict';
/* Sauvegarde à chaud de la base SQLite (API de sauvegarde de better-sqlite3, sans arrêter le serveur).
   Usage : node scripts/backup.js [dossier]   (défaut : <dossier de la base>/backups)  — garde les 14 dernières. */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { loadConfig } = require('../server/config');

(async () => {
  const cfg = loadConfig();
  if (!fs.existsSync(cfg.dbPath)) { console.error('Base introuvable : ' + cfg.dbPath); process.exit(1); }
  const dir = process.argv[2] || path.join(path.dirname(cfg.dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const out = path.join(dir, `manager-${stamp}.db`);
  const db = new Database(cfg.dbPath, { readonly: true });
  await db.backup(out);
  db.close();
  const all = fs.readdirSync(dir).filter((f) => /^manager-.*\.db$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(dir, f));
  console.log('Sauvegarde : ' + out);
})().catch((e) => { console.error('Échec de la sauvegarde :', e.message); process.exit(1); });
