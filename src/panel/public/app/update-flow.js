// Installing an update (045, 065, 095): the dialog that shows what an update brings, and the watch of a running
// update until the new version answers (or the server put the previous one back). Loaded when an update is reviewed
// or running, so Overview's first screen does not carry it. Module of the panel (063).
import { S, api, ask, h, toast, tryApi } from './core.js';

const EVERY = 3000; // ms between two looks at a running update
const RECENT = 60 * 1000; // ms before the watch began in which a result still belongs to this update
const GIVE_UP = 5 * 60 * 1000; // ms after which the page reloads to see for itself

/** One question to the server: its answer (null when there is none) and whether the server looked down. */
async function look(path) {
  try {
    const r = await fetch(path, { cache: 'no-store' });
    return r.ok ? { body: await r.json(), down: false } : { body: null, down: r.status >= 500 };
  } catch { return { body: null, down: true }; }
}
/** How the update ended: the words to show and whether the page reloads; null while it is still going on. */
function outcome(u, { from, started, wentDown }) {
  if (!u || u.running) return null;
  // 095: the new release did not start and the server put the previous one back
  if (u.rolledBack?.at > started - RECENT) return { text: `${u.rolledBack.from} did not start`, reload: true };
  const last = u.status?.lastResult;
  if (last && !last.ok && last.at > started - RECENT && !wentDown) return { text: 'The update failed; the previous version is still running.', reload: false };
  if (wentDown || (u.status?.current && u.status.current !== from)) return { text: `Updated to ${u.status?.current || 'the new version'} — reloading`, reload: true };
  return null;
}
/** Watch a running update (one watch at a time) until the server says how it ended; `onTick` redraws the row. */
export function watchUpdate(from, onTick) {
  if (S.updateWatch) return;
  const started = Date.now(); let wentDown = false; let bootUptime = null;
  S.updateFrom = from;
  const end = ({ text, reload }) => {
    clearInterval(S.updateWatch); S.updateWatch = null; S.updateFrom = null;
    toast(text);
    if (reload) setTimeout(() => location.reload(), 900); else onTick?.();
  };
  S.updateWatch = setInterval(async () => {
    const u = await look('/api/updates'); const st = await look('/api/status');
    wentDown ||= u.down || st.down;
    if (st.body) { // an uptime that went back: the process restarted between two looks
      if (bootUptime !== null && st.body.uptimeSec < bootUptime) wentDown = true;
      bootUptime = st.body.uptimeSec;
    }
    const how = outcome(u.body, { from, started, wentDown }) || (Date.now() - started > GIVE_UP ? { text: 'Reloading to check the update…', reload: true } : null);
    if (how) end(how); else onTick?.();
  }, EVERY);
}
// 065: one dialog for every update: every release between the running version and the target (newest first, breaking
// ones marked with what to do), a backup choice and the action on the button. Breaking releases (045) need this OK.
/** Notes for the range up to `target`; breaking steps without an entry (an unlisted new major) are added. */
function rangeNotes(st, d, target, notAfter) {
  const notes = (st.notes || []).filter((n) => notAfter(n.version, target));
  const missing = (d?.steps || []).filter((x) => notAfter(x.version, target) && !notes.some((n) => n.version === x.version)).map((x) => ({ ...x, breaking: true, changes: [] }));
  return [...notes, ...missing].sort((a, b) => (notAfter(a.version, b.version) ? 1 : -1));
}
export async function confirmUpdate(u, { target, breaking = false }) {
  const { notAfter, rangeLine, releaseList } = await import('./releases.js'); // loads when an update is reviewed
  const st = u.status || {};
  const d = breaking ? u.decision : null;
  const notes = rangeNotes(st, d, target, notAfter);
  const steps = notes.filter((n) => n.breaking).length;
  const docker = u.install === 'docker';
  const backup = h('input', { type: 'checkbox', checked: u.backup, disabled: !u.backup });
  const ok = await ask({ title: `Update to ${target}?`, wide: true,
    text: `You are running ${st.current}. ${notes.length ? `${rangeLine(notes)} come with it` : 'No release notes for this update'}${steps ? `, ${steps > 1 ? `${steps} of them need` : 'one needs'} your OK: read what to do` : ''}.${docker ? '' : ' The agents pause for about a minute; this page reloads by itself.'}`,
    ok: docker ? null : `Update to ${target}`, cancel: docker ? 'Close' : 'Not now',
    body: [releaseList(notes, { open: notes.length > 4 ? 2 : 3 }),
      docker ? h('div', { class: 'note' }, 'Docker install: update the image on the host with  docker compose pull && docker compose up -d')
        : h('label', { class: 'check rel-backup' }, backup, u.backup ? 'Make a backup first (on this server; the update waits for it)' : 'Make a backup first: set a backup passphrase under Backups to use this'),
      d?.safeTarget && !docker ? h('p', { class: 'small muted' }, `Not ready yet? ${d.safeTarget} can be installed without this decision.`) : null] });
  if (!ok) return false;
  return !!await tryApi(() => api('POST', '/api/updates/apply', breaking ? { breaking: true, backup: backup.checked } : { backup: backup.checked }));
}
