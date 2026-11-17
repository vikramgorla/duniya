// #65: per-chat model fallback chain edited in the panel (Chats → Fallback…) and through the admin MCP tool
// set_chat_settings — both store the same { mode, chain } override.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup } from './harness.js';

const t = await setup();
const owner = await t.login();
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vera', 'viewer password 123');
const { TOOLS } = await import('../src/panel/admin-tools.js');
after(() => t.close());

const CHAT = 'g1@g.us';
const prefsUrl = `/api/chats/${encodeURIComponent(CHAT)}/prefs`;
const chatRow = async () => (await t.api(owner, 'GET', '/api/chats')).body.find((c) => c.id === CHAT);
const tool = (name) => TOOLS.find((x) => x.name === name);
const ctx = (cookie) => ({ call: async (m, p, b) => { const r = await t.api(cookie, m, p, b); if (r.status >= 400) throw new Error(r.body.error); return r.body; } });

test('#65: the panel editor saves an ordered chain with the mode; the Chats list returns it', async () => {
  const r = await t.api(owner, 'PUT', prefsUrl, { fallback: { mode: 'on', chain: ['openai:auto', 'anthropic:claude-haiku-5-5'] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.fallback, { mode: 'on', chain: ['openai:auto', 'anthropic:claude-haiku-5-5'] });
  assert.deepEqual((await chatRow()).fallback, r.body.fallback);
  // "As the agent" with its own list is allowed (the picker's "Own list of models for this chat")
  assert.deepEqual((await t.api(owner, 'PUT', prefsUrl, { fallback: { mode: 'inherit', chain: ['openai:auto'] } })).body.fallback, { mode: 'inherit', chain: ['openai:auto'] });
  // the picker sends an empty chain for "Don't switch"
  assert.deepEqual((await t.api(owner, 'PUT', prefsUrl, { fallback: { mode: 'off', chain: [] } })).body.fallback, { mode: 'off', chain: [] });
  const act = t.db.listActivity({ limit: 20 }).find((a) => a.type === 'config' && /fallback/.test(a.summary));
  assert.match(act.summary, /fallback off/);
});

test('#65: bad chains are refused with the field; viewers cannot change it', async () => {
  const bad = await t.api(owner, 'PUT', prefsUrl, { fallback: { mode: 'on', chain: ['not a model'] } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'fallback.chain');
  const many = await t.api(owner, 'PUT', prefsUrl, { fallback: { mode: 'on', chain: Array.from({ length: 11 }, (_, i) => `p${i}:auto`) } });
  assert.equal(many.status, 400);
  assert.equal((await t.api(viewer, 'PUT', prefsUrl, { fallback: { mode: 'on', chain: [] } })).status, 403);
});

test('#65: set_chat_settings stores the same shape, and a partial change keeps the other half', async () => {
  const set = tool('set_chat_settings');
  assert.ok(set.calls.some(([m, p]) => m === 'GET' && p === '/api/chats'), 'declares the read it needs');
  await set.run({ chat: CHAT, fallback_mode: 'on', fallback_chain: ['openai:auto', 'anthropic:auto'] }, ctx(owner));
  assert.deepEqual((await chatRow()).fallback, { mode: 'on', chain: ['openai:auto', 'anthropic:auto'] });
  await set.run({ chat: CHAT, fallback_chain: ['anthropic:auto'] }, ctx(owner));
  assert.deepEqual((await chatRow()).fallback, { mode: 'on', chain: ['anthropic:auto'] }, 'mode kept');
  await set.run({ chat: CHAT, fallback_mode: 'inherit' }, ctx(owner));
  assert.deepEqual((await chatRow()).fallback, { mode: 'inherit', chain: ['anthropic:auto'] }, 'chain kept');
  await set.run({ chat: CHAT, model: 'auto' }, ctx(owner));
  assert.deepEqual((await chatRow()).fallback, { mode: 'inherit', chain: ['anthropic:auto'] }, 'untouched without fallback args');
  await assert.rejects(set.run({ chat: CHAT, fallback_mode: 'on' }, ctx(viewer)), /Read-only|Requires/);
});

test('#65: the Chats page uses the shared picker and chain editor (no separate select)', () => {
  const html = ['fallback.js', 'chats.js'].map((f) => readFileSync(new URL(`../src/panel/public/app/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.match(html, /function chatFallbackEditor\(c, models[^)]*\) \{\n\s+const pick = fallbackPicker\(models, c\.fallback, \{ what: 'chat'/);
  assert.doesNotMatch(html, /'If unavailable: switch model'\], \['off'/, 'the old one-line select is gone');
  assert.match(html, /openFallback\(c\)/);
});
