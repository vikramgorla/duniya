// Words as tags (076): an agent's wake words and a person's tags (078). Loaded with the screens that use it.
import { api, h } from './core.js';

/** 076: words as tags — Enter, comma or leaving the box adds one, × or Backspace in an empty box removes one.
 *  Returns the input (for field errors) with .values() for saving. */
export function tagInput(list, { placeholder = '', label = '' } = {}) {
  let tags = [...list];
  const box = h('div', { class: 'tags' });
  const input = h('input', { placeholder, 'aria-label': label, enterkeyhint: 'enter' });
  const changed = () => box.dispatchEvent(new Event('input', { bubbles: true })); // the section's unsaved-changes bar
  const add = () => {
    const words = input.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    input.value = '';
    if (!words.length) return false;
    tags = [...new Set([...tags, ...words])]; draw(); return true;
  };
  const draw = () => box.replaceChildren(...tags.map((w) => h('span', { class: 'tag' }, w,
    h('button', { type: 'button', class: 'tag-x', 'aria-label': `Remove ${w}`, onclick: () => { tags = tags.filter((y) => y !== w); draw(); input.focus(); changed(); } }, '×'))), input);
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) { e.preventDefault(); if (add()) changed(); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags = tags.slice(0, -1); draw(); input.focus(); changed(); }
  });
  input.addEventListener('blur', () => { if (add()) changed(); });
  box.onclick = (e) => { if (e.target === box) input.focus(); };
  draw();
  input.values = () => [...new Set([...tags, ...input.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean)])];
  input.box = box;
  return input;
}

/**
 * 079: people and lists as tags (an agent's organizers, participants and shared lists). `entries`: [{ value, label,
 * kind: person | list | phone }]; typing searches People and the lists (`lists`: [{ id, name }]); a typed number with
 * country code is added as a number. `only: 'list'` offers lists only. Returns the box with .values() for saving.
 */
export function peoplePicker(entries, { label = '', placeholder = 'Type a name, list or number', lists = [], only = '' } = {}) {
  let chosen = entries.map((e) => ({ value: e.value, label: e.label, kind: e.kind }));
  const box = h('div', { class: 'tags' });
  const hits = h('div', { class: 'row', style: 'gap:6px;margin-top:6px' });
  const input = h('input', { placeholder, 'aria-label': label, autocomplete: 'off', enterkeyhint: 'enter' });
  const changed = () => box.dispatchEvent(new Event('input', { bubbles: true }));
  const add = (e) => { if (!chosen.some((c) => c.value === e.value)) chosen.push(e); input.value = ''; hits.replaceChildren(); draw(); changed(); input.focus(); };
  const mark = { list: '≡ ', phone: '+', person: '' };
  const draw = () => box.replaceChildren(...chosen.map((c) => h('span', { class: 'tag' }, `${c.kind === 'list' ? mark.list : ''}${c.label}`,
    h('button', { type: 'button', class: 'tag-x', 'aria-label': `Remove ${c.label}`, onclick: () => { chosen = chosen.filter((y) => y.value !== c.value); draw(); changed(); } }, '×'))), input);
  let timer;
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { hits.replaceChildren(); return; }
    const ls = lists.filter((l) => l.name.toLowerCase().includes(q)).slice(0, 3).map((l) => ({ value: l.id, label: l.name, kind: 'list' }));
    const ps = only ? [] : (await api('GET', `/api/people?q=${encodeURIComponent(q)}&limit=6`).catch(() => [])).map((p) => ({ value: p.id, label: p.name, kind: 'person' }));
    hits.replaceChildren(...[...ls, ...ps].filter((e) => !chosen.some((c) => c.value === e.value)).slice(0, 7)
      .map((e) => h('button', { type: 'button', class: 'btn small', onclick: () => add(e) }, `${e.kind === 'list' ? mark.list : ''}${e.label}`)));
  }, 200); };
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const d = input.value.replace(/\D/g, '');
    if (!only && d.length >= 6 && /^[+\d\s()-]+$/.test(input.value.trim())) add({ value: d, label: `+${d}`, kind: 'phone' });
    else hits.querySelector('button')?.click();
  });
  box.onclick = (e) => { if (e.target === box) input.focus(); };
  draw();
  const wrap = h('div', {}, box, hits);
  wrap.values = () => chosen.map((c) => c.value);
  return wrap;
}
