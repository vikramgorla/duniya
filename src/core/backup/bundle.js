// @ts-check
// Backup file (070): a consistent snapshot of the database plus the master key and WhatsApp sessions, streamed from
// disk through gzip and passphrase encryption (scrypt + AES-256-GCM) into the backup file, so a backup never holds
// the database in memory. Layout: MAGIC · header line (kdf, salt, iv) · ciphertext · 16-byte GCM tag.
// Plaintext (before gzip): a meta line (JSON), then per file a line {"n": name, "s": size} followed by its bytes.
import { createReadStream, createWriteStream, existsSync, readdirSync, rmSync, mkdirSync, statSync, openSync, readSync, closeSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { tmpdir } from 'node:os';
import { DATA_DIR, fail } from '../config.js';
import { db } from '../db.js';
import { keyFromPassphrase } from '../crypto.js';

export const MAGIC = 'DUNIYA2\n';
const OLD_MAGIC = 'DUNIYA1\n';
const FORMAT = 'duniya-backup';
const KDF = { kdf: 'scrypt', N: 32768, r: 8, p: 1 };
const TAG = 16;

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [relative(base, p)];
  });
}

/** The files of a backup as [name, path or Buffer]: a snapshot of the database, the master key, WhatsApp sessions. */
function sources(includeWhatsApp, snapshot) {
  /** @type {[string, string | Buffer][]} */
  const out = [['duniya.sqlite', snapshot]];
  const keyFile = resolve(DATA_DIR, 'master.key');
  if (existsSync(keyFile)) out.push(['master.key', keyFile]);
  else if (process.env.MASTER_KEY) out.push(['master.key', Buffer.from(process.env.MASTER_KEY)]);
  if (includeWhatsApp) {
    // every linked number: whatsapp-auth (main) and whatsapp-auth-<id> (more numbers)
    for (const dir of readdirSync(DATA_DIR).filter((n) => n === 'whatsapp-auth' || n.startsWith('whatsapp-auth-'))) {
      for (const rel of walk(resolve(DATA_DIR, dir))) out.push([`${dir}/${rel}`, resolve(DATA_DIR, dir, rel)]);
    }
  }
  return out;
}

async function* plaintext(meta, files) {
  yield Buffer.from(`${JSON.stringify(meta)}\n`);
  for (const [name, src] of files) {
    const size = Buffer.isBuffer(src) ? src.length : statSync(src).size;
    yield Buffer.from(`${JSON.stringify({ n: name, s: size })}\n`);
    if (Buffer.isBuffer(src)) { yield src; continue; }
    let left = size; // a file that grows while we read (a WhatsApp key) is cut at its size above
    for await (const chunk of createReadStream(src)) {
      const part = chunk.length > left ? chunk.subarray(0, left) : chunk;
      left -= part.length; yield part;
      if (!left) break;
    }
    if (left) yield Buffer.alloc(left); // shrank meanwhile: keep the record length
  }
}

/**
 * Write an encrypted backup to `file` (via a .part file). Returns { size, files }.
 * Memory stays flat: the database snapshot is a temporary file that is streamed, never loaded.
 */
export async function writeBackup(file, passphrase, { includeWhatsApp = true, appVersion = '' } = {}) {
  const snap = resolve(tmpdir(), `duniya-snap-${process.pid}-${Date.now()}.sqlite`);
  const part = `${file}.part`;
  try {
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    const files = sources(includeWhatsApp, snap);
    const salt = randomBytes(16); const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyFromPassphrase(passphrase, salt), iv);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const out = createWriteStream(part, { mode: 0o600 });
    out.write(`${MAGIC}${JSON.stringify({ ...KDF, salt: salt.toString('base64'), iv: iv.toString('base64') })}\n`);
    const meta = { format: FORMAT, version: 3, createdAt: new Date().toISOString(), app: { version: appVersion } };
    await pipeline(Readable.from(plaintext(meta, files)), createGzip(), cipher, out, { end: false });
    await new Promise((ok, ko) => out.end(cipher.getAuthTag(), (/** @type {any} */ e) => (e ? ko(e) : ok(null))));
    renameSync(part, file);
    return { size: statSync(file).size, files: files.length };
  } finally {
    rmSync(snap, { force: true }); rmSync(part, { force: true });
  }
}

