// Feature 005: agents, users and secrets managed in the app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './harness.js';

let t; let owner;
before(async () => { t = await setup(); owner = await t.login(); });
after(() => t.close());

test('US1: create an agent from a template, edit it, validation errors save nothing', async () => {
  const templates = (await t.api(owner, 'GET', '/api/templates')).body;
  assert.deepEqual(templates.map((x) => x.id).sort(), ['blank', 'carpool', 'event-planning', 'family', 'neighbours', 'office-colleagues', 'school-friends']);
  assert.equal(templates[0].id, 'blank', 'blank first');
  const created = await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Carpool Helper' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 'carpool-helper');
  assert.equal(created.body.config.model, 'auto');

  const edit = await t.api(owner, 'PUT', '/api/agents/carpool-helper', { triggers: ['!Carpool'], organizers: ['+41 79 111 22 33'], schedules: [{ id: 'daily', at: '07:30', days: 'mon,fri', prompt: 'Post today’s rides' }] });
  assert.equal(edit.status, 200);
  assert.deepEqual(edit.body.config.triggers, ['!carpool']);
  assert.deepEqual(edit.body.config.organizers, ['41791112233']);

  for (const [patch, field] of [
    [{ name: '' }, 'name'], [{ schedules: [{ at: '25:00', prompt: 'x' }] }, 'schedules[1].at'],
    [{ mcpServers: { svc: { url: 'ftp://x' } } }, 'mcpServers.svc.url'], [{ mcpServers: { svc: { url: 'https://x', tokens: { organizer: 'plain-token' } } } }, 'mcpServers.svc.tokens.organizer'],
    [{ tools: { participant: ['not a rule'] } }, 'tools.participant'], [{ timezone: 'Mars/Base' }, 'timezone'],
  ]) {
    const r = await t.api(owner, 'PUT', '/api/agents/carpool-helper', patch);
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.equal(r.body.field, field);
  }
  assert.equal(t.agents.getAgent('carpool-helper').name, 'Carpool Helper', 'nothing saved on error');
});

test('US1: the confirm tool can never be allowed for the model', async () => {
  const r = await t.api(owner, 'PUT', '/api/agents/panduga', { tools: { participant: [], organizer: ['panduga:*', 'panduga:confirm'], deny: [] } });
  assert.ok(!r.body.config.tools.organizer.includes('panduga:confirm'));
  assert.ok(r.body.warnings.some((w) => /never given to the model/.test(w)));
});

test('US1: discover tools of a tool service', async () => {
  const r = await t.api(owner, 'POST', '/api/agents/panduga/discover', { server: 'panduga' });
  assert.equal(r.status, 200);
  assert.ok(r.body.some((x) => x.name === 'agenda_list'));
});

test('US1: a new agent answers in its group immediately; delete removes bindings', async () => {
  await t.api(owner, 'POST', '/api/chats/bind', { chat: 'g8@g.us', agent: 'carpool-helper' });
  t.script.push([{ type: 'text', text: 'Rides: 2 seats free.' }]);
  await t.route(t.msg({ chat: 'g8@g.us', text: '!carpool any seats?' }));
  assert.equal(t.sent.at(-1).text, 'Rides: 2 seats free.');
  assert.equal((await t.api(owner, 'DELETE', '/api/agents/carpool-helper')).status, 200);
  assert.equal(t.agents.agentForChat('g8@g.us'), undefined);
  const before = t.sent.length;
  await t.route(t.msg({ chat: 'g8@g.us', text: '!carpool hello?' }));
  assert.equal(t.sent.length, before);
});

test('US1: binding a chat to another agent moves it', async () => {
  await t.api(owner, 'POST', '/api/chats/bind', { chat: 'g1@g.us', agent: 'helper' });
  assert.equal(t.agents.agentForChat('g1@g.us').id, 'helper');
  await t.api(owner, 'POST', '/api/chats/bind', { chat: 'g1@g.us', agent: 'panduga' });
  assert.equal(t.agents.agentForChat('g1@g.us').id, 'panduga');
  assert.ok(!t.agents.getAgent('helper').chats.includes('g1@g.us'));
});

