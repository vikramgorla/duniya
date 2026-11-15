/// <reference types="node" />
// #63: the app's friendly AI diff is a port of the panel's src/panel/public/diff.js — same results on the same input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffKeys, diffList, diffText, hunks, sideText, textBlocks, tokenize, countWords } from './diff.ts';
import { changeView, review, scalar, daysLabel } from './ai-review.ts';

await import('../../../src/panel/public/diff.js'); // the web module sets globalThis.DuniyaDiff
const web = (globalThis as unknown as { DuniyaDiff: Record<string, (...a: unknown[]) => unknown> }).DuniyaDiff;

const PROMPT = 'You help the carpool group.\nReply in English.\n- Be short.\n- Post rides at 18:00.\nSign as Duniya.\n';
const CASES: [string, string][] = [
  ['', 'Brand new text.'],
  ['Old text.', ''],
  ['same', 'same'],
  [PROMPT, PROMPT.replace('Reply in English.', 'Reply in English or French.').replace('- Be short.\n', '').concat('- New rule: weather before rides.\n')],
  ['Post at 18:00 on Mondays.', 'Post at 19:30 on Sundays.'],
  ['Écris en français, s’il te plaît — merci !', 'Écris en français ou en anglais, merci !'],
  [Array.from({ length: 40 }, (_, i) => `Line ${i}`).join('\n'), Array.from({ length: 40 }, (_, i) => (i === 20 ? 'Line twenty' : `Line ${i}`)).join('\n')],
  ['a b c d e f', 'a x c y e z'],
];

test('diffText / hunks / sideText match the web module', () => {
  for (const [a, b] of CASES) {
    const mine = diffText(a, b); const theirs = web.diffText(a, b) as typeof mine;
    assert.deepEqual(mine, theirs, JSON.stringify([a, b]));
    assert.equal(sideText(mine.ops, 'before'), a);
    assert.equal(sideText(mine.ops, 'after'), b);
    for (const context of [0, 2]) assert.deepEqual(hunks(mine.ops, { context }), web.hunks(theirs.ops, { context }));
  }
  assert.deepEqual(tokenize('Hi, Wonhee!'), web.tokenize('Hi, Wonhee!'));
  assert.equal(countWords('kaju katli ×2'), 3);
});

test('very long texts switch to a line diff (keeps the phone responsive)', () => {
  const long = Array.from({ length: 4000 }, (_, i) => `word${i}`).join(' ');
  const d = diffText(long, `${long} more`, { maxTokens: 6000 });
  assert.equal(d.mode, 'lines');
  assert.deepEqual(d, web.diffText(long, `${long} more`, { maxTokens: 6000 }));
});

test('diffList / diffKeys match the web module', () => {
  const a = ['!help', '!ride', { at: '18:00' }]; const b = ['!ride', '!plan', { at: '18:00' }];
  assert.deepEqual(diffList(a, b), web.diffList(a, b));
  assert.deepEqual(diffList(null, 'x'), { added: ['x'], removed: [], kept: [] });
  const x = { a: 1, b: { c: 2 }, d: 3 }; const y = { a: 1, b: { c: 3 }, e: 4 };
  assert.deepEqual(diffKeys(x, y), web.diffKeys(x, y));
});

test('text views: changes only folds unchanged lines; before / after / whole keep one side', () => {
  const [a, b] = CASES[6];
  const d = diffText(a, b);
  const changes = textBlocks(d, 'changes');
  assert.deepEqual(changes.map((x) => x.type), ['skip', 'lines', 'skip']);
  const changed = changes[1].lines.find((l) => l.mark);
  assert.equal(changed?.mark, '±');
  assert.deepEqual(changed?.segs.map((s) => [s.type, s.text]), [['eq', 'Line '], ['del', '20'], ['add', 'twenty']]);
  const after = textBlocks(d, 'after').flatMap((x) => x.lines).map((l) => l.segs.map((s) => s.text).join(''));
  assert.ok(after.includes('Line twenty') && !after.includes('Line 20'));
  const before = textBlocks(d, 'before').flatMap((x) => x.lines).map((l) => l.segs.map((s) => s.text).join(''));
  assert.ok(before.includes('Line 20') && !before.includes('Line twenty'));
  const whole = textBlocks(d, 'whole');
  assert.equal(whole.length, 1);
  assert.equal(whole[0].lines.length, 40);
});

test('review: plain headlines per kind of field, in the editor order, with word counts', () => {
  const r = review([
    { field: 'schedules', before: [{ id: 's1', at: '18:00', days: 'mon', prompt: 'Post rides' }], after: [{ id: 's1', at: '18:30', days: 'mon', prompt: 'Post rides' }, { id: 's2', at: '07:00', prompt: 'Weather' }] },
    { field: 'prompt', before: 'Be short.', after: 'Be short and kind.' },
    { field: 'organizers', before: ['+41790000001'], after: ['+41790000001', '+41790000002'] },
    { field: 'dm', before: 'organizers', after: 'anyone' },
    { field: 'tools', before: { participant: ['panduga:agenda_*'] }, after: { participant: ['panduga:agenda_*', 'panduga:menu_list'], deny: ['panduga:*_preview'] } },
    { field: 'globalMcp', before: { disabled: [] }, after: { disabled: ['weather'] } },
  ], { names: { 41790000002: 'Rupa' } });
  assert.equal(r.title, '6 changes · 5 sections');
  assert.deepEqual(r.views.map((v) => v.field), ['dm', 'prompt', 'organizers', 'globalMcp', 'tools', 'schedules']);
  assert.deepEqual(r.views.map((v) => v.head), [
    'Who may message it directly', 'Instructions: 2 words added', 'Organizers: 1 added', 'Global tool services: 1 turned off',
    'Tool rules: participants, never changed', 'Scheduled posts: 1 added, 1 changed',
  ]);
  assert.equal(r.added, 2);
  const dm = r.views[0]; assert.equal(dm.kind, 'scalar'); if (dm.kind === 'scalar') assert.deepEqual([dm.before, dm.after], ['Organizers only', 'Anyone']);
  const org = r.views[2]; if (org.kind === 'list') assert.equal(org.list.added[0].l, 'Rupa (+41790000002)');
  const sch = r.views[5]; if (sch.kind === 'list') assert.match(sch.list.added[0].l, /^07:00 every day — Weather/);
});

test('review: new or removed text, model labels, scalars', () => {
  assert.equal(changeView({ field: 'description', before: '', after: 'Rides' }).head, 'Description written');
  assert.equal(changeView({ field: 'description', before: 'Rides', after: '' }).head, 'Description removed');
  const long = changeView({ field: 'prompt', before: 'a\nb', after: 'a\nc' });
  assert.equal(long.kind === 'text' && long.switcher, true);
  assert.equal(scalar('model', 'anthropic:claude-haiku-5-5', { models: { models: [{ ref: 'anthropic:claude-haiku-5-5', provider: 'anthropic', label: 'Anthropic · Claude Haiku 5.5' }], defaultModel: 'auto' } }), 'Anthropic · Claude Haiku 5.5');
  assert.equal(scalar('model', 'openai:auto'), 'openai · Auto');
  assert.equal(scalar('memory', { enabled: false }), 'off');
  assert.equal(scalar('enabled', true), 'on');
  assert.equal(daysLabel('mon,tue,wed,thu,fri'), 'weekdays');
});
