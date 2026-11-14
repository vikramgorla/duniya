// Feature 005: first-run setup code and migration of pre-005 file-based installs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './harness.js';

let t;
before(async () => {
  t = await setup({
    env: { ADMIN_PASSWORD: '' },
    legacy: (tmp) => {
      const dir = join(tmp, 'legacy-bots', 'oldbot');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'bot.json'), JSON.stringify({ name: 'Old bot', triggers: ['!old'], dm: 'members', tools: { participant: ['svc:read'], organizer: ['svc:*'] }, mcpServers: { svc: { url: '${SVC_URL}' } } }));
      writeFileSync(join(dir, 'prompt.md'), 'You are the old bot.');
      writeFileSync(join(dir, 'index.js'), "export default { onMessage: ({ msg }) => (msg.text === '!old ping' ? 'old pong' : undefined) };");
      mkdirSync(join(tmp, 'legacy-bots', '_template'));
      writeFileSync(join(tmp, 'legacy-bots', '_template', 'bot.json'), '{"name":"ignored"}');
      mkdirSync(join(tmp, 'data', 'bots'), { recursive: true });
      writeFileSync(join(tmp, 'data', 'bots', 'oldbot.json'), JSON.stringify({ chats: ['g1@g.us'], organizers: ['+41 79 000 00 01'], extraPrompt: 'Be brief.' }));
      writeFileSync(join(tmp, 'data', 'secrets.json'), JSON.stringify({ SVC_URL: 'https://svc.example/mcp', ANTHROPIC_API_KEY: 'test' }));
      writeFileSync(join(tmp, 'data', 'settings.json'), JSON.stringify({ paused: false, defaultDmBot: 'oldbot' }));
    },
  });
});
after(() => t.close());

test('US3: legacy bots, overrides, secrets and settings are migrated once', async () => {
  const bots = t.bots.listBots();
  assert.deepEqual(bots.map((b) => b.id), ['oldbot']);
  const b = bots[0];
  assert.equal(b.name, 'Old bot');
  assert.match(b.prompt, /You are the old bot\.\n\nBe brief\./);
  assert.deepEqual([b.chats, b.organizers, b.plugins], [['g1@g.us'], ['41790000001'], ['oldbot']]);
  assert.equal(t.store.getSecret('SVC_URL'), 'https://svc.example/mcp');
  assert.ok(!existsSync(join(t.tmp, 'data', 'secrets.json')), 'plaintext secrets file removed');
  assert.equal(t.store.getSettings().defaultDmBot, 'oldbot');
  await t.route(t.msg({ text: '!old ping' }));
  assert.equal(t.sent.at(-1).text, 'old pong', 'legacy hooks still work as a plugin');
  await t.bots.loadBots();
  assert.equal(t.bots.listBots().length, 1, 'not imported twice');
});

test('US4: first owner needs the setup code', async () => {
  const s = await t.api('', 'GET', '/api/session');
  assert.equal(s.body.needsSetup, true);
  const code = readFileSync(join(t.tmp, 'data', 'setup-code.txt'), 'utf8').trim();
  assert.equal((await t.api('', 'POST', '/api/setup', { code: 'WRONGCODE1', username: 'vik', password: 'a-strong-password' })).status, 403);
  const ok = await fetch(`${t.base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.toLowerCase(), username: 'vik', password: 'a-strong-password' }) });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await t.api(cookie, 'GET', '/api/users')).body[0].role, 'owner');
  assert.ok(!existsSync(join(t.tmp, 'data', 'setup-code.txt')), 'setup code removed');
  assert.equal((await t.api('', 'POST', '/api/setup', { code, username: 'x', password: 'another-password' })).status, 409);
});
