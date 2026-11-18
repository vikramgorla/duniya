// Words as tags (076): an agent's wake words and a person's tags (078). Loaded with the screens that use it.
import { h } from './core.js';

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
