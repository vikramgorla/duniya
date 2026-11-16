// 011–013: several WhatsApp numbers, 1:1 chats assigned to agents, model per chat, logging levels, server page.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, fakeNumbers } from './harness.js';

const ops = mkdtempSync(join(tmpdir(), 'duniya-ops-'));
mkdirSync(join(ops, 'req')); mkdirSync(join(ops, 'state'));
writeFileSync(join(ops, 'helper'), '#!/bin/sh\n');
const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100', DUNIYA_OPS_HELPER: join(ops, 'helper'), DUNIYA_OPS_REQUEST_DIR: join(ops, 'req'), DUNIYA_OPS_STATE_DIR: join(ops, 'state') } });
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
const admin = await t.login('ada', 'admin password 123');
after(() => t.close());

// Fake sessions for the registry: one per number.
const sessions = {};
const fakeFactory = fakeNumbers(sessions, (s) => ({
  async chatName() { return `${s.label} group`; },
  async listChats() { return [{ id: `g-${s.number}@g.us`, name: `${s.label} group`, size: 3 }]; },
  async status() { return { status: 'open', me: `4179000${s.number.length}:1@s.whatsapp.net`, since: 1 }; },
  async pair() { return 'ABCD-1234'; }, async logout() {}, async restart() {}, async remove() { s.removed = true; },
}));
const { createChannelRegistry } = await import('../src/channels/registry.js');
const { splitChat, chatKey } = await import('../src/core/direct-chats.js');
const reg = createChannelRegistry({ factory: fakeFactory });
const msg = (o) => ({ channel: 'whatsapp', raw: {}, isGroup: false, chat: '41790000555@s.whatsapp.net', phone: '41790000555', senderJid: 'x', senderName: 'Stranger', mentioned: false, replyToAgent: false, quoted: '', msgId: `m${Math.random()}`, ts: Date.now(), ...o });

test('012: chat ids — first number unchanged, others prefixed', () => {
  assert.equal(chatKey('main', 'g1@g.us'), 'g1@g.us');
  assert.equal(chatKey('shop', 'g1@g.us'), 'shop#g1@g.us');
  assert.deepEqual(splitChat('shop#g1@g.us'), { number: 'shop', jid: 'g1@g.us' });
  assert.deepEqual(splitChat('g1@g.us'), { number: 'main', jid: 'g1@g.us' });
});

test('012: add a second number; messages route to the right session; status lists both', async () => {
  await reg.start(t.router.createRouter(reg), { onHistory: async () => {} });
  const n = await reg.addNumber({ id: 'shop', label: 'Shop' });
  assert.equal(n.id, 'shop');
  await assert.rejects(reg.addNumber({ id: 'shop' }), /already used/);
  await assert.rejects(reg.addNumber({ id: 'Bad Id!' }), /lowercase/);
  const st = await reg.status();
  assert.deepEqual(st.numbers.map((x) => x.id), ['main', 'shop']);
  const chats = await reg.listChats();
  assert.ok(chats.some((c) => c.id === 'shop#g-shop@g.us' && c.numberLabel === 'Shop'));

  // bind the shop group to the helper agent and talk to it there
  await t.agents.updateAgent('helper', { chats: ['shop#g-shop@g.us'] });
  t.script.push([{ type: 'text', text: 'Hello from the shop number' }]);
  await sessions.shop.handler(msg({ isGroup: true, chat: 'g-shop@g.us', phone: '41790000001', text: '!help hi' }));
  assert.equal(sessions.shop.sent.at(-1).text, 'Hello from the shop number');
  assert.equal(sessions.shop.sent.at(-1).jid, 'g-shop@g.us', 'sent with the plain WhatsApp id on the right session');
  assert.equal(sessions.main.sent.length, 0);
});

