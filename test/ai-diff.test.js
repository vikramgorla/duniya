// #32: the friendly diff behind the AI helper review (src/panel/public/diff.js) — word diff, hunks, list diffs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../src/panel/public/app/diff.js';

const plain = (x) => JSON.parse(JSON.stringify(x));
/** One side of a diff, put back together: the diff must never lose or invent text. */
const sideText = (ops, side) => ops.filter((o) => o.type === 'eq' || o.type === (side === 'before' ? 'del' : 'add')).map((o) => o.text).join('');

test('word diff marks only the changed words and counts them', () => {
  const r = D.diffText('Keep replies short and friendly.', 'Keep replies very short and warm.');
  assert.equal(r.mode, 'words');
  assert.deepEqual(plain(r.ops), [
    { type: 'eq', text: 'Keep replies ' }, { type: 'add', text: 'very ' }, { type: 'eq', text: 'short and ' },
    { type: 'del', text: 'friendly' }, { type: 'add', text: 'warm' }, { type: 'eq', text: '.' }]);
  assert.equal(r.added, 2); assert.equal(r.removed, 1); assert.equal(r.changed, true);
});

test('a lone space between two changes is grouped: removed words first, then added', () => {
  const r = D.diffText('the red car', 'a blue car');
  assert.deepEqual(plain(r.ops), [{ type: 'del', text: 'the red' }, { type: 'add', text: 'a blue' }, { type: 'eq', text: ' car' }]);
});

test('both sides can always be rebuilt from the ops (random texts)', () => {
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const words = ['a', 'b', 'Morges', 'é', ' ', ' ', '\n', '.', ',', 'ride'];
  for (let i = 0; i < 400; i++) {
    const make = () => Array.from({ length: Math.floor(rnd() * 40) }, () => words[Math.floor(rnd() * words.length)]).join('');
    const a = make(); const b = make(); const { ops } = D.diffText(a, b);
    assert.equal(sideText(ops, 'before'), a); assert.equal(sideText(ops, 'after'), b);
  }
});

test('identical, empty and missing texts', () => {
  assert.equal(D.diffText('same', 'same').changed, false);
  assert.deepEqual(plain(D.diffText(null, 'new text').ops), [{ type: 'add', text: 'new text' }]);
  assert.deepEqual(plain(D.diffText('old', '').ops), [{ type: 'del', text: 'old' }]);
  assert.deepEqual(plain(D.diffText('', '').ops), []);
});

test('very long texts fall back to a line diff', () => {
  const a = Array.from({ length: 900 }, (_, i) => `line number ${i}`).join('\n');
  const b = a.replace('line number 500', 'line number five hundred');
  const r = D.diffText(a, b, { maxTokens: 2000 });
  assert.equal(r.mode, 'lines');
  assert.deepEqual(plain(r.ops.filter((o) => o.type !== 'eq')), [{ type: 'del', text: 'line number 500\n' }, { type: 'add', text: 'line number five hundred\n' }]);
  assert.equal(sideText(r.ops, 'after'), b);
});

test('hunks fold long unchanged stretches and keep context around changes', () => {
  const a = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].join('\n');
  const b = a.replace('eight', 'EIGHT');
  const h = D.hunks(D.diffText(a, b).ops, { context: 1 });
  assert.deepEqual(plain(h.map((x) => [x.type, x.lines.length])), [['skip', 6], ['lines', 3]]);
  assert.equal(h[0].lines.map((l) => l.map((s) => s.text).join('')).join('|'), 'one|two|three|four|five|six');
  assert.ok(h[1].lines[1].some((s) => s.type === 'add' && s.text === 'EIGHT'));
  // short stretches are not folded
  assert.deepEqual(plain(D.hunks(D.diffText('a\nb\nc', 'a\nB\nc').ops, { context: 0 }).map((x) => x.type)), ['lines']);
});

test('list diff: added, removed and kept, with objects by key', () => {
  assert.deepEqual(plain(D.diffList(['!ride', '!car'], ['!ride', '!lift'])), { added: ['!lift'], removed: ['!car'], kept: ['!ride'] });
  assert.deepEqual(plain(D.diffList(null, ['a'])), { added: ['a'], removed: [], kept: [] });
  const s = D.diffList([{ id: 'a', at: '06:45' }, { id: 'b' }], [{ id: 'a', at: '07:00' }, { id: 'c' }], (x) => x.id);
  assert.deepEqual(plain(s.added.map((x) => x.id)), ['c']); assert.deepEqual(plain(s.removed.map((x) => x.id)), ['b']); assert.deepEqual(plain(s.kept.map((x) => x.id)), ['a']);
});

test('word counting ignores punctuation and whitespace', () => {
  assert.equal(D.diffText('', ' Hello, wörld — 3 times! ').added, 4);
  assert.equal(D.diffText('', '').added, 0);
});

test('an inserted line is shown as a whole line, not split across two', () => {
  const r = D.diffText('- one rule.\n- Be precise.', '- one rule.\n- New rain rule.\n- Be precise.');
  assert.deepEqual(plain(r.ops), [{ type: 'eq', text: '- one rule.\n' }, { type: 'add', text: '- New rain rule.\n' }, { type: 'eq', text: '- Be precise.' }]);
  const h = D.hunks(r.ops);
  assert.deepEqual(plain(h[0].lines.map((l) => l.map((s) => s.type).join(','))), ['eq', 'add,add', 'eq']);
});