test('US2: export has no secret values or members; import gets a new id and no bindings; duplicate', async () => {
  const exp = await t.api(owner, 'GET', '/api/agents/panduga/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.body.format, 'duniya-agent');
  const text = JSON.stringify(exp.body);
  assert.ok(!text.includes('/mcp') && !text.includes('"org"'), 'no secret values');
  assert.ok(text.includes('${PANDUGA_TOKEN_ORGANIZER}'), 'secret names kept');
  assert.equal(exp.body.config.chats, undefined);
  assert.deepEqual(exp.body.secrets.sort(), ['PANDUGA_MCP_URL', 'PANDUGA_TOKEN_MEMBER', 'PANDUGA_TOKEN_ORGANIZER']);
  const imp = await t.api(owner, 'POST', '/api/agents/import', exp.body);
  assert.equal(imp.status, 201);
  assert.equal(imp.body.id, 'panduga-2');
  assert.deepEqual([imp.body.config.chats, imp.body.config.organizers], [[], []]);
  const dup = await t.api(owner, 'POST', '/api/agents/panduga/duplicate', {});
  assert.equal(dup.body.config.name, 'Panduga (copy)');
  assert.equal((await t.api(owner, 'POST', '/api/agents/import', { hello: 1 })).status, 400);
});

test('US4: roles — viewer is read-only everywhere, admin cannot manage users, last owner protected', async () => {
  const viewer = await t.api(owner, 'POST', '/api/users', { username: 'meena', role: 'viewer', password: 'viewer-password-1' });
  assert.equal(viewer.status, 200);
  await t.api(owner, 'POST', '/api/users', { username: 'ravi', role: 'admin', password: 'admin-password-12' });
  assert.equal((await t.api(owner, 'POST', '/api/users', { username: 'x', role: 'admin', password: 'short' })).status, 400);

  const v = await t.login('meena', 'viewer-password-1');
  assert.equal((await t.api(v, 'GET', '/api/agents')).status, 200);
  const mutating = [
    ['POST', '/api/agents', { template: 'blank' }], ['PUT', '/api/agents/panduga', { enabled: false }], ['DELETE', '/api/agents/helper'],
    ['POST', '/api/chats/bind', { chat: 'x', agent: null }], ['PUT', '/api/secrets', { name: 'X_Y', value: '1' }],
    ['POST', '/api/settings', { paused: true }], ['POST', '/api/whatsapp/logout'], ['POST', '/api/agents/panduga/test', { text: 'hi' }],
    ['DELETE', '/api/pending/ABCD'], ['DELETE', `/api/chats/${encodeURIComponent('g1@g.us')}/memory`], ['POST', '/api/updates/apply'],
    ['POST', '/api/users', { username: 'z', role: 'admin', password: 'zzzzzzzzzzzzzz' }],
  ];
  for (const [m, p, b] of mutating) assert.equal((await t.api(v, m, p, b)).status, 403, `${m} ${p}`);
  assert.equal((await t.api(v, 'POST', '/api/password', { current: 'viewer-password-1', next: 'viewer-password-2' })).status, 200, 'viewer can change own password');

  const a = await t.login('ravi', 'admin-password-12');
  assert.equal((await t.api(a, 'GET', '/api/users')).status, 403);
  assert.equal((await t.api(a, 'PUT', '/api/agents/helper', { description: 'by admin' })).status, 200);
  assert.equal((await t.api(a, 'POST', '/api/updates/apply')).status, 403, 'only owners update the server');

  const me = (await t.api(owner, 'GET', '/api/users')).body.find((u) => u.username === 'admin');
  assert.equal((await t.api(owner, 'PUT', `/api/users/${me.id}`, { role: 'admin' })).status, 400);
  assert.equal((await t.api(owner, 'DELETE', `/api/users/${me.id}`)).status, 400);

  const acts = (await t.api(owner, 'GET', '/api/activity?limit=500')).body;
  assert.ok(acts.some((x) => x.type === 'agent.updated' && /by ravi/.test(x.summary)), 'acting user recorded');
});

test('US4: removing a user ends their sessions', async () => {
  const users = (await t.api(owner, 'GET', '/api/users')).body;
  const ravi = users.find((u) => u.username === 'ravi');
  const a = await t.login('ravi', 'admin-password-12');
  await t.api(owner, 'DELETE', `/api/users/${ravi.id}`);
  assert.equal((await t.api(a, 'GET', '/api/agents')).status, 401);
});

test('US5: secrets are encrypted at rest and never returned', async () => {
  await t.api(owner, 'PUT', '/api/secrets', { name: 'SUPER_SECRET_VALUE_TEST', value: 'plaintext-needle-42' });
  const files = readdirSync(join(t.tmp, 'data')).map((f) => join(t.tmp, 'data', f)).filter((f) => statSync(f).isFile());
  for (const f of files) assert.ok(!readFileSync(f).includes('plaintext-needle-42'), `${f} must not contain the secret`);
  assert.equal(statSync(join(t.tmp, 'data', 'master.key')).mode & 0o777, 0o600);
  const list = (await t.api(owner, 'GET', '/api/secrets')).body;
  assert.ok(list.find((s) => s.name === 'SUPER_SECRET_VALUE_TEST').set);
  assert.ok(!JSON.stringify(list).includes('needle'));
  assert.equal(t.store.getSecret('SUPER_SECRET_VALUE_TEST'), 'plaintext-needle-42');
});

test('every shipped template is a valid agent and creates one', async () => {
  const { validateAgentConfig } = await import('../src/core/schema.js');
  for (const tpl of t.agents.listTemplates()) {
    const { config } = validateAgentConfig(t.agents.templateConfig(tpl.id));
    assert.ok(config.name && config.prompt.length > 40, tpl.id);
    assert.ok(!JSON.stringify(config).toLowerCase().includes('panduga'), `${tpl.id} is generic`);
  }
});
