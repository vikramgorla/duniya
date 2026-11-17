// App updates: the Overview box, banner and the breaking-release dialog (045). Module of the panel (063).
import { $, S, ago, api, ask, h, time, toast, tryApi } from './core.js';
import { plural } from './shared.js';
function watchUpdate(from, onTick) {
  if (S.updateWatch) return;
  const started = Date.now(); let wentDown = false; let bootUptime = null;
  S.updateFrom = from;
  const done = (msg) => { clearInterval(S.updateWatch); S.updateWatch = null; S.updateFrom = null; toast(msg); setTimeout(() => location.reload(), 900); };
  S.updateWatch = setInterval(async () => {
    let v = null; let stv = null;
    try {
      const r = await fetch('/api/updates', { cache: 'no-store' });
      if (r.ok) v = await r.json(); else wentDown = wentDown || r.status >= 500;
      const rs = await fetch('/api/status', { cache: 'no-store' });
      if (rs.ok) stv = await rs.json();
    } catch { wentDown = true; }
    if (stv) {
      if (bootUptime !== null && stv.uptimeSec < bootUptime) wentDown = true; // the process restarted between two checks
      bootUptime = stv.uptimeSec;
    }
    if (v && !v.running) {
      if (v.status?.lastResult && !v.status.lastResult.ok && v.status.lastResult.at > started - 60000 && !wentDown) {
        clearInterval(S.updateWatch); S.updateWatch = null; S.updateFrom = null; toast('The update failed; the previous version is still running.'); onTick?.(); return;
      }
      if (wentDown || (v.status?.current && v.status.current !== from)) return done(`Updated to ${v.status?.current || 'the new version'} — reloading`);
    }
    if (Date.now() - started > 5 * 60000) return done('Reloading to check the update…');
    onTick?.();
  }, 3000);
}
// 065: one dialog for every update: every release between the running version and the target (newest first, breaking
// ones marked with what to do), a backup choice and the action on the button. Breaking releases (045) need this OK.
/** Notes for the range up to `target`; breaking steps without an entry (an unlisted new major) are added. */
function rangeNotes(st, d, target, notAfter) {
  const notes = (st.notes || []).filter((n) => notAfter(n.version, target));
  const missing = (d?.steps || []).filter((x) => notAfter(x.version, target) && !notes.some((n) => n.version === x.version)).map((x) => ({ ...x, breaking: true, changes: [] }));
  return [...notes, ...missing].sort((a, b) => (notAfter(a.version, b.version) ? 1 : -1));
}
async function confirmUpdate(u, { target, breaking = false }) {
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
function drawUpdateBanner(u, after) {
  const slot = $('#ov-update-banner'); if (!slot) return;
  const d = u?.decision;
  if (!d || !d.show || u.running) return slot.replaceChildren();
  slot.replaceChildren(h('div', { class: 'card', style: 'margin-bottom:16px' },
    h('div', { class: 'note warn', style: 'margin-top:0' }, h('b', {}, `Version ${d.version} needs your decision`), ` · running ${d.current}. It is a breaking release, so automatic updates stop before it.`),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { if (await confirmUpdate(u, { target: d.target, breaking: true })) { S.updateFrom = d.current; after?.(); } } }, 'Review update'),
      h('button', { class: 'btn', onclick: () => tryApi(async () => { await api('POST', '/api/updates/decision', { action: 'snooze' }); after?.(); }, 'We will remind you in 7 days') }, 'Remind me in 7 days'),
      h('button', { class: 'btn mut', onclick: () => tryApi(async () => { await api('POST', '/api/updates/decision', { action: 'dismiss' }); after?.(); }, 'Dismissed') }, 'Dismiss'))));
}
export async function renderUpdates(box, note = '') {
  const seq = (S.updatesSeq = (S.updatesSeq || 0) + 1);
  const u = await api('GET', '/api/updates').catch(() => null); if (!u || !box || seq !== S.updatesSeq) return; // a newer draw is on its way
  const st = u.status || {};
  const d = u.decision;
  const lr = st.lastResult;
  const redraw = () => document.body.contains(box) && renderUpdates(box);
  drawUpdateBanner(u, redraw);
  const mode = h('select', {}, ['notify', 'auto', 'off'].map((m) => h('option', { value: m, selected: u.settings.mode === m }, { notify: 'Notify me', auto: 'Install automatically', off: 'Off' }[m])));
  const channel = h('select', {}, ['stable', 'main'].map((m) => h('option', { value: m, selected: u.settings.channel === m }, m === 'stable' ? 'Stable releases' : 'Latest (main)')));
  const at = h('input', { value: u.settings.at, style: 'max-width:90px', title: 'Time of day for automatic installs' });
  const keep = h('input', { type: 'number', min: 1, max: 20, value: u.settings.keepPreUpdate ?? 3, style: 'max-width:70px', title: 'Pre-update backups to keep', 'aria-label': 'Pre-update backups to keep' });
  const log = h('pre', { class: 'hide' });
  // One clear status line: what is running, and whether something newer exists.
  const state = !st.checkedAt
    ? h('div', { class: 'note' }, h('b', {}, `Running ${st.current || 'this version'}`), ' · not checked for updates yet')
    : d
      ? h('div', { class: 'note warn' }, h('b', {}, `Version ${d.version} needs your decision`), ` · running ${st.current}`,
        h('div', { class: 'small', style: 'margin-top:4px' }, d.steps.map((x) => `v${x.version}: ${x.title}`).join(' · ')),
        d.snoozedUntil ? h('div', { class: 'small muted' }, `Reminder snoozed until ${time(d.snoozedUntil)}`) : d.dismissed ? h('div', { class: 'small muted' }, 'Dismissed: no more reminders for this release') : null)
      : st.available
        ? h('div', { class: 'note warn' }, h('b', {}, `Update available: ${st.latest}`), ` · running ${st.current}`,
          st.notes?.length ? h('div', { class: 'small', style: 'margin-top:4px' }, `${plural(st.notes.length, 'release')} · newest: ${st.notes[0].title}`) : null)
        : h('div', { class: 'note ok' }, h('b', {}, `✓ Up to date: ${st.current}`), h('span', { class: 'muted' }, ` · checked ${ago(st.checkedAt)} ago · `),
          h('a', { href: '#settings/release-notes' }, 'Release notes'));
  const last = lr ? h('p', { class: 'small muted' }, lr.ok ? `Last update: ${lr.from ? `${lr.from} → ` : ''}${lr.target} on ${time(lr.at)}${lr.backup ? ` · backup ${lr.backup}` : ''}` : `Last update failed on ${time(lr.at)}; the previous version kept running.`) : null;
  const plain = st.breaking ? st.safeTarget : st.available ? st.latest : null;
  const updateBtn = plain && !u.running && u.install !== 'docker' ? h('button', { class: `btn${d ? '' : ' primary'}`, onclick: async (e) => {
    const b = e.currentTarget;
    if (!await confirmUpdate(u, { target: plain })) return;
    b.disabled = true; S.updateFrom = st.current; renderUpdates(box);
  } }, `Update to ${plain}`) : null;
  const reviewBtn = d && !u.running ? h('button', { class: 'btn primary', onclick: async () => { if (await confirmUpdate(u, { target: d.target, breaking: true })) { S.updateFrom = d.current; redraw(); } } }, `Review ${d.version}`) : null;
  // While an update runs (state kept on the server, so a reload or redraw can't lose it): show progress and poll.
  const running = u.running ? h('div', { class: 'note' }, h('span', { class: 'spinner' }), h('b', {}, u.running.phase === 'backup' ? ' Making a backup before the update…' : ` Installing ${u.running.target || 'the update'}…`),
    ` started ${ago(u.running.startedAt)} ago. The service restarts when it is done; this page reloads by itself.`) : null;
  if (u.running || S.updateFrom) watchUpdate(S.updateFrom || st.current, redraw);
  box.replaceChildren(h('h3', {}, 'Updates'),
    u.install === 'docker' ? h('div', { class: 'note' }, 'Docker install: update with  docker compose pull && docker compose up -d') : null,
    note ? h('div', { class: 'note warn' }, note) : null,
    running || state, running ? null : last,
    h('div', { class: 'row', style: 'margin-top:8px' }, reviewBtn, updateBtn,
      h('button', { class: 'btn', onclick: (e) => tryApi(async () => { e.target.disabled = true; e.target.textContent = 'Checking…'; await api('POST', '/api/updates/check'); renderUpdates(box); }) }, 'Check now')),
    h('details', { style: 'margin-top:10px' }, h('summary', { class: 'small muted' }, 'Update settings'),
      h('div', { class: 'row', style: 'margin-top:8px' }, mode, channel, at, h('button', { class: 'btn', onclick: () => tryApi(() => api('PUT', '/api/updates/settings', { mode: mode.value, channel: channel.value, at: at.value, keepPreUpdate: Number(keep.value) }), 'Saved') }, 'Save')),
      h('p', { class: 'small muted' }, 'Automatic installs never cross a breaking release: you are asked first, here and on WhatsApp. ',
        u.backup ? 'A local backup is made before every update; keep the last ' : 'Set a backup passphrase under Backups to get a local backup before every update; keep the last ', keep, ' pre-update backups.'),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: async () => (await ask({ title: 'Restart the service?', text: 'Agents pause for a few seconds; the page reloads by itself.', ok: 'Restart service', danger: true })) && api('POST', '/api/system/restart').catch(() => {}).then(() => { toast('Restarting…'); setTimeout(() => location.reload(), 6000); }) }, 'Restart service'))),
    log);
}

