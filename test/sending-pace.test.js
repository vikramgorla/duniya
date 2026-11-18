// 080: sending pace — read receipts after the read delay (chats that are on only), typing for the reply's length
// (at most 8 s), presets and validation, the daily cap of new chats (intros), admin MCP. Every wait is scaled by
// PACE_TIME_SCALE = 0.01 (1 s → 10 ms), so the ranges below are the settings' seconds × 10 ms.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

const t = await setup({ readReceipts: true, env: { PACE_TIME_SCALE: '0.01', RATE_LIMIT_PER_MIN: '100' } });
const owner = await t.login();
t.store.createUser({ username: 'vera', role: 'viewer', password: 'viewer password 123' });
const viewer = await t.login('vera', 'viewer password 123');
const { TOOLS } = await import('../src/panel/admin-tools.js');
const { upkeepTick } = await import('../src/core/upkeep.js');
after(() => t.close());

// When things happened: markRead, typing and send are stamped.
const log = [];
const stamp = (fn, inner) => async (chat, ...args) => { log.push({ fn, chat, args, at: Date.now() }); return inner?.(chat, ...args); };
t.channel.markRead = stamp('markRead', () => ({ ok: true }));
t.channel.typing = stamp('typing');
const send0 = t.channel.send;
t.channel.send = async (chat, ...a) => { log.push({ fn: 'send', chat, at: Date.now() }); return send0(chat, ...a); };
const calls = (fn, chat) => log.filter((x) => x.fn === fn && (!chat || x.chat === chat));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pace = (body) => t.api(owner, 'PUT', '/api/pace', body);
// A fixed custom pace: reads after 3–6 s (30–60 ms), 5 characters a second, no jitter.
const fixed = { gapMin: 45, gapMax: 180, cps: 5, jitter: 0, readMin: 3, readMax: 6, dailyNew: 40, hoursFrom: '09:00', hoursTo: '20:00', pauseEvery: 15, pauseMinutes: 10 };

