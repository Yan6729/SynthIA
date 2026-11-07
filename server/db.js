'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE,
     pass_hash TEXT NOT NULL,
     premium_until INTEGER NOT NULL DEFAULT 0,
     ai_provider TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE user_state (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     key TEXT NOT NULL,
     json TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, key)
   );`,
  `CREATE TABLE ai_usage (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   );`,
  `CREATE TABLE payments (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     offer TEXT NOT NULL,
     amount INTEGER NOT NULL,
     provider TEXT NOT NULL,
     provider_tx TEXT,
     status TEXT NOT NULL DEFAULT 'pending',
     created_at INTEGER NOT NULL,
     paid_at INTEGER
   );
   CREATE UNIQUE INDEX payments_tx ON payments(provider, provider_tx) WHERE provider_tx IS NOT NULL;`,
  `CREATE TABLE social_accounts (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     platform TEXT NOT NULL,
     ext_id TEXT,
     name TEXT,
     access_enc TEXT,
     refresh_enc TEXT,
     expires_at INTEGER,
     status TEXT NOT NULL DEFAULT 'ok',
     last_sync INTEGER,
     PRIMARY KEY (user_id, platform)
   );
   CREATE TABLE social_snapshots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     platform TEXT NOT NULL,
     taken_at INTEGER NOT NULL,
     f INTEGER, v INTEGER, l INTEGER, p INTEGER
   );
   CREATE INDEX snaps_user ON social_snapshots(user_id, platform, taken_at);
   CREATE TABLE oauth_states (
     state TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     platform TEXT NOT NULL,
     verifier TEXT,
     expires_at INTEGER NOT NULL
   );`,
];

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  const cur = db.pragma('user_version', { simple: true });
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

module.exports = { openDb, MIGRATIONS };
