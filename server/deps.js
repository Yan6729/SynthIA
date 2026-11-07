'use strict';
const { openDb } = require('./db');

/* Assemble les dépendances réelles. Les modules ajoutés plus tard (auth, état, IA, paiement, réseaux) s'enregistrent ici. */
function buildDeps(cfg, overrides = {}) {
  const db = overrides.db || openDb(cfg.dbPath);
  const deps = { cfg, db, routes: [], rawMounts: [] };
  require('./modules').forEach((m) => m(deps, overrides));
  return deps;
}

module.exports = { buildDeps };
