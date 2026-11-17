// #1: the panel works on phones (iPhone 15 = 393 px, SE = 375 px). Static checks of the panel (src/panel/public/);
// the full browser check is `npm run check:responsive` (needs a local Chrome, not run in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(import.meta.dirname, '../src/panel/public');
const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
const css = readFileSync(join(PUBLIC, 'app/styles.css'), 'utf8');
// every panel module, one after the other; `where(i)` turns an index back into file:line
const parts = readdirSync(join(PUBLIC, 'app')).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(join(PUBLIC, 'app', f), 'utf8')]);
const js = parts.map(([, src]) => src).join('\n');
function where(i) {
  for (const [f, src] of parts) { if (i <= src.length) return `${f}:${src.slice(0, i).split('\n').length}`; i -= src.length + 1; }
  return '?';
}

/** Index just past a string or template literal starting at i (template ${…} parts included). */
function skipString(src, i) {
  const q = src[i];
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === q) return i + 1;
    else if (q === '`' && src[i] === '$' && src[i + 1] === '{') i = match(src, i + 1, '{', '}');
  }
  throw new Error('unterminated string');
}
/** Index of the bracket closing the one at `open` (same kind), skipping strings and template literals. */
function match(src, open, o = '(', c = ')') {
  let depth = 0;
  for (let i = open; i < src.length;) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(src, i); continue; }
    if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
    i++;
  }
  throw new Error(`unbalanced ${o} at ${open}`);
}
const closing = (src, open) => match(src, open);
/** Every h('tag', …) call in the panel script: { start, text, attrs }. */
function calls(tag) {
  const out = [];
  for (const m of js.matchAll(new RegExp(`h\\('${tag}'`, 'g'))) {
    const open = m.index + 1; const end = closing(js, open);
    const text = js.slice(m.index, end + 1);
    const a = text.match(/^h\('\w+',\s*(\{[^}]*\}|null|\{\})/);
    out.push({ start: m.index, text, attrs: a ? a[1] : '' });
  }
  return out;
}

test('every data table turns into cards on phones (table.stack) or scrolls inside its card', () => {
  const tables = calls('table');
  assert.ok(tables.length >= 10, `found only ${tables.length} tables`);
  const bad = tables.filter(({ start, attrs }) => {
    if (/class: '[^']*\bstack\b/.test(attrs)) return false;
    const before = js.slice(Math.max(0, start - 120), start);
    return !/h\('div', \{ (class: 'tscroll'[^}]*|style: '[^']*overflow-x:\s*auto[^']*') \}, $/.test(before);
  });
  assert.deepEqual(bad.map((t) => where(t.start)), [], 'tables without class stack or a tscroll / overflow-x:auto wrapper');
});

test('cells of stacked tables say which column they are (data-label, empty for a full-width cell)', () => {
  for (const t of calls('table').filter((x) => /\bstack\b/.test(x.attrs))) {
    for (const m of t.text.matchAll(/h\('td',\s*(\{[^}]*\})/g)) {
      assert.match(m[1], /'data-label'/, `td without data-label in: ${t.text.slice(0, 140)}…`);
    }
  }
});

test('phone rules: 40 px touch targets, 13 px text, stacked tables, no page wider than the screen', () => {
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1[^"]*">/);
  const phone = css.slice(css.indexOf('/* Phones (iPhone 15'));
  assert.ok(phone.length > 100, 'phone section missing in the panel CSS');
  for (const re of [/\.btn\.small[^{]*\{[^}]*min-height: 40px/, /nav button \{ min-height: 40px/, /\.seg button \{[^}]*min-height: 40px/, /summary, \.card summary \{[^}]*line-height: 20px/,
    /label\.inline \{ min-height: 40px/, /\.toggle \{ height: 40px/, /label\.tick \{ min-width: 40px; min-height: 40px/, /\.pill, \.eyebrow, legend, th[^{]*\{ font-size: 13px/]) {
    assert.match(phone, re);
  }
  assert.match(css, /table\.stack td:not\(\[data-label\]\), table\.stack td\[data-label=""\] \{ display: block/);
  assert.match(css, /\.grid \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(310px, 100%\), 1fr\)\)/);
});

test('checkboxes in tables have a 40 px label around them', () => {
  for (const t of calls('table')) {
    const naked = [...t.text.matchAll(/h\('td',\s*\{[^}]*\},\s*h\('input', \{ type: 'checkbox'/g)];
    assert.equal(naked.length, 0, `checkbox directly in a td: ${t.text.slice(0, 120)}…`);
  }
});
