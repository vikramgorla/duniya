// App updates: the Overview box and banner (045). The dialog of an update and the watch of a running one are in
// update-flow.js, loaded when they are needed. Module of the panel (063).
import { $, S, ago, api, h, menu, tryApi } from './core.js';
/** The update dialog for `target`; true when the update was started. */
const confirmUpdate = async (u, o) => (await import('./update-flow.js')).confirmUpdate(u, o);
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
  // 095: not the main button for a release that did not start here
  const updateBtn = plain && !u.running && !docker ? h('button', { class: `btn small${d || u.rolledBack?.from === plain ? '' : ' primary'}`, onclick: async (e) => {
    const b = e.currentTarget;
    if (!await confirmUpdate(u, { target: plain })) return;
    b.disabled = true; S.updateFrom = st.current; redraw();
  } }, `Update to ${plain}`) : null;
  const reviewBtn = d && !u.running ? h('button', { class: 'btn small primary', onclick: async () => { if (await confirmUpdate(u, { target: d.target, breaking: true })) { S.updateFrom = d.current; redraw(); } } }, `Review ${d.version}`) : null;
  if (u.running || S.updateFrom) import('./update-flow.js').then((m) => m.watchUpdate(S.updateFrom || st.current, redraw));
  // One clear status line: what is running, and whether something newer exists.
  // 095: a release that did not start and was put back comes before "the last update failed"
  const trouble = u.rolledBack ? `${u.rolledBack.from} did not start here${u.rolledBack.ok ? ' and was rolled back' : ''}. `
    : lr && !lr.ok && Date.now() - lr.at < 7 * 86400000 ? 'The last update failed; the previous version kept running. ' : '';
  const [tone, text] = u.running ? ['', u.running.phase === 'backup' ? 'Making a backup before the update…' : `Installing ${u.running.target || 'the update'}…`]
    : d ? ['warn', `Version ${d.version} needs your decision · running ${st.current}`]
      : st.available ? ['warn', `Update available: ${st.latest} · running ${st.current}`]
        : !st.checkedAt ? ['', `Running ${st.current || 'this version'} · not checked yet`]
          : ['ok', `Up to date · ${st.current} · checked ${ago(st.checkedAt)} ago`];
  const line = h('span', { class: 'upd-text' }, u.running ? h('span', { class: 'spinner' }) : h('span', { class: `dot ${tone || 'warn'}`, 'aria-hidden': 'true' }), ` ${text}`,
    u.running ? h('span', { class: 'muted' }, ` started ${ago(u.running.startedAt)} ago; this page reloads by itself`) : null);
  if (!page) {
    box.replaceChildren(h('div', { class: 'upd-row' }, h('div', { class: 'upd-main' }, line,
      trouble && !u.running ? h('div', { class: 'small', style: 'color:var(--bad)' }, trouble, h('a', { href: '#settings/updates' }, 'Details')) : null,
      docker && plain ? h('div', { class: 'small muted' }, 'Docker install: update on the host.') : null),
    h('a', { class: 'small upd-notes', href: '#settings/release-notes' }, 'Release notes'),
    u.running ? null : reviewBtn || updateBtn,
    menu('Update actions', h('button', { class: 'btn small', type: 'button', onclick: check }, 'Check now'), h('a', { class: 'btn small', href: '#settings/updates' }, 'Update settings'))));
    return;
  }
  box.replaceChildren(page(u, { line, check, reviewBtn, updateBtn, docker, redraw }));
}
