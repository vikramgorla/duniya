// The scale fixture (069, 078, #174): a large, realistic data set seeded fast into the real schema of a test data
// directory (test/harness.js setup()). Used by `npm run measure:scale` and by `scripts/check-perf.mjs` (CI: query
// plans and time budgets). Plain inserts in one transaction; no network.
//
// Full size: 300 chats (20 on) over 3 numbers, 30 agents, 200k stored messages (80 days) written by 900 active people,
// 50k activity rows, 20k usage rows, 5k people with 20k identities (WhatsApp number + LID, Telegram, a second Telegram
// account), phone contact names, 20k person notes and events, 10k tags, 1k households with 3k members, 20 lists with 4k
// members, 2k ties, 5k chat notes, 5k reactions, 3k group member tags.
export const FULL = { chats: 300, on: 20, agents: 30, messages: 200000, activity: 50000, usage: 20000, people: 5000, active: 900 };
export const SMALL = { chats: 60, on: 10, agents: 8, messages: 20000, activity: 5000, usage: 2000, people: 500, active: 200 };
const DAY = 86400000;

export const personId = (i) => `p_${String(i).padStart(12, '0')}`;
export const phoneOf = (i) => `4179${String(5000000 + i)}`;

/**
 * Seed `t` (a harness setup()) with the fixture of size `N`. Returns { chats, groups, numbers }: chat ids (the first
 * N.on are on; every fourth one is a direct chat), the group ids and the number ids.
 */
