'use strict';
const crypto = require('crypto');

const b64u = (b) => Buffer.from(b).toString('base64url');
const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* Mots de passe : scrypt + sel, format "scrypt$N$sel$hash" */
const SCRYPT_N = 16384;
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = parseInt(parts[1], 10), salt = Buffer.from(parts[2], 'base64'), want = Buffer.from(parts[3], 'base64');
  const got = crypto.scryptSync(pw, salt, want.length, { N });
  return crypto.timingSafeEqual(got, want);
}
/* Faux calcul quand l'e-mail n'existe pas : même durée, pas d'indice. */
const DUMMY = hashPassword('dummy-password-not-used');
const burnPassword = (pw) => { verifyPassword(pw, DUMMY); };

/* Chiffrement des jetons réseaux : AES-256-GCM, format "v1.iv.tag.data" (base64url) */
function keyFrom(b64) {
  const k = Buffer.from(b64 || '', 'base64');
  if (k.length !== 32) throw new Error('TOKEN_KEY invalide (32 octets base64 attendus)');
  return k;
}
function encrypt(plain, keyB64) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(keyB64), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', b64u(iv), b64u(c.getAuthTag()), b64u(data)].join('.');
}
function decrypt(blob, keyB64) {
  const [v, iv, tag, data] = String(blob).split('.');
  if (v !== 'v1') throw new Error('format de jeton inconnu');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(keyB64), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

const pkceChallenge = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

module.exports = { randomToken, sha256, hashPassword, verifyPassword, burnPassword, encrypt, decrypt, pkceChallenge };
