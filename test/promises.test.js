// 091: commitments (noticed, followed up when due, marked done from the chat, corrected by the owner), relationship
// cues (suggested ties, accept / reject, never silently), and per-person preferences (language for agents, hours and app
// for sending; editable).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';

let t; let owner; let upkeepTick; let config;
const G = 'g3@g.us'; const ANU = '41790000002';
const jid = (p) => `${p}@s.whatsapp.net`;
before(async () => {
  t = await setup({ env: { RATE_LIMIT_PER_MIN: '1000' } }); owner = await t.login(); config = t.config;
  ({ upkeepTick } = await import('../src/core/upkeep.js'));
  await t.api(owner, 'POST', '/api/agents', { template: 'blank', config: { name: 'Raju', triggers: ['raju'], groupReplies: 'wake', promises: { track: true, followUp: 'chat' }, cues: true } });
  await t.api(owner, 'POST', '/api/chats/bind', { chat: G, agent: 'raju' });
});
after(() => t.close());

const say = (text, phone = ANU, name = 'Anu', chat = G) => t.route(t.msg({ chat, text, phone, senderJid: jid(phone), senderName: name, isGroup: chat.endsWith('@g.us') }));
const open = async (q = 'agent=raju') => (await t.api(owner, 'GET', `/api/commitments?${q}`)).body;
/** A moment at hh:mm in the owner's time zone, some days ahead (minute by minute). */
const at = (hhmm, days = 1) => { const tz = config.env.timezone; let ts = Date.now() + days * 86400000; ts -= ts % 60000; for (let i = 0; i < 1500 && config.localParts(tz, ts).hhmm !== hhmm; i++) ts += 60000; return ts; };
const today = (ts = Date.now()) => config.localParts(config.env.timezone, ts).date;

test('a promise in a chat is noticed (one small call), shown on the person and the agent; off chats and other talk are not', async () => {
  const reqs = t.claudeReqs.length;
  await say('see you all soon');
  assert.equal(t.claudeReqs.length, reqs, 'not a promise: no model call');
  t.script.push([{ type: 'text', text: `{"promises": [{"what": "bring the speakers", "due": "${today()}"}]}` }]);
  await say("I'll bring the speakers on Friday");
  const c = (await t.waitFor(async () => (await open())[0]));
  assert.deepEqual([c.what, c.due, c.who, c.status, c.chat], ['bring the speakers', today(), 'Anu', 'open', G]);
  assert.ok(c.msg, 'links to the message');
  assert.match(t.claudeReqs.at(-1).system, /find promises/);
  assert.equal(t.db.db.prepare("SELECT kind FROM usage WHERE kind = 'commitments'").get()?.kind, 'commitments');
  const person = (await t.api(owner, 'GET', `/api/people/${ANU}`)).body;
  assert.equal(person.commitments[0].what, 'bring the speakers');
  // a chat that is off: nothing
  t.chatPrefs.setChatPrefs(G, { enabled: false });
  const n = t.claudeReqs.length;
  await say("I'll pay on Monday");
  assert.equal(t.claudeReqs.length, n);
  t.chatPrefs.setChatPrefs(G, { enabled: true });
});

