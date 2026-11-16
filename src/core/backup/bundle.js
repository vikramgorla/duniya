// Backup bundle: consistent snapshot → gzip JSON → passphrase encryption (scrypt + AES-256-GCM).
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { tmpdir } from 'node:os';
import { DATA_DIR } from '../config.js';
import { db } from '../db.js';
import { keyFromPassphrase } from '../crypto.js';

const MAGIC = 'DUNIYA1\n';
// 2 = Duniya 2.0 data (bots renamed to agents, #7). Older bundles cannot be restored.
const BUNDLE_VERSION = 2;
const KDF = { kdf: 'scrypt', N: 32768, r: 8, p: 1 };

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [relative(base, p)];
  });
}

export function createBundle({ includeWhatsApp = true, appVersion = '' } = {}) {
  const tmp = resolve(tmpdir(), `duniya-snap-${process.pid}-${Date.now()}.sqlite`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const files = { 'duniya.sqlite': readFileSync(tmp).toString('base64') };
  rmSync(tmp, { force: true });
  const keyFile = resolve(DATA_DIR, 'master.key');
  if (existsSync(keyFile)) files['master.key'] = readFileSync(keyFile).toString('base64');
  else if (process.env.MASTER_KEY) files['master.key'] = Buffer.from(process.env.MASTER_KEY).toString('base64');
  if (includeWhatsApp) {
    // every linked number: whatsapp-auth (main) and whatsapp-auth-<id> (more numbers)
    for (const dir of readdirSync(DATA_DIR).filter((n) => n === 'whatsapp-auth' || n.startsWith('whatsapp-auth-'))) {
      const auth = resolve(DATA_DIR, dir);
      for (const rel of walk(auth)) files[`${dir}/${rel}`] = readFileSync(resolve(auth, rel)).toString('base64');
    }
  }
  return { format: 'duniya-backup', version: BUNDLE_VERSION, createdAt: new Date().toISOString(), app: { version: appVersion }, files };
}

export function encryptBundle(bundle, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = keyFromPassphrase(passphrase, salt);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(bundle)))), c.final()]);
  const header = JSON.stringify({ ...KDF, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') });
  return Buffer.concat([Buffer.from(MAGIC), Buffer.from(`${header}\n`), ct]);
}

export function decryptBundle(buf, passphrase) {
  if (buf.subarray(0, MAGIC.length).toString() !== MAGIC) throw Object.assign(new Error('Not a duniya backup file'), { status: 400 });
  const nl = buf.indexOf(0x0a, MAGIC.length);
  const h = JSON.parse(buf.subarray(MAGIC.length, nl).toString());
  const key = keyFromPassphrase(passphrase, Buffer.from(h.salt, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(h.iv, 'base64'));
  d.setAuthTag(Buffer.from(h.tag, 'base64'));
  let plain;
  try { plain = Buffer.concat([d.update(buf.subarray(nl + 1)), d.final()]); } catch {
    throw Object.assign(new Error('Wrong passphrase (or the file is damaged)'), { status: 400 });
  }
  const bundle = JSON.parse(gunzipSync(plain).toString());
  if (bundle.format !== 'duniya-backup') throw Object.assign(new Error('Unsupported backup format'), { status: 400 });
  if (!(bundle.version >= BUNDLE_VERSION)) {
    throw Object.assign(new Error(`This backup was made by an old Duniya${bundle.app?.version ? ` (${bundle.app.version})` : ''} and cannot be restored into Duniya 2.`), { status: 400 });
  }
  return bundle;
}

/** Write the bundle's files to DATA_DIR/restore-pending; applied on next start (restore-apply.js). */
export function stageRestore(bundle, source = '', dataDir = DATA_DIR) {
  const stage = resolve(dataDir, 'restore-pending');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  const names = [];
  for (const [rel, b64] of Object.entries(bundle.files)) {
    if (rel.startsWith('/') || rel.split('/').includes('..')) continue;
    const dst = resolve(stage, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, Buffer.from(b64, 'base64'), { mode: 0o600 });
    names.push(rel);
  }
  if (!names.includes('duniya.sqlite')) throw Object.assign(new Error('Backup has no database'), { status: 400 });
  writeFileSync(resolve(stage, 'manifest.json'), JSON.stringify({ source, createdAt: bundle.createdAt, files: names }));
  return names;
}

