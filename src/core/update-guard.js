// @ts-check
// The start guard of an update (095): a release that does not start is put back by itself.
//
// `applyUpdate` (updates.js) leaves a note in the data directory before the restart: where the update came from and
// where it went. Every start with a note counts. When the app has started and stayed up for a minute, the note goes:
// the update holds. When MAX_STARTS starts in a row did not get that far, the next start puts the previous release
// back (the noted commit and, when they changed, its dependencies), writes what happened and ends, so the service
// manager starts the previous release; that one tells the owner (updates.js reads the result).
//
// Rules of this module: Node built-ins only (it runs before any app code and must load when app code is broken); it
// fails open (nothing in here may keep a release from starting); every command has a deadline; the note is read as
// untrusted input. It does nothing in Docker or a development checkout.
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const NOTE = 'update-pending.json';
const RESULT = 'update-rolled-back.json';
const MAX_STARTS = 3; // starts in a row that may fail before the release is put back
const HOLDS_AFTER = 60 * 1000; // ms the app must stay up for the update to hold
const UNDO_TRIES = 3; // tries to put the previous release back (a dependency install can fail for a moment)
const GIT_WAIT = 60 * 1000; // ms
const NPM_WAIT = 15 * 60 * 1000; // ms: installing dependencies on a small server
const COMMIT = /^[0-9a-f]{7,64}$/; // nothing else may reach git as an argument
const WORD_MAX = 80; // characters of a version or a file name taken from the note
/** The kind of install the guard works on: installer servers, where a service manager restarts the app. */
export const GUARDED_INSTALL = 'systemd';

const dataDirOf = () => resolve(ROOT, process.env.DATA_DIR || 'data'); // as config.js (not imported: see the rules above)
const say = (text) => console.error(`Update guard: ${text}`);
const drop = (file) => rmSync(file, { force: true });
/** A file written whole: a start that dies half-way never leaves half a note. */
function writeWhole(file, value) {
  writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
function readJson(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return undefined; /* no such file: the usual case */ }
  try { return JSON.parse(text); } catch { return null; }
}
const isNote = (n) => !!n && typeof n === 'object' && COMMIT.test(String(n.from)) && Number.isInteger(n.starts) && n.starts >= 0;

/** The note about an installed update, or null (a note that cannot be used is dropped). */
function readNote(dataDir) {
  const file = resolve(dataDir, NOTE);
  const note = readJson(file);
  if (note === undefined) return null;
  if (isNote(note)) return note;
  say('the note about the last update could not be read and was dropped');
  drop(file);
  return null;
}

/**
 * An update was installed and the app is about to restart: where it came from (`from`: the commit, `fromVersion`),
 * where it went (`to`, `target`, `commit`), whether its dependencies changed (`deps`) and the backup made before it.
 */
export function noteUpdate(dataDir, note) {
  writeWhole(resolve(dataDir, NOTE), { ...note, at: Date.now(), starts: 0 });
}

const run = (cmd, args, cwd, wait) => execFileSync(cmd, args, { cwd, timeout: wait, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
/** Is the checkout on this commit already? */
const isAt = (root, commit) => String(run('git', ['rev-parse', 'HEAD'], root, GIT_WAIT)).trim().startsWith(commit);

/**
 * Put the previous release back. 'back': done. 'again': a step failed and the next start tries again. 'gave_up': it
 * failed UNDO_TRIES times; the result file says why and nothing more is tried.
 */
function putBack(root, dataDir, note) {
  const word = (x) => String(x || '').slice(0, WORD_MAX); // the note is read as untrusted: short text only
  const result = { ok: true, error: '', from: word(note.to), to: word(note.fromVersion), target: word(note.target), commit: word(note.commit), backup: word(note.backup) || null, starts: note.starts, at: Date.now() };
  say(`${result.from || 'the new release'} did not start ${note.starts} times: putting ${result.to || 'the previous release'} back`);
  try {
    run('git', ['checkout', '-q', note.from], root, GIT_WAIT);
    if (note.deps) run('npm', ['ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund', '--loglevel=error'], root, NPM_WAIT);
  } catch (e) {
    const error = String(e?.stderr || e?.message || e).trim().slice(-300);
    const tries = (Number(note.undoTries) || 0) + 1;
    say(`putting it back failed (try ${tries} of ${UNDO_TRIES}): ${error}`);
    if (tries < UNDO_TRIES) { writeWhole(resolve(dataDir, NOTE), { ...note, undoTries: tries }); return 'again'; }
    Object.assign(result, { ok: false, error });
  }
  writeWhole(resolve(dataDir, RESULT), result);
  drop(resolve(dataDir, NOTE));
  say(result.ok ? `${result.to || 'the previous release'} is back and starts next` : 'giving up: this start goes on with what is there');
  return result.ok ? 'back' : 'gave_up';
}

/** This start counts as a try of the update. Returns what drops the note a minute after the app has started. */
function countStart(dataDir, note) {
  const file = resolve(dataDir, NOTE);
  writeWhole(file, { ...note, starts: note.starts + 1 });
  say(`start ${note.starts + 1} of ${MAX_STARTS} after the update to ${note.to || 'a new release'}`);
  const holds = () => { try { drop(file); say(`the update to ${note.to || 'the new release'} holds`); } catch (e) { say(`the note could not be removed (${e.message})`); } };
  return () => { setTimeout(holds, HOLDS_AFTER).unref(); };
}

/**
 * Called first at every start. Returns what the entry point calls when the app has started. With a note about an
 * update this start counts, and a minute after the app has started the note is dropped. After MAX_STARTS starts that
 * did not get that far the previous release is put back and the process ends (`exit`).
 * @param {{ root?: string, dataDir?: string, kind?: string, exit?: (code: number) => void }} [o]
 */
export function guardStart({ root = ROOT, dataDir = dataDirOf(), kind = process.env.DUNIYA_INSTALL, exit = process.exit } = {}) {
  const nothing = () => {};
  if (kind !== GUARDED_INSTALL) return nothing;
  try {
    const note = readNote(dataDir);
    if (!note) return nothing;
    if (note.starts < MAX_STARTS) return countStart(dataDir, note);
    // Someone put the previous release back by hand: nothing to undo, nothing to count. (After a try of our own
    // the checkout is there as well, and the step that failed is still to do.)
    if (!note.undoTries && isAt(root, note.from)) { drop(resolve(dataDir, NOTE)); return nothing; }
    if (putBack(root, dataDir, note) !== 'gave_up') exit(1); // the service manager starts the previous release, or the next start tries again
  } catch (e) { say(`skipped (${e?.message || e})`); }
  return nothing;
}

/** What the guard did at an earlier start (read once): the result of a rollback, or null. */
export function takeRollbackResult(dataDir) {
  const file = resolve(dataDir, RESULT);
  const result = readJson(file);
  if (result === undefined) return null;
  drop(file);
  return result && typeof result === 'object' ? result : null;
}