test('due → one gentle follow-up in the chat inside the sending hours; done in the chat → marked done; owner corrects', async () => {
  const n = t.sent.length;
  await upkeepTick(t.channel, at('07:00', 0) < Date.now() ? at('07:00', 1) : at('07:00', 0));
  assert.equal(t.sent.length, n, 'before the sending hours: nothing');
  await upkeepTick(t.channel, at('10:00'));
  const f = t.sent.slice(n).filter((s) => s.chat === G);
  assert.equal(f.length, 1);
  assert.match(f[0].text, /Anu, a friendly reminder: you said you'd bring the speakers/);
  await upkeepTick(t.channel, at('10:05'));
  assert.equal(t.sent.filter((s) => s.chat === G).length - n, 1, 'once');
  const c = (await open())[0];
  t.script.push([{ type: 'text', text: `{"done": [${c.id}]}` }]);
  await say('brought the speakers ✅');
  await t.waitFor(async () => (await open('agent=raju&status=done')).some((x) => x.id === c.id));
  // the owner reopens it and drops it
  assert.equal((await t.api(owner, 'PUT', `/api/commitments/${c.id}`, { status: 'open' })).body.status, 'open');
  assert.equal((await t.api(owner, 'PUT', `/api/commitments/${c.id}`, { status: 'dropped' })).body.status, 'dropped');
  assert.equal((await t.api(owner, 'PUT', `/api/commitments/${c.id}`, { due: 'Friday' })).status, 400);
  // follow-ups off: due promises get no message
  await t.api(owner, 'PUT', '/api/agents/raju', { promises: { track: true, followUp: 'off' } });
  t.script.push([{ type: 'text', text: `{"promises": [{"what": "send the photos", "due": "${today()}"}]}` }]);
  await say("I'll send the photos today");
  await t.waitFor(async () => (await open()).some((x) => x.what === 'send the photos'));
  const m = t.sent.length;
  await upkeepTick(t.channel, at('11:00'));
  assert.equal(t.sent.length, m);
  assert.equal((await t.api(owner, 'PUT', '/api/agents/raju', { promises: { track: true, followUp: 'sometimes' } })).status, 400);
});

test('the morning brief lists commitments due', async () => {
  const oa = await import('../src/core/owner-assistant.js');
  const p = await oa.previewBrief(['commitments']);
  assert.match(p.text, /\*Commitments due\*\n- Anu: send the photos \(due today\)/);
});

test('relationship cues: "my daughter Vedika" → a suggestion; accept adds the tie (and the person); reject is final', async () => {
  await say('my daughter Vedika will join us, and My Wife Rupa too'); // only the exact family words, lower-case word after "my"
  let s = (await t.api(owner, 'GET', '/api/people-suggestions')).body;
  assert.deepEqual(s.map((x) => [x.word, x.name, x.kind]), [['daughter', 'Vedika', 'child']]);
  await t.api(owner, 'POST', `/api/people-suggestions/${encodeURIComponent(s[0].key)}`, { accept: true });
  const anu = (await t.api(owner, 'GET', `/api/people/${ANU}`)).body;
  assert.ok(anu.ties.some((x) => x.other.name === 'Vedika' && /Parent of/.test(x.label)), 'Anu is Vedika\'s parent');
  await say('my brother Kiran is driving');
  s = (await t.api(owner, 'GET', '/api/people-suggestions')).body;
  await t.api(owner, 'POST', `/api/people-suggestions/${encodeURIComponent(s[0].key)}`, { accept: false });
  await say('my brother Kiran said hi');
  assert.equal((await t.api(owner, 'GET', '/api/people-suggestions')).body.length, 0, 'rejected: never again');
  await t.api(owner, 'PUT', '/api/agents/raju', { cues: false });
  await say('my son Arjun is here');
  assert.equal((await t.api(owner, 'GET', '/api/people-suggestions')).body.length, 0, 'switched off');
});

test('preferences: language from their messages reaches the agent; hours and app editable; sending waits for their hours', async () => {
  for (const text of ['Bonjour à tous, je vais être en retard pour la réunion', 'Merci pour les photos, c\'est très gentil', 'Est-ce que vous venez demain avec les enfants ?', 'Je pense que nous pouvons partir à neuf heures', 'Oui, je suis là avec les enfants', 'Nous arrivons dans une heure', 'Qui vient avec nous pour le pique-nique ?', 'Je ne sais pas encore, je vous dis demain'])
    await say(text);
  await upkeepTick(t.channel, Date.now());
  const pf = (await t.api(owner, 'GET', `/api/people/${ANU}/prefs`)).body;
  assert.equal(pf.language, 'fr');
  t.script.push([{ type: 'text', text: 'Bonjour Anu !' }]);
  await say('raju bonjour');
  assert.match(t.userTurn(t.claudeReqs.length - 1), /Writes in French: answer in French/);
  // the owner sets them
  assert.equal((await t.api(owner, 'PUT', `/api/people/${ANU}/prefs`, { language: 'xx' })).status, 400);
  assert.equal((await t.api(owner, 'PUT', `/api/people/${ANU}/prefs`, { hoursFrom: 20, hoursTo: 9 })).status, 400);
  const set = (await t.api(owner, 'PUT', `/api/people/${ANU}/prefs`, { language: 'en', hoursFrom: 18, hoursTo: 21, app: 'whatsapp' })).body;
  assert.deepEqual([set.language, set.hours, set.app, set.auto.language], ['en', { from: 18, to: 21 }, 'whatsapp', false]);
  await t.api(owner, 'PUT', `/api/people/${ANU}/prefs`, { language: 'auto' });
  assert.equal((await t.api(owner, 'GET', `/api/people/${ANU}/prefs`)).body.language, 'fr', 'automatic again');
  // a send to Anu (18–21) and Gita (no hours): at 10:00 only Gita; Anu at 18:00
  await t.api(owner, 'PUT', '/api/modules/sending', { on: true });
  const gita = (await t.api(owner, 'POST', '/api/people', { name: 'Gita', phone: '41790000004' })).body;
  const anu = (await t.api(owner, 'GET', `/api/people/${ANU}`)).body;
  for (const p of [anu, gita]) await t.api(owner, 'PUT', `/api/people/${p.id}/consents`, { purpose: 'updates', value: 'yes' });
  t.agents.bindChat(jid('41790000004'), 'raju'); t.chatPrefs.setChatPrefs(jid('41790000004'), { enabled: true });
  const pv = (await t.api(owner, 'POST', '/api/sending/preview', { audience: { kind: 'people', people: [anu.id, gita.id] }, purpose: 'updates', template: 'Hello {first_name}', agent: 'raju' })).body;
  await t.api(owner, 'POST', `/api/sending/runs/${pv.run.id}/start`);
  const sentTo = () => t.sent.filter((s) => /^Hello|Hello/.test(s.text)).map((s) => s.chat);
  const tick = async (ts) => { await upkeepTick(t.channel, ts); await new Promise((r) => setTimeout(r, 60)); };
  await tick(at('10:00', 2)); await tick(at('10:00', 2) + 60000);
  assert.deepEqual(sentTo(), [jid('41790000004')], 'Gita first: Anu writes 18–21');
  await tick(at('18:00', 2)); await new Promise((r) => setTimeout(r, 60));
  assert.ok(sentTo().includes(jid(ANU)), 'Anu in her hours');
});

test('erasing a person removes what was learned about them; admin MCP has the tools', async () => {
  const anu = (await t.api(owner, 'GET', `/api/people/${ANU}`)).body;
  await t.api(owner, 'DELETE', `/api/people/${anu.id}`, { confirm: anu.name });
  assert.equal(t.db.db.prepare('SELECT COUNT(*) AS n FROM commitments WHERE person = ?').get(anu.id).n, 0);
  assert.equal(t.db.db.prepare('SELECT COUNT(*) AS n FROM person_prefs WHERE person = ?').get(anu.id).n, 0);
  const { TOOLS } = await import('../src/panel/admin-tools.js');
  for (const n of ['list_commitments', 'update_commitment', 'get_person_preferences', 'set_person_preferences', 'list_tie_suggestions', 'decide_tie_suggestion']) assert.ok(TOOLS.find((x) => x.name === n), n);
});