test('080: presets map to ranges; custom ranges are validated; viewers read but cannot change', async () => {
  const d = (await t.api(viewer, 'GET', '/api/pace')).body;
  assert.equal(d.preset, 'normal');
  assert.deepEqual([d.readReceipts, d.dailyNew, d.hoursFrom, d.hoursTo, d.gapMin, d.gapMax], [true, 40, '09:00', '20:00', 45, 180], 'defaults: 40 a day, 09:00–20:00, 45 s–3 min');
  assert.equal((await t.api(viewer, 'PUT', '/api/pace', { preset: 'faster' })).status, 403);
  const c = (await pace({ preset: 'careful' })).body;
  assert.deepEqual([c.preset, c.readMin, c.readMax, c.dailyNew, c.cps], ['careful', 5, 45, 20, 4]);
  assert.equal((await pace({ preset: 'turbo' })).status, 400);
  for (const [bad, field] of [[{ readMin: 30, readMax: 10 }, 'readMin'], [{ gapMin: 1 }, 'gapMin'], [{ cps: 50 }, 'cps'], [{ hoursFrom: '9am' }, 'hoursFrom'], [{ hoursFrom: '10:00', hoursTo: '10:00' }, 'hoursTo'], [{ dailyNew: 0 }, 'dailyNew']]) {
    const r = await pace({ custom: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.field, field);
  }
  const custom = (await pace({ custom: { dailyNew: 12 } })).body;
  assert.deepEqual([custom.preset, custom.dailyNew, custom.readMin], ['custom', 12, 5], 'custom starts from the pace in force');
  assert.ok(custom.example.days >= 1 && custom.example.minutes > 0, 'how long a list of 100 takes');
});

test('080: an answered message is read within the read range, then typing shows, then the reply goes out', async () => {
  await pace({ preset: 'custom', readReceipts: true, custom: fixed });
  log.length = 0;
  t.script.push([{ type: 'text', text: 'Twenty characters ok' }]); // 20 characters at 5/s = 4 s typing (40 ms)
  const t0 = Date.now();
  await t.route(t.msg({ text: '!panduga when is the puja?' }));
  const [read] = calls('markRead', 'g1@g.us');
  const [typing] = calls('typing', 'g1@g.us');
  const [sent] = calls('send', 'g1@g.us');
  assert.ok(read && typing && sent, JSON.stringify(log));
  assert.ok(read.at - t0 >= 28 && read.at - t0 <= 60 + 40, `read after ${read.at - t0} ms (range 30–60)`);
  assert.equal(read.args[0][0].participant, 'x', 'group receipts name the sender');
  assert.ok(typing.at >= read.at, 'typing only after the message is read');
  assert.ok(sent.at - typing.at >= 38, `typed for ${sent.at - typing.at} ms (4 s × 10 ms)`);
});

test('080: messages the agent leaves alone are read later (next message or the upkeep tick); chats that are off never', async () => {
  log.length = 0;
  t.chatPrefs.setChatPrefs('g9@g.us', { enabled: false });
  await t.route(t.msg({ text: 'just chatting' })); // g1, not addressed
  await t.route(t.msg({ chat: 'g9@g.us', text: 'in a chat that is off' }));
  assert.equal(calls('markRead').length, 0, 'not before the read delay');
  await sleep(80);
  const r = await upkeepTick(t.channel);
  assert.equal(r.reads, 1, 'the tick sends the due receipt');
  assert.equal(calls('markRead', 'g1@g.us').length, 1);
  await t.route(t.msg({ chat: 'g9@g.us', text: 'again' }));
  await sleep(80); await upkeepTick(t.channel);
  assert.equal(calls('markRead', 'g9@g.us').length, 0, 'a chat that is off is never marked read');
  // queued, then switched off before the receipt was due: dropped
  await t.route(t.msg({ chat: 'g3@g.us', text: 'hello' }));
  t.chatPrefs.setChatPrefs('g3@g.us', { enabled: false });
  await sleep(80); await upkeepTick(t.channel);
  assert.equal(calls('markRead', 'g3@g.us').length, 0);
  t.chatPrefs.setChatPrefs('g3@g.us', { enabled: true });
});

test('080: read receipts off → nothing is marked read; typing stays within 8 s for long replies', async () => {
  await pace({ readReceipts: false });
  log.length = 0;
  t.script.push([{ type: 'text', text: 'x'.repeat(3000) }]); // 600 s at 5/s → capped at 8 s (80 ms)
  await t.route(t.msg({ text: '!panduga tell me everything' }));
  await sleep(80); await upkeepTick(t.channel);
  assert.equal(calls('markRead').length, 0);
  const [typing] = calls('typing', 'g1@g.us'); const [sent] = calls('send', 'g1@g.us');
  assert.ok(sent.at - typing.at >= 75 && sent.at - typing.at < 80 + 120, `typed for ${sent.at - typing.at} ms (cap 80)`);
  await pace({ readReceipts: true });
});

test('080: intros count toward the daily cap of new chats; the admin MCP reads and sets the pace', async () => {
  t.channel.lookupNumber = async (number, phone) => ({ jid: `${phone}@s.whatsapp.net`, exists: true, lid: '' });
  await pace({ custom: { dailyNew: 1 } });
  const intro = async (phone) => {
    await t.api(owner, 'POST', '/api/direct-chats', { phone, agent: 'helper' });
    const enc = encodeURIComponent(`${phone.replace(/\D/g, '')}@s.whatsapp.net`);
    const p = (await t.api(owner, 'POST', `/api/chats/${enc}/intro/preview`, {})).body;
    return t.api(owner, 'POST', `/api/chats/${enc}/intro`, { token: p.token });
  };
  assert.equal((await intro('+41 79 000 08 01')).status, 200);
  const second = await intro('+41 79 000 08 02');
  assert.equal(second.status, 429);
  assert.match(second.body.error, /limit of 1 new chat/);
  assert.deepEqual((await t.api(owner, 'GET', '/api/pace')).body.today, { cap: 1, used: 1, left: 0, warmup: false });

  const tool = (n) => TOOLS.find((x) => x.name === n);
  const x = { call: (m, p, b) => t.api(owner, m, p, b).then((r) => { if (r.status >= 400) throw new Error(r.body.error); return r.body; }) };
  assert.equal((await tool('get_sending_pace').run({}, x)).preset, 'custom');
  const s = await tool('set_sending_pace').run({ preset: 'faster', read_receipts: false }, x);
  assert.deepEqual([s.preset, s.readReceipts, s.dailyNew], ['faster', false, 80]);
  const c = await tool('set_sending_pace').run({ daily_new: 25, hours_from: '08:30' }, x);
  assert.deepEqual([c.preset, c.dailyNew, c.hoursFrom, c.readMin], ['custom', 25, '08:30', 1]);
});
