// @ts-check
// Applies a staged restore (007) before the database is opened. No imports from the app on purpose.
//
// It must never keep the app from starting, and a start that died in the middle must carry on where it stopped. So the
// work has two phases, recorded in the manifest (which is always written whole, through a rename):
//   aside   the current data moves into pre-restore-<time>/ (everything still in the data folder is the old data)
//   place   the restored files move from restore-pending/ into the data folder
// Run again after a crash, a phase skips what it already moved; without the phases a second run moved the freshly
// restored database aside, or failed on a file that was no longer staged, at every start.
// A manifest that cannot be read is dropped and the app starts with the data it has. What happened is left in
// restore-result.json for the app to record once it runs (takeRestoreResult).
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const STAGE = 'restore-pending';
const RESULT = 'restore-result.json';
const KEEP_RE = /^pre-restore-\d+$/;
const KEPT_FOLDERS = 3; // pre-restore folders kept, newest first
const DATABASE = ['duniya.sqlite', 'duniya.sqlite-wal', 'duniya.sqlite-shm', 'master.key'];
const isSession = (name) => name === 'whatsapp-auth' || name.startsWith('whatsapp-auth-');

/** Write JSON whole or not at all (a file cut short by a crash is never read back). */
export function writeWhole(file, value) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
}

function readManifest(file) {
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(m?.files) || !m.files.every((f) => typeof f === 'string')) throw new Error('it has no list of files');
  if (m.keep && !KEEP_RE.test(m.keep)) throw new Error('its folder for the previous data has an unexpected name');
  return m;
}

/** Phase "aside": what is in the data folder now is the old data. */
function moveAside(dataDir, keep) {
  mkdirSync(keep, { recursive: true });
  for (const name of [...DATABASE, ...readdirSync(dataDir).filter(isSession)]) {
    const from = resolve(dataDir, name);
    if (existsSync(from)) renameSync(from, resolve(keep, name));
  }
}

/** Phase "place": staged files that are still staged go into the data folder. */
function place(dataDir, stage, files) {
  for (const rel of files) {
    const from = resolve(stage, rel);
    const to = resolve(dataDir, rel);
    if (!to.startsWith(`${resolve(dataDir)}/`) || !existsSync(from)) continue; // never outside the data folder; already placed
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
}

const pruneKept = (dataDir) => {
  for (const n of readdirSync(dataDir).filter((x) => KEEP_RE.test(x)).sort().reverse().slice(KEPT_FOLDERS)) rmSync(resolve(dataDir, n), { recursive: true, force: true });
};

export function applyPendingRestore(dataDir) {
  const stage = resolve(dataDir, STAGE);
  const manifestFile = resolve(stage, 'manifest.json');
  if (!existsSync(manifestFile)) return null;
  let manifest;
  try { manifest = readManifest(manifestFile); } catch (e) {
    rmSync(stage, { recursive: true, force: true });
    console.error(`A staged restore could not be read (${e.message}); it was dropped and nothing changed.`);
    writeWhole(resolve(dataDir, RESULT), { ok: false, at: Date.now(), error: e.message });
    return null;
  }
  if (manifest.phase !== 'place') {
    manifest.keep ||= `pre-restore-${Date.now()}`;
    manifest.phase = 'aside';
    writeWhole(manifestFile, manifest);
    moveAside(dataDir, resolve(dataDir, manifest.keep));
    manifest.phase = 'place';
    writeWhole(manifestFile, manifest);
  }
  place(dataDir, stage, manifest.files);
  rmSync(stage, { recursive: true, force: true });
  pruneKept(dataDir);
  console.log(`Restored backup ${manifest.source || ''} (${manifest.files.length} files); previous data kept in ${manifest.keep}`);
  writeWhole(resolve(dataDir, RESULT), { ok: true, at: Date.now(), source: manifest.source || '', files: manifest.files.length, keep: manifest.keep });
  return manifest;
}

/** What the last restore at start did ({ ok, source, files, keep } or { ok: false, error }), once; null when none. */
export function takeRestoreResult(dataDir) {
  const file = resolve(dataDir, RESULT);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } finally { rmSync(file, { force: true }); }
}