test('013: a 1:1 chat assigned to an agent is answered (even when its DM policy would not); others are not', async () => {
  const stranger = 'shop#41790000555@s.whatsapp.net';
  t.script.push([{ type: 'text', text: 'should not be used' }]);
  await sessions.shop.handler(msg({ text: 'hello?' }));
  assert.equal(sessions.shop.sent.length, 1, 'helper agent only answers organizers in DMs');
  t.script.length = 0;
  await t.agents.updateAgent('helper', { chats: ['shop#g-shop@g.us', stranger] });
  t.script.push([{ type: 'text', text: 'Hi, I can help.' }]);
  await sessions.shop.handler(msg({ text: 'hello again' }));
  assert.equal(sessions.shop.sent.at(-1).text, 'Hi, I can help.');
  assert.equal(sessions.shop.sent.at(-1).jid, '41790000555@s.whatsapp.net');
  // the person shows up on the Chats page with their number, bound to the agent
  const chats = (await t.api(owner, 'GET', '/api/chats')).body;
  const row = chats.find((c) => c.id === stranger);
  assert.ok(row, 'seen 1:1 chat listed');
  assert.equal(row.isGroup, false); assert.equal(row.agent, 'helper'); assert.equal(row.number, 'shop'); assert.equal(row.name, 'Stranger');
});

test('013: model per chat — specific model, provider:auto, back to inherit', async () => {
  const chat = 'g1@g.us';
  const bad = await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent(chat)}/prefs`, { model: 'not a model' });
  assert.equal(bad.status, 400);
  assert.equal((await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent(chat)}/prefs`, { model: 'anthropic:claude-haiku-5-5' })).status, 200);
  t.script.push([{ type: 'text', text: 'haiku here' }]);
  let n = t.claudeReqs.length;
  await t.route(t.msg({ text: '!panduga hi' }));
  assert.equal(t.claudeReqs[n].model, 'claude-haiku-5-5');
  await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent(chat)}/prefs`, { model: 'anthropic:auto' });
  t.script.push([{ type: 'text', text: 'auto here' }]);
  n = t.claudeReqs.length;
  await t.route(t.msg({ text: '!panduga hi again' }));
  assert.equal(t.claudeReqs[n].model, 'claude-sonnet-5-5', 'provider:auto = that provider’s recommended model');
  await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent(chat)}/prefs`, { model: 'inherit' });
  const row = (await t.api(owner, 'GET', '/api/chats')).body.find((c) => c.id === chat);
  assert.equal(row.model, 'inherit');
});

