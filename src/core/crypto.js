// @ts-check
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from './config.js';

// ---------- master key (secrets at rest) ----------
let masterKey = null;
function getMasterKey() {
  if (masterKey) return masterKey;
  if (process.env.MASTER_KEY) {
    masterKey = Buffer.from(process.env.MASTER_KEY, 'base64');
    if (masterKey.length !== 32) throw new Error('MASTER_KEY must be 32 bytes, base64-encoded');
    return masterKey;
  }
  const file = resolve(DATA_DIR, 'master.key');
  try { writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  masterKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  return masterKey;
}

/** AES-256-GCM. Output: v1:<iv b64>:<tag b64>:<ciphertext b64> */
export function encrypt(plaintext, key = getMasterKey()) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
export function decrypt(blob, key = getMasterKey()) {
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

/** Key from a passphrase (backups). */
export const keyFromPassphrase = (pass, salt) => scryptSync(String(pass), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

// ---------- passwords ----------
export function hashPassword(pw, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(pw), salt, 32).toString('hex') };
}
export function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const a = Buffer.from(hashPassword(pw, salt).hash, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- tokens ----------
export const newToken = (bytes = 32) => randomBytes(bytes).toString('hex');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function humanCode(len = 10) {
  const b = randomBytes(len);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}
