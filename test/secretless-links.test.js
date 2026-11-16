// 060 (#121): secrets never pass through chats or models — one-time secret links, sign-up links for new users,
// restores with the stored passphrase, and pasted keys refused by the owner assistant.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ env: { RATE_LIMIT_PER_MIN: '100', PUBLIC_URL: 'https://panel.example.test' } });
const owner = await t.login();
t.store.createUser({ username: 'ada', role: 'admin', password: 'admin password 123' });
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const admin = await t.login('ada', 'admin password 123');
const viewer = await t.login('vera', 'viewer password 123');
after(() => t.close());

const OWNER_PHONE = '41790000001';
const ownerDm = `${OWNER_PHONE}@s.whatsapp.net`;
const dm = (text) => t.msg({ isGroup: false, chat: ownerDm, phone: OWNER_PHONE, senderName: 'Vik', text });
const lastTo = (chat) => t.sent.filter((m) => m.chat === chat).at(-1)?.text || '';
const tokenOf = (url, kind) => new RegExp(`^https://panel\\.example\\.test/#${kind}=([a-f0-9]{64})$`).exec(url)?.[1];
const expireAll = (kind) => t.db.db.prepare('UPDATE ttl_state SET expires = ? WHERE kind = ?').run(Date.now() - 1000, `link:${kind}`);
const activityText = () => JSON.stringify(t.db.listActivity({ limit: 500 }));
const anon = async (method, path, body) => {
  const r = await fetch(t.base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};

// link the owner's WhatsApp number to the owner assistant
const { code } = (await t.api(owner, 'POST', '/api/owner-assistant/link')).body;
await t.route(dm(`link ${code}`));
await t.api(owner, 'POST', '/api/owner-assistant/link/confirm');

test('060: secret link — admin+ only, single use, 15 min expiry, value saved and never shown or logged', async () => {
  assert.equal((await t.api(viewer, 'POST', '/api/secret-links', { name: 'NEW_KEY' })).status, 403);
  assert.equal((await t.api(admin, 'POST', '/api/secret-links', { name: 'bad name' })).status, 400);
  const r = (await t.api(admin, 'POST', '/api/secret-links', { name: 'NEW_KEY' })).body;
  assert.equal(r.for, 'NEW_KEY');
  assert.ok(r.expiresAt - Date.now() <= 15 * 60000 && r.expiresAt - Date.now() > 14 * 60000);
  const token = tokenOf(r.link, 'secret');
  assert.ok(token, r.link);
  assert.ok(!JSON.stringify(t.db.db.prepare('SELECT * FROM ttl_state').all()).includes(token), 'only a hash is stored');
  // the page needs a panel session of an owner or admin
  assert.equal((await anon('GET', `/api/secret-links/${token}`)).status, 401);
  assert.equal((await t.api(viewer, 'GET', `/api/secret-links/${token}`)).status, 403);
  assert.equal((await t.api(owner, 'GET', `/api/secret-links/${token}`)).body.askedBy, 'ada');
  assert.equal((await t.api(owner, 'POST', `/api/secret-links/${token}`, { value: '  ' })).status, 400);
  assert.equal((await t.api(owner, 'POST', `/api/secret-links/${token}`, { value: 'sk-very-secret-value-123' })).body.saved, 'NEW_KEY');
  assert.equal(t.store.getSecret('NEW_KEY'), 'sk-very-secret-value-123');
  assert.equal((await t.api(owner, 'POST', `/api/secret-links/${token}`, { value: 'again' })).status, 404, 'single use');
  assert.equal((await t.api(owner, 'GET', `/api/secret-links/${'0'.repeat(64)}`)).status, 404, 'unknown token');
  assert.ok(!activityText().includes('sk-very-secret-value-123'), 'never logged');
  // expiry
  const old = tokenOf((await t.api(admin, 'POST', '/api/secret-links', { name: 'OTHER_KEY' })).body.link, 'secret');
  expireAll('secret');
  assert.equal((await t.api(admin, 'POST', `/api/secret-links/${old}`, { value: 'late-value-123' })).status, 404);
  assert.equal(t.store.getSecret('OTHER_KEY'), '');
});

test('060: secret link for a model account key goes through the account key route', async () => {
  assert.equal((await t.api(admin, 'POST', '/api/secret-links', { account: 'nope' })).status, 404);
  const r = (await t.api(admin, 'POST', '/api/secret-links', { account: 'anthropic' })).body;
  assert.match(r.for, /API key of Anthropic/);
  await t.api(admin, 'POST', `/api/secret-links/${tokenOf(r.link, 'secret')}`, { value: 'sk-ant-new-key-0001' });
  assert.equal(t.store.getSecret('ANTHROPIC_API_KEY'), 'sk-ant-new-key-0001');
  t.store.setSecret('ANTHROPIC_API_KEY', 'test');
});

test('060: owner assistant — set_secret gives the link verbatim, runs without a confirm code, "saved" comes back to WhatsApp', async () => {
  t.script.push([{ type: 'tool_use', id: 's1', name: 'set_secret', input: { name: 'OPENAI_API_KEY' } }], [{ type: 'text', text: 'Open the link to paste the key.' }]);
  await t.route(dm('set the openai key'));
  const reply = lastTo(ownerDm);
  const url = /https:\/\/panel\.example\.test\/#secret=[a-f0-9]{64}/.exec(reply)?.[0];
  assert.ok(url, reply);
  assert.doesNotMatch(reply, /confirm [A-Z2-9]{4}/);
  await t.api(owner, 'POST', `/api/secret-links/${tokenOf(url, 'secret')}`, { value: 'sk-proj-abcdef0123456789' });
  assert.equal(t.store.getSecret('OPENAI_API_KEY'), 'sk-proj-abcdef0123456789');
  assert.equal(lastTo(ownerDm), 'Saved OPENAI_API_KEY. The value never passed through this chat.');
  assert.ok(!JSON.stringify(t.claudeReqs).includes('sk-proj-abcdef0123456789'), 'the value never reached a model');
});

test('060: a pasted key or password never reaches the model, the history or the log', async () => {
  const n = t.claudeReqs.length;
  for (const text of ['here: sk-ant-api03-AbCdEf0123456789xyz', 'the password is Hunter2Hunter2', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789']) {
    await t.route(dm(text));
    assert.match(lastTo(ownerDm), /looks like a key or password/);
  }
  assert.equal(t.claudeReqs.length, n, 'no model call');
  const oa = await import('../src/core/owner-assistant.js');
  assert.ok(!oa.ownerHistory(1, 'whatsapp', 100).some((m) => /Hunter2|sk-ant-api03|ghp_/.test(m.text)));
  assert.ok(!/Hunter2|sk-ant-api03|ghp_abc/.test(activityText()));
  // the panel Ask box too; ordinary messages with links or ids still go to the model
  assert.match((await t.api(owner, 'POST', '/api/owner/ask', { question: 'token: abc123def456ghi' })).body.reply, /looks like a key/);
  t.script.push([{ type: 'text', text: 'ok' }]);
  await t.route(dm('what happened in https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv12345 yesterday?'));
  assert.equal(lastTo(ownerDm), 'ok');
});

test('060: add_user without a password — sign-up link through confirm, single use, sets the password and signs in', async () => {
  t.script.push([{ type: 'tool_use', id: 'u1', name: 'add_user', input: { username: 'anu', role: 'admin' } }], [{ type: 'text', text: 'Ready to add Anu.' }]);
  await t.route(dm('add anu as admin'));
  const c = /confirm ([A-Z2-9]{4})/.exec(lastTo(ownerDm))[1];
  assert.equal(t.store.listUsers().some((u) => u.username === 'anu'), false, 'not before confirm');
  const nModel = t.claudeReqs.length;
  await t.route(dm(`confirm ${c}`));
  const done = lastTo(ownerDm);
  assert.match(done, /^Done/);
  const token = tokenOf(done.split('\n').at(-1), 'signup');
  assert.ok(token, done);
  assert.equal(t.claudeReqs.length, nModel, 'the link goes to the user, not to a model');
  const anu = t.store.listUsers().find((u) => u.username === 'anu');
  assert.equal(anu.role, 'admin');
  assert.equal(anu.hasPassword, false);

  const look = await anon('GET', `/api/signup/${token}`);
  assert.deepEqual([look.body.username, look.body.role], ['anu', 'admin']);
  assert.ok(look.body.expiresAt - Date.now() > 47 * 3600000);
  assert.equal((await anon('POST', `/api/signup/${token}`, { password: 'short' })).status, 400);
  const ok = await anon('POST', `/api/signup/${token}`, { password: 'anu chose this one' });
  assert.equal(ok.status, 200);
  assert.equal((await t.api(ok.cookie, 'GET', '/api/session')).body.user.username, 'anu', 'signed in');
  assert.equal((await anon('POST', `/api/signup/${token}`, { password: 'someone else 12345' })).status, 404, 'single use');
  assert.ok(await t.login('anu', 'anu chose this one'));
  assert.ok(!activityText().includes('anu chose this one'));
});

test('060: sign-up links — owner only, a new link replaces the old, expiry, deleted users, password sign-in off', async () => {
  assert.equal((await t.api(admin, 'POST', '/api/users', { username: 'bo', role: 'viewer' })).status, 403, 'same role limits as before');
  const r = (await t.api(owner, 'POST', '/api/users', { username: 'bo', role: 'viewer', noPassword: false })).body;
  const first = tokenOf(r.signup.link, 'signup');
  const second = tokenOf((await t.api(owner, 'POST', `/api/users/${r.id}/signup-link`)).body.link, 'signup');
  assert.equal((await anon('GET', `/api/signup/${first}`)).status, 404, 'older link stops working');
  assert.equal((await anon('GET', `/api/signup/${second}`)).status, 200);
  expireAll('signup');
  assert.equal((await anon('GET', `/api/signup/${second}`)).status, 404, 'expired');
  // deleted user: the link does nothing
  const third = tokenOf((await t.api(owner, 'POST', `/api/users/${r.id}/signup-link`)).body.link, 'signup');
  await t.api(owner, 'DELETE', `/api/users/${r.id}`);
  assert.equal((await anon('POST', `/api/signup/${third}`, { password: 'a long password 1' })).status, 404);
  // with a password the old way still works (panel)
  assert.equal((await t.api(owner, 'POST', '/api/users', { username: 'cy', role: 'viewer', password: 'cy password 12345' })).body.signup, undefined);
  // admins do not get the user tools in the owner assistant
  t.script.push([{ type: 'text', text: 'hi' }]);
  await t.api(admin, 'POST', '/api/owner/ask', { question: 'hi' });
  const names = t.claudeReqs.at(-1).tools.map((x) => x.name);
  assert.ok(!names.includes('add_user') && !names.includes('send_signup_link'));
});

test('060: restore_backup uses the stored passphrase; a backup that does not open points to the panel', async () => {
  // no stored passphrase: refused with the Backups link
  const none = await t.api(owner, 'POST', '/api/backups/restore', { source: 'local', file: 'x.dbk', check: true });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /https:\/\/panel\.example\.test\/#backups/);
  await t.api(owner, 'PUT', '/api/backups/passphrase', { passphrase: 'first passphrase 123' });
  const old = (await t.api(owner, 'POST', '/api/backups/run')).body.file;
  await t.api(owner, 'PUT', '/api/backups/passphrase', { passphrase: 'second passphrase 123' });
  await new Promise((r) => setTimeout(r, 1100)); // backup file names have one-second resolution
  const cur = (await t.api(owner, 'POST', '/api/backups/run')).body.file;

  // a backup made with another passphrase: the preview fails with the panel link, nothing is held
  t.script.push([{ type: 'tool_use', id: 'r1', name: 'restore_backup', input: { source: 'local', file: old } }], [{ type: 'text', text: 'Use the panel.' }]);
  await t.route(dm('restore the older backup'));
  const res = t.claudeReqs.at(-1).messages.at(-1).content.find((b) => b.type === 'tool_result');
  assert.ok(res.is_error && /does not open with this server's backup passphrase.*#backups/.test(res.content), res.content);
  assert.doesNotMatch(lastTo(ownerDm), /confirm [A-Z2-9]{4}/);

  // this server's backup: preview with its date, confirm code, restore + restart
  t.script.push([{ type: 'tool_use', id: 'r2', name: 'restore_backup', input: { source: 'local', file: cur } }], [{ type: 'text', text: 'Ready to restore.' }]);
  await t.route(dm('restore the latest backup'));
  const text = lastTo(ownerDm);
  assert.match(text, new RegExp(`Restore backup ${cur.replace('.', '\\.')} from local \\(made \\d{4}-`));
  const c = /confirm ([A-Z2-9]{4})/.exec(text)[1];
  assert.equal(t.restarts, 0);
  await t.route(dm(`confirm ${c}`));
  assert.match(lastTo(ownerDm), /^Done/);
  assert.equal(t.restarts, 1);
  assert.ok(!JSON.stringify(t.claudeReqs).includes('second passphrase'), 'the passphrase never reached a model');
});
