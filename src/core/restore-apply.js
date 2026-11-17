// @ts-check
// Applies a staged restore (007) before the database is opened. No imports from the app on purpose.
import { existsSync, readFileSync, mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function applyPendingRestore(dataDir) {
  const stage = resolve(dataDir, 'restore-pending');
  const manifestFile = resolve(stage, 'manifest.json');
  if (!existsSync(manifestFile)) return null;
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const keep = resolve(dataDir, `pre-restore-${Date.now()}`);
  mkdirSync(keep, { recursive: true });
  // Move current state aside
  const authDirs = readdirSync(dataDir).filter((n) => n === 'whatsapp-auth' || n.startsWith('whatsapp-auth-'));
  for (const name of ['duniya.sqlite', 'duniya.sqlite-wal', 'duniya.sqlite-shm', 'master.key', ...authDirs]) {
    const p = resolve(dataDir, name);
    if (existsSync(p)) renameSync(p, resolve(keep, name));
  }
  // Put restored files in place
  for (const rel of manifest.files) {
    const src = resolve(stage, rel);
    const dst = resolve(dataDir, rel);
    if (!dst.startsWith(`${resolve(dataDir)}/`)) continue; // never write outside the data dir
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
  }
  rmSync(stage, { recursive: true, force: true });
  // Keep only the 3 most recent pre-restore folders
  const old = readdirSync(dataDir).filter((n) => n.startsWith('pre-restore-')).sort().reverse().slice(3);
  for (const n of old) rmSync(resolve(dataDir, n), { recursive: true, force: true });
  console.log(`Restored backup ${manifest.source || ''} (${manifest.files.length} files); previous data kept in ${keep}`);
  return manifest;
}