test('011: logging levels, categories and per-chat override; errors and config always kept', async () => {
  const count = (type, since) => t.db.listActivity({ limit: 1000 }).filter((a) => a.type === type && a.ts >= since).length;
  let since = Date.now();
  assert.equal((await t.api(owner, 'PUT', '/api/logging', { level: 'minimal' })).body.level, 'minimal');
  t.script.push([{ type: 'text', text: 'quiet' }]);
  await t.route(t.msg({ text: '!panduga quiet please' }));
  assert.equal(count('message.in', since), 0, 'minimal: no message entries');
  t.events.activity('error', { summary: 'boom' });
  assert.equal(count('error', since), 1, 'errors always kept');
  assert.ok(count('config', since) >= 1, 'config changes always kept');

  await t.api(owner, 'PUT', '/api/logging', { level: 'normal', categories: { messages: false } });
  since = Date.now();
  t.script.push([{ type: 'text', text: 'no messages' }]);
  await t.route(t.msg({ text: '!panduga again' }));
  assert.equal(count('message.in', since), 0, 'category off');
  assert.equal(count('model.usage', since), 1, 'other categories still on');

  await t.api(owner, 'PUT', '/api/logging', { level: 'normal', categories: { messages: true } });
  await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent('g1@g.us')}/prefs`, { logging: 'off' });
  since = Date.now();
  t.script.push([{ type: 'text', text: 'chat off' }]);
  await t.route(t.msg({ text: '!panduga third' }));
  assert.equal(count('message.in', since) + count('model.usage', since), 0, 'chat override: off');
  await t.api(owner, 'PUT', `/api/chats/${encodeURIComponent('g1@g.us')}/prefs`, { logging: 'inherit' });
  assert.equal((await t.api(admin, 'PUT', '/api/logging', { level: 'verbose' })).status, 200, 'admins may change logging');
  assert.equal((await t.api(owner, 'GET', '/api/logging')).body.settings.level, 'verbose');
  await t.api(owner, 'PUT', '/api/logging', { level: 'normal' });
});

test('011: server metrics, OS updates, logs; maintenance is owner-only and only allowed actions', async () => {
  const s = (await t.api(admin, 'GET', '/api/system')).body;
  assert.ok(s.memory.total > 0 && s.cpus > 0 && Array.isArray(s.load));
  assert.equal(s.ops, true);
  assert.ok(['oci', 'gcp', 'docker', 'server', 'unknown'].includes(s.hosting?.provider), 'hosting guide hint (#56)');
  assert.ok(Array.isArray((await t.api(admin, 'GET', '/api/system/history')).body));
  assert.equal((await t.api(admin, 'GET', '/api/system/logs?unit=sshd')).status, 400, 'only our services');
  assert.equal((await t.api(admin, 'POST', '/api/system/ops', { action: 'os-update' })).status, 403, 'owner only');
  assert.equal((await t.api(owner, 'POST', '/api/system/ops', { action: 'rm -rf /' })).status, 400);
  const r = await t.api(owner, 'POST', '/api/system/ops', { action: 'os-update' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(readFileSync(join(ops, 'req', 'request'), 'utf8'), 'os-update\n');
  writeFileSync(join(ops, 'state', 'status.json'), JSON.stringify({ action: 'os-update', state: 'running', startedAt: Date.now() }));
  assert.equal((await t.api(owner, 'POST', '/api/system/ops', { action: 'reboot' })).status, 409, 'one at a time');
  const st = (await t.api(owner, 'GET', '/api/system/ops')).body;
  assert.equal(st.status.state, 'running');
  assert.ok(st.actions['os-update'] && existsSync(join(ops, 'req')));
});

test('012: remove a number', async () => {
  await assert.rejects(reg.removeNumber('main'), /unlinked, not removed/);
  await reg.removeNumber('shop');
  assert.equal(sessions.shop.removed, true);
  assert.deepEqual((await reg.status()).numbers.map((x) => x.id), ['main']);
});

test('#56: hosting is detected from the install kind, the VM\'s DMI strings, or DUNIYA_HOST', async () => {
  const { detectHosting } = await import('../src/core/system.js');
  const dmi = (files) => { const d = mkdtempSync(join(tmpdir(), 'duniya-dmi-')); for (const [f, v] of Object.entries(files)) writeFileSync(join(d, f), `${v}\n`); return d; };
  assert.equal(detectHosting({ env: { DUNIYA_INSTALL: 'systemd' }, dmiDir: dmi({ chassis_asset_tag: 'OracleCloud.com', sys_vendor: 'QEMU' }) }).provider, 'oci');
  assert.equal(detectHosting({ env: { DUNIYA_INSTALL: 'systemd' }, dmiDir: dmi({ product_name: 'Google Compute Engine', sys_vendor: 'Google' }) }).provider, 'gcp');
  assert.equal(detectHosting({ env: { DUNIYA_INSTALL: 'systemd' }, dmiDir: dmi({ sys_vendor: 'Hetzner' }) }).provider, 'server');
  assert.equal(detectHosting({ env: {}, dmiDir: dmi({}) }).provider, 'unknown', 'no install kind, no cloud: show every guide');
  assert.equal(detectHosting({ env: { DUNIYA_INSTALL: 'docker' }, dmiDir: dmi({ chassis_asset_tag: 'OracleCloud.com' }) }).provider, 'docker', 'Docker wins: its guide is the one that applies');
  const forced = detectHosting({ env: { DUNIYA_INSTALL: 'systemd', DUNIYA_HOST: 'GCP' }, dmiDir: dmi({ chassis_asset_tag: 'OracleCloud.com' }) });
  assert.deepEqual([forced.provider, forced.detected], ['gcp', false]);
  assert.equal(detectHosting({ env: { DUNIYA_HOST: 'other' }, dmiDir: dmi({}) }).provider, 'server');
  assert.equal(detectHosting({ env: { DUNIYA_HOST: 'nonsense', DUNIYA_INSTALL: 'systemd' }, dmiDir: dmi({}) }).provider, 'server', 'unknown override is ignored');
});
