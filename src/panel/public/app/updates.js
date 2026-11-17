// App updates: the Overview box, banner and the breaking-release dialog (045). Module of the panel (063).
import { $, S, ago, api, ask, h, menu, toast, tryApi } from './core.js';
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
/**
 * Updates (073). With `page` (Settings → Updates, drawn by settings.js from the parts given here): the status, the last
 * update and its backup, Check now, the settings and Restart service. Otherwise (Overview) one calm row: "Up to date · v2.32.0 · checked 2m ago · Release notes", the one
 * action when there is one (Update to…, Review…) and ⋯ (Check now, Update settings).
 */
export async function renderUpdates(box, { page = null } = {}) {
  const seq = (S.updatesSeq = (S.updatesSeq || 0) + 1);
  const u = await api('GET', '/api/updates').catch(() => null); if (!u || !box || seq !== S.updatesSeq) return; // a newer draw is on its way
  const st = u.status || {};
  const d = u.decision;
  const lr = st.lastResult;
  const redraw = () => document.body.contains(box) && renderUpdates(box, { page });
  drawUpdateBanner(u, redraw);
  const check = (e) => tryApi(async () => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking…'; await api('POST', '/api/updates/check'); redraw(); });
  const plain = st.breaking ? st.safeTarget : st.available ? st.latest : null;
  const docker = u.install === 'docker';
  const updateBtn = plain && !u.running && !docker ? h('button', { class: `btn small${d ? '' : ' primary'}`, onclick: async (e) => {
    const b = e.currentTarget;
    if (!await confirmUpdate(u, { target: plain })) return;
    b.disabled = true; S.updateFrom = st.current; redraw();
  } }, `Update to ${plain}`) : null;
  const reviewBtn = d && !u.running ? h('button', { class: 'btn small primary', onclick: async () => { if (await confirmUpdate(u, { target: d.target, breaking: true })) { S.updateFrom = d.current; redraw(); } } }, `Review ${d.version}`) : null;
  if (u.running || S.updateFrom) watchUpdate(S.updateFrom || st.current, redraw);
  // One clear status line: what is running, and whether something newer exists.
  const failed = lr && !lr.ok && Date.now() - lr.at < 7 * 86400000;
  const [tone, text] = u.running ? ['', u.running.phase === 'backup' ? 'Making a backup before the update…' : `Installing ${u.running.target || 'the update'}…`]
    : d ? ['warn', `Version ${d.version} needs your decision · running ${st.current}`]
      : st.available ? ['warn', `Update available: ${st.latest} · running ${st.current}`]
        : !st.checkedAt ? ['', `Running ${st.current || 'this version'} · not checked yet`]
          : ['ok', `Up to date · ${st.current} · checked ${ago(st.checkedAt)} ago`];
  const line = h('span', { class: 'upd-text' }, u.running ? h('span', { class: 'spinner' }) : h('span', { class: `dot ${tone || 'warn'}`, 'aria-hidden': 'true' }), ` ${text}`,
    u.running ? h('span', { class: 'muted' }, ` started ${ago(u.running.startedAt)} ago; this page reloads by itself`) : null);
  if (!page) {
    box.replaceChildren(h('div', { class: 'upd-row' }, h('div', { class: 'upd-main' }, line,
      failed && !u.running ? h('div', { class: 'small', style: 'color:var(--bad)' }, 'The last update failed; the previous version kept running. ', h('a', { href: '#settings/updates' }, 'Details')) : null,
      docker && plain ? h('div', { class: 'small muted' }, 'Docker install: update on the host.') : null),
    h('a', { class: 'small upd-notes', href: '#settings/release-notes' }, 'Release notes'),
    u.running ? null : reviewBtn || updateBtn,
    menu('Update actions', h('button', { class: 'btn small', type: 'button', onclick: check }, 'Check now'), h('a', { class: 'btn small', href: '#settings/updates' }, 'Update settings'))));
    return;
  }
  box.replaceChildren(page(u, { line, check, reviewBtn, updateBtn, docker, redraw }));
}
