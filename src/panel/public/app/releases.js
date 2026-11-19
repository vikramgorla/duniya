// Release notes (065): what each version brings, shown before an update (every version between the running one and
// the target), once after an update ("What's new") and in Settings → Help → Release notes. Module of the panel.
import { api, ask, h, tryApi } from './core.js';
import { plural } from './shared.js';

const KINDS = [['new', 'New'], ['improved', 'Improved'], ['fixed', 'Fixed'], ['removed', 'Removed']];
const DOCS = 'https://github.com/vikramgorla/duniya/blob/';
const parts = (v) => String(v || '').replace(/^v/, '').split('.').map(Number);
/** Version a is not newer than b. */
export const notAfter = (a, b) => { const [x, y] = [parts(a), parts(b)]; const i = x.findIndex((n, k) => n !== y[k]); return i < 0 || x[i] < y[i]; };

/**
 * One row per version, newest first: version · title, and when open its changes grouped by kind. Breaking releases
 * are marked, open, and say what the owner must do. `open`: how many of the newest versions start open.
 * @param {any[]} versions  @param {{ open?: number }} [o]
 */
export function releaseList(versions, { open = 2 } = {}) {
  if (!versions.length) return h('p', { class: 'small muted' }, 'No release notes for these versions.');
  return h('div', { class: 'rel-list' }, versions.map((r, i) => h('details', { class: `rel${r.breaking ? ' breaking' : ''}`, open: i < open || r.breaking },
    h('summary', {}, h('span', { class: 'rel-v' }, `v${r.version}`), h('span', { class: 'rel-title' }, r.title || `Version ${r.version}`),
      r.breaking ? h('span', { class: 'pill bad' }, 'Needs your OK') : null),
    r.breaking ? h('div', { class: 'note warn' }, r.summary ? h('div', {}, r.summary) : null,
      r.actions?.length ? h('div', { style: 'margin-top:6px' }, h('b', {}, 'What you need to do'), h('ul', {}, r.actions.map((a) => h('li', {}, a)))) : null,
      r.data === 'not-migrated' ? h('div', { style: 'margin-top:6px' }, 'Older data or settings named above are not carried over.') : null)
      : !r.changes?.length && r.summary ? h('p', { class: 'small muted rel-sum' }, r.summary) : null,
    KINDS.map(([kind, label]) => {
      const list = (r.changes || []).filter((c) => c.type === kind);
      return list.length ? h('div', { class: `rel-group ${kind}` }, h('div', { class: 'eyebrow' }, label), h('ul', {}, list.map((c) => h('li', {}, c.text)))) : null;
    }),
    r.docs ? h('a', { class: 'small rel-more', href: `${DOCS}v${r.version}/${r.docs}`, target: '_blank', rel: 'noopener' }, 'Read more ↗') : null)));
}

/** A line such as "3 releases · 12 changes" for a range. */
export const rangeLine = (versions) => `${plural(versions.length, 'release')} · ${plural(versions.reduce((n, r) => n + (r.changes?.length || 0), 0), 'change')}`;

/** Read-only dialog with the notes of the versions after `from` up to `to` (all when both are empty). */
export async function showReleaseNotes({ from = '', to = '', title = '' } = {}) {
  const r = await tryApi(() => api('GET', `/api/releases?${new URLSearchParams({ from, to })}`));
  if (!r) return;
  await ask({ title: title || 'Release notes', text: from ? `${rangeLine(r.versions)} since ${from}.` : `You are running ${r.running}.`, ok: null, cancel: 'Close', wide: true, body: releaseList(r.versions, { open: from ? 3 : 1 }) });
}
