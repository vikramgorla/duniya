// List → detail (064): a list of rows (icon · name · short status · chevron) and the page of the chosen row.
// Two panes on wide screens (list left, page right); on phones the list, then the page pushed over it with a back
// arrow. Deep links: #<screen>/<id> (Find anything and the back button work). Used by Models and Settings.
import { h, icon } from './core.js';
/**
 * @param {{ screen: string, title: string, groups: { title?: string, items: { id: string, name: string, sub?: any, mark?: any, status?: any }[] }[],
 *   page: (id: string) => any, first?: string, known?: (id: string) => boolean }} o
 */
export function listDetail({ screen, title, groups, page, first, known }) {
  const ids = groups.flatMap((g) => g.items.map((it) => it.id));
  const wanted = decodeURIComponent(location.hash.split('/')[1] || '');
  const chosen = ids.includes(wanted) || (wanted && known?.(wanted)) ? wanted : ''; // known: pages without a row (a provider not connected yet)
  const pane = h('section', { class: 'ld-page', 'aria-live': 'polite' });
  const root = h('div', { class: `ld${chosen ? ' has-page' : ''}` });
  const rows = new Map();
  const open = (id, push) => {
    const item = groups.flatMap((g) => g.items).find((it) => it.id === id);
    const body = page(id);
    if (body instanceof HTMLElement) body.removeAttribute('data-jump'); // the page is the target, no flash
    pane.replaceChildren(h('a', { class: 'ld-back', href: `#${screen}`, onclick: (e) => { e.preventDefault(); history.pushState(null, '', `#${screen}`); root.classList.remove('has-page'); rows.get(id)?.focus(); } },
      icon('back'), title), body);
    for (const [rid, a] of rows) { if (rid === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    if (push) {
      history.pushState(null, '', `#${screen}/${encodeURIComponent(id)}`);
      root.classList.add('has-page');
      if (matchMedia('(max-width: 640px)').matches) window.scrollTo({ top: 0 }); // phones: the page starts at its top
      pane.querySelector('h2')?.setAttribute('tabindex', '-1'); pane.querySelector('h2')?.focus({ preventScroll: true });
    }
    document.title = `${item?.name || title} · Duniya`;
  };
  const list = h('nav', { class: 'ld-list', 'aria-label': title }, groups.filter((g) => g.items.length).map((g) => h('div', { class: 'lgroup' },
    g.title ? h('div', { class: 'eyebrow' }, g.title) : null,
    h('ul', {}, g.items.map((it) => {
      const a = h('a', { class: 'lrow', href: `#${screen}/${encodeURIComponent(it.id)}`, onclick: (e) => { e.preventDefault(); open(it.id, true); } },
        it.mark || null, h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, it.name), it.sub ? h('span', { class: 'lrow-sub' }, it.sub) : null),
        it.status || null, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
      rows.set(it.id, a);
      return h('li', {}, a);
    })))));
  root.append(list, pane);
  open(chosen || first || ids[0], false);
  return root;
}
/** A small round mark (initial on a colour) for a list row. */
export const mark = (letter, cls = '') => h('span', { class: `lmark ${cls}`, 'aria-hidden': 'true' }, letter);