/** Header, tag and a stream of the ciphertext of a backup given as a path or a Buffer. */
function openSource(src) {
  const isBuf = Buffer.isBuffer(src);
  const size = isBuf ? src.length : statSync(src).size;
  const read = (pos, len) => {
    if (isBuf) return src.subarray(pos, pos + len);
    const b = Buffer.alloc(Math.max(0, Math.min(len, size - pos))); const fd = openSync(src, 'r');
    try { readSync(fd, b, 0, b.length, pos); } finally { closeSync(fd); }
    return b;
  };
  const head = read(0, 4096);
  if (head.subarray(0, OLD_MAGIC.length).toString() === OLD_MAGIC) {
    throw fail('This backup was made by Duniya 2.30 or earlier and cannot be restored by this version. Make a new backup (Backups → Back up now) and restore that one.');
  }
  if (head.subarray(0, MAGIC.length).toString() !== MAGIC) throw fail('Not a duniya backup file');
  const nl = head.indexOf(0x0a, MAGIC.length);
  if (nl < 0 || size < nl + 1 + TAG) throw fail('The backup file is damaged (too short)');
  const h = JSON.parse(head.subarray(MAGIC.length, nl).toString());
  const start = nl + 1; const end = size - TAG; // ciphertext is [start, end)
  const tag = read(end, TAG);
  const stream = isBuf ? Readable.from([src.subarray(start, end)]) : createReadStream(src, { start, end: end - 1 });
  return { h, tag, stream: end > start ? stream : Readable.from([]) };
}

/** Parses the plaintext records; onFile(name) returns a sink { write(buf), end() } or null to skip. */
function recordReader(onMeta, onFile) {
  let buf = Buffer.alloc(0); let meta = null; let cur = null; let left = 0;
  return new Writable({
    async write(chunk, _enc, done) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        while (buf.length) {
          if (cur) {
            const part = buf.subarray(0, Math.min(left, buf.length));
            const sink = cur.sink; left -= part.length; buf = buf.subarray(part.length);
            if (!left) { cur = null; sink?.end(part); continue; }
            // respect the disk's pace: never queue a whole database in memory
            if (sink && !sink.write(part)) await new Promise((ok) => sink.once('drain', ok));
            continue;
          }
          const nl = buf.indexOf(0x0a);
          if (nl < 0) { if (buf.length > 65536) throw fail('The backup file is damaged'); break; }
          const line = JSON.parse(buf.subarray(0, nl).toString()); buf = buf.subarray(nl + 1);
          if (!meta) { meta = line; onMeta(meta); continue; }
          cur = { sink: onFile(String(line.n)) }; left = Number(line.s) || 0;
          if (!left) { cur.sink?.end(); cur = null; }
        }
        if (!buf.length) buf = Buffer.alloc(0);
        done();
      } catch (e) { done(e); }
    },
    final(done) { done(cur || !meta ? fail('The backup file is damaged (it ends early)') : null); },
  });
}

/**
 * Decrypt a backup (path or Buffer) and read its records. With `stage`, files are written into that folder.
 * Returns { createdAt, files: [names] }. Wrong passphrase or damage → a plain error; nothing counts until the GCM tag
 * checked out (the caller writes the restore manifest only after this returns).
 */
async function readBackup(src, passphrase, stage = '') {
  const { h, tag, stream } = openSource(src);
  const d = createDecipheriv('aes-256-gcm', keyFromPassphrase(passphrase, Buffer.from(h.salt, 'base64')), Buffer.from(h.iv, 'base64'));
  d.setAuthTag(tag);
  const names = []; let meta = null; const sinks = [];
  const reader = recordReader((m) => {
    meta = m;
    if (m.format !== FORMAT) throw fail('Unsupported backup format');
  }, (rel) => {
    if (rel.startsWith('/') || rel.split('/').includes('..')) return null;
    names.push(rel);
    if (!stage) return null;
    const dst = resolve(stage, rel);
    mkdirSync(dirname(dst), { recursive: true });
    const ws = createWriteStream(dst, { mode: 0o600 });
    sinks.push(new Promise((ok, ko) => { ws.on('finish', ok); ws.on('error', ko); }));
    return ws;
  });
  try {
    await pipeline(stream, d, createGunzip(), reader);
    await Promise.all(sinks);
  } catch (e) {
    if (e.status) throw e;
    throw fail('Wrong passphrase (or the file is damaged)');
  }
  if (!names.includes('duniya.sqlite')) throw fail('Backup has no database');
  return { createdAt: meta?.createdAt, files: names };
}

/** Check that a backup opens with the passphrase (restore preview). */
export const checkBackup = (src, passphrase) => readBackup(src, passphrase);

/** Decrypt into DATA_DIR/restore-pending; applied on next start (restore-apply.js). Returns the file names. */
export async function stageRestore(src, passphrase, source = '', dataDir = DATA_DIR) {
  const stage = resolve(dataDir, 'restore-pending');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  let r;
  try { r = await readBackup(src, passphrase, stage); } catch (e) { rmSync(stage, { recursive: true, force: true }); throw e; }
  writeFileSync(resolve(stage, 'manifest.json'), JSON.stringify({ source, createdAt: r.createdAt, files: r.files }));
  return r;
}
