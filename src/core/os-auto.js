// @ts-check
// Automatic OS updates (098). On installer servers the root maintenance helper installs the waiting OS updates every
// night, a little after the app's own update time (the owner's clock), and restarts the server when an update needs
// it (a new kernel). On by default: update settings `os` ('auto' | 'off'). It rides the update scheduler's round
// (update-decision.js, every 10 minutes), so it has no timer of its own; each step happens at most once a night.
import { getUpdateSettings, updateRunning } from './updates.js';
import { opsAvailable, opsRunning, osUpdates, rebootStatus, requestOp } from './system.js';
import { ownerDay, ownerNow } from './owner-clock.js';
import { kvGet, kvSet } from './db.js';

const MINUTE = 60 * 1000;
const DAY_MIN = 24 * 60;
const AFTER_APP_MIN = 30; // the app's own update (and its restart) comes first
const WINDOW_MIN = 180; // then three hours: a server that was off at the start still updates, never in the owner's day
const BY = 'automatic OS updates';
const INSTALLED = 'os:autoInstall'; // the night (owner's date the window opened) of the last check-and-install
const RESTARTED = 'os:autoRestart'; // the night of the last automatic restart

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmmOf = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** Minutes since tonight's window opened, or null outside it (it may cross midnight). */
function minutesIntoWindow(at, hhmm) {
  const since = (minutesOf(hhmm) - minutesOf(at) - AFTER_APP_MIN + 2 * DAY_MIN) % DAY_MIN;
  return since <= WINDOW_MIN ? since : null;
}

/** What the panel and the admin MCP show: { on, from, until } (the owner's times). */
export function osAutoState() {
  const s = getUpdateSettings();
  const from = (minutesOf(s.at) + AFTER_APP_MIN) % DAY_MIN;
  return { on: s.os === 'auto', from: hhmmOf(from), until: hhmmOf((from + WINDOW_MIN) % DAY_MIN) };
}

/** One round: install waiting OS updates once a night, then restart once when an update asked for it. */
export async function osAutoTick(now = Date.now()) {
  const s = getUpdateSettings();
  if (s.os !== 'auto' || !opsAvailable()) return { action: 'off' };
  const since = minutesIntoWindow(s.at, ownerNow(now).hhmm);
  if (since === null) return { action: 'later' };
  if (updateRunning() || opsRunning()) return { action: 'busy' };
  const night = ownerDay(now - since * MINUTE);
  if (kvGet(INSTALLED) !== night) {
    kvSet(INSTALLED, night);
    const waiting = await osUpdates({ refresh: true });
    if (waiting.supported && waiting.count) { requestOp('os-update', BY); return { action: 'installing', count: waiting.count }; }
  }
  if (!rebootStatus().required || kvGet(RESTARTED) === night) return { action: 'none' };
  kvSet(RESTARTED, night);
  requestOp('reboot', BY);
  return { action: 'restarting' };
}