export async function seedScale(t, N = FULL) {
  const { db } = t.db;
  const now = Date.now();
  const numbers = ['main', 'n2', 'n3'];
  const chatId = (i) => { const n = numbers[i % 3]; const base = i % 4 === 3 ? `${phoneOf(i % N.active)}@s.whatsapp.net` : `scale${i}@g.us`; return n === 'main' ? base : `${n}#${base}`; };
  const chats = [...new Set(Array.from({ length: N.chats }, (_, i) => chatId(i)))];
  const groups = chats.filter((c) => c.endsWith('@g.us'));
  t.store.updateSettings({ logging: { level: 'normal', retentionDays: 365, maxEntries: 100000 } });
  t.events.resetLoggingCache();
  t.channel.listChats = async () => groups.map((id, i) => ({ id, name: `Group ${i}`, size: 5 + (i % 40), number: id.includes('#') ? id.split('#')[0] : 'main' }));
  t.channel.status = async () => ({ status: 'open', me: '41790000099:1@s.whatsapp.net', since: now, numbers: numbers.map((id, i) => ({ id, label: `Number ${i + 1}`, status: 'open', me: `4179000009${i}` })) });
  for (let a = 0; a < N.agents; a++) {
    const own = chats.filter((_, i) => i % N.agents === a && i < N.on * 3).slice(0, 2);
    await t.agents.createAgent({ id: `agent-${a}`, config: { name: `Agent ${a}`, prompt: 'You help.', model: 'anthropic:claude-sonnet-5-5', triggers: [`!a${a}`], chats: own } });
  }
  for (const c of chats.slice(0, N.on)) t.chatPrefs.setChatPrefs(c, { enabled: true });
  db.exec('BEGIN');
  try {
    const seen = db.prepare('INSERT OR REPLACE INTO chats_seen (tenant_id, chat, number, is_group, name, phone, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const c of chats.filter((x) => !x.endsWith('@g.us'))) seen.run('default', c, c.includes('#') ? c.split('#')[0] : 'main', 0, '', c.replace(/^.*#/, '').split('@')[0], now - 3600000);
    // messages: written by the active people (their number and their WhatsApp jid), every 25th by an agent
    const msg = db.prepare('INSERT INTO messages (channel, chat, agent, msg_id, sender, name, text, quoted, addressed, from_agent, ts, sender_jid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < N.messages; i++) {
      const c = chats[i % chats.length]; const p = i % N.active; const agent = i % 25 === 0;
      msg.run('whatsapp', c, '', `m${i}`, agent ? 'agent' : phoneOf(p), agent ? 'Assistant' : `Contact ${p}`, `Message ${i}: shall we meet at the station at nine or later?`, '', i % 20 === 0 ? 1 : 0, agent ? 1 : 0,
        now - Math.round((N.messages - i) / N.messages * 80 * DAY), agent ? '' : `${phoneOf(p)}@s.whatsapp.net`);
    }
    const act = db.prepare('INSERT INTO activity (ts, type, agent, chat, summary, detail) VALUES (?, ?, ?, ?, ?, ?)');
    const types = ['message.in', 'message.out', 'tool.call', 'model.usage', 'silence', 'config'];
    for (let i = 0; i < N.activity; i++) act.run(now - Math.round((N.activity - i) / N.activity * 60 * DAY), types[i % types.length], `agent-${i % N.agents}`, chats[i % N.on], `Entry ${i}`, i % 3 ? '' : JSON.stringify({ text: 'x'.repeat(200) }));
    const use = db.prepare('INSERT INTO usage (ts, agent, chat, provider, model, kind, input, output, cost, priced, account, fallback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < N.usage; i++) use.run(now - Math.round((N.usage - i) / N.usage * 300 * DAY), `agent-${i % N.agents}`, chats[i % N.on], 'anthropic', 'claude-sonnet-5-5', 'reply', 1200, 300, 0.0081, 'set', 'anthropic', '');
    // People: phone contact names; every person has a WhatsApp number + LID, every other one Telegram, every fourth two
    const con = db.prepare('INSERT OR REPLACE INTO contacts (tenant_id, phone, book_name, push_name, updated_at) VALUES (?, ?, ?, ?, ?)');
    const per = db.prepare('INSERT OR REPLACE INTO people (tenant_id, id, phone, created_at, name, nickname, shared) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const ide = db.prepare('INSERT OR REPLACE INTO identities (tenant_id, channel, external_id, person, phone, first_seen, last_seen, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const note = db.prepare('INSERT INTO person_notes (tenant_id, person, kind, by, author, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const tag = db.prepare('INSERT OR IGNORE INTO person_tags (tenant_id, person, tag) VALUES (?, ?, ?)');
    const TAGS = ['badminton', 'neighbour', 'school', 'carpool', 'family', 'work', 'choir', 'cricket'];
    for (let i = 0; i < N.people; i++) {
      const id = personId(i); const phone = phoneOf(i); const seenAt = now - i * 1000;
      con.run('default', phone, `Contact ${i}`, `push${i}`, now);
      per.run('default', id, phone, now - DAY, i % 10 ? '' : `Own ${i}`, i % 13 ? '' : `Nick${i}`, i % 7 ? 0 : 1);
      ide.run('default', 'whatsapp', `${phone}@s.whatsapp.net`, id, phone, seenAt, seenAt, `push${i}`);
      ide.run('default', 'whatsapp', `${9000000 + i}@lid`, id, phone, seenAt, seenAt, `push${i}`);
      ide.run('default', 'telegram', `${700000 + i}`, id, i % 2 ? '' : phone, seenAt, seenAt, `tg${i}`);
      ide.run('default', 'telegram', `${800000 + i}`, id, '', seenAt, seenAt, `tg${i}b`);
      for (let n = 0; n < 4; n++) note.run('default', id, n % 2 ? 'event' : 'note', n % 2 ? 'app' : n === 2 ? 'agent' : 'owner', '', n % 2 ? 'Joined a household' : `Likes the ${TAGS[(i + n) % TAGS.length]} evenings`, now - (i * 4 + n) * 60000);
      tag.run('default', id, TAGS[i % TAGS.length]); tag.run('default', id, TAGS[(i * 3 + 1) % TAGS.length]);
    }
    const hh = db.prepare('INSERT INTO households (tenant_id, id, name, address, created_at) VALUES (?, ?, ?, ?, ?)');
    const hm = db.prepare('INSERT OR IGNORE INTO household_members (tenant_id, household, person, role) VALUES (?, ?, ?, ?)');
    for (let h = 0; h < N.people / 5; h++) {
      hh.run('default', `h_${String(h).padStart(12, '0')}`, `Family ${h}`, '', now);
      for (let m = 0; m < 3; m++) hm.run('default', `h_${String(h).padStart(12, '0')}`, personId(h * 5 + m), m === 2 ? 'kid' : 'adult');
    }
    const ls = db.prepare('INSERT INTO person_lists (tenant_id, id, name, created_at) VALUES (?, ?, ?, ?)');
    const lm = db.prepare('INSERT OR IGNORE INTO person_list_members (tenant_id, list, person) VALUES (?, ?, ?)');
    for (let l = 0; l < 20; l++) {
      ls.run('default', `l_${String(l).padStart(12, '0')}`, `List ${l}`, now);
      for (let m = 0; m < N.people / 25; m++) lm.run('default', `l_${String(l).padStart(12, '0')}`, personId((l * 97 + m * 7) % N.people));
    }
    const tie = db.prepare('INSERT INTO person_ties (tenant_id, id, a, b, kind, label, inverse, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < N.people / 2.5; i++) tie.run('default', `t_${String(i).padStart(12, '0')}`, personId(i), personId((i + 1) % N.people), i % 2 ? 'parent' : 'partner', '', '', now);
    const cn = db.prepare('INSERT INTO notes (chat, agent, text, author, role, ts) VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < N.people; i++) cn.run(chats[i % N.on], '', `Note ${i}: bring the music speakers`, 'Contact', 'organizer', now - i * 60000);
    const re = db.prepare('INSERT OR IGNORE INTO wa_reactions (chat, msg_id, sender, name, emoji, ts) VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < N.people; i++) re.run(chats[i % N.on], `m${i}`, phoneOf(i % N.active), `Contact ${i % N.active}`, '👍', now - i * 60000);
    const mt = db.prepare('INSERT OR IGNORE INTO member_tags (chat, member, phone, label, ts) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < N.people * 0.6; i++) mt.run(groups[i % groups.length], `${phoneOf(i)}@s.whatsapp.net`, phoneOf(i), 'driver', now);
    // 079: the chats people are in (wrote in, from the stored messages; members of the groups that are on), where they
    // came from (a third from the phone's contacts), consents, and a few hidden
    db.prepare(`INSERT OR IGNORE INTO person_chats (tenant_id, person, chat, wrote, member, last_at)
      SELECT 'default', 'p_' || printf('%012d', CAST(substr(sender, 5) AS INTEGER) - 5000000), chat, 1, 0, MAX(ts) FROM messages WHERE from_agent = 0 GROUP BY sender, chat`).run();
    const pc = db.prepare('INSERT OR IGNORE INTO person_chats (tenant_id, person, chat, wrote, member, last_at) VALUES (?, ?, ?, 0, 1, ?)');
    for (const [g, chat] of groups.filter((c) => chats.indexOf(c) < N.on).entries()) for (let m = 0; m < 100; m++) pc.run('default', personId((g * 100 + m) % N.people), chat, now);
    db.prepare("UPDATE people SET source = 'phone' WHERE CAST(substr(id, 3) AS INTEGER) % 3 = 0 AND CAST(substr(id, 3) AS INTEGER) >= ?").run(N.active);
    db.prepare('UPDATE people SET hidden = 1 WHERE CAST(substr(id, 3) AS INTEGER) % 97 = 0').run();
    const cs = db.prepare("INSERT OR IGNORE INTO person_consents (tenant_id, person, purpose, value, source, at) VALUES (?, ?, 'privacy_notice', 'yes', 'Group notice', ?)");
    for (let i = 0; i < N.people; i++) cs.run('default', personId(i), now);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return { chats, groups, numbers };
}
