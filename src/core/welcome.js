// @ts-check
// Welcome message (054, issue #102). When people join a group (added, invite link, join request accepted), the
// group's agent greets them once: only in chats that are on, when the agent is enabled and its welcome is on (or the
// chat's override says so). Joins that arrive together (bulk adds) get one combined message. "Once" is remembered as
// a hash of the chat and the person's id — never names or numbers in clear. No AI, no tokens.
import { db, logMessage } from './db.js';
import { TENANT, getSettings } from './store.js';
import { sha256 } from './crypto.js';
import { getChatPrefs } from './chat-prefs.js';
import { agentForChat } from './agents.js';
import { noticeDecision, maybePostNotice } from './privacy-notice.js';
import { activity } from './events.js';
import { countStat } from './stats.js';
import { recordUsage } from './usage.js';
import { fillPlaceholders, todayText, DEFAULT_WELCOME } from './quick.js';
import { isGroup } from './config.js';

db.exec(`CREATE TABLE IF NOT EXISTS welcome_seen (tenant_id TEXT NOT NULL, key TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (tenant_id, key))`);

/** People named in one combined welcome; more are counted ("and 7 others"). */
const MAX_NAMED = 20;
const delayMs = () => Number(process.env.WELCOME_DELAY_MS ?? 5000); // collect joins that arrive together
const gapMs = () => Number(process.env.WELCOME_GAP_MS ?? 60000); // at most one welcome per chat in this time

const keyOf = (chat, p) => sha256(`${chat}|${p.phone || p.jid}`);
const seen = (key) => !!db.prepare('SELECT 1 FROM welcome_seen WHERE tenant_id = ? AND key = ?').get(TENANT, key);

/** Is the welcome on for this chat? The chat's override (on / off) wins over the agent's setting. */
function welcomeOn(agent, chat) {
  const mode = getChatPrefs(chat).welcome;
  return mode === 'on' ? true : mode === 'off' ? false : !!agent?.welcome?.enabled;
}

/** Would a join in this chat be welcomed now? { ok, reason, agent }. */
function welcomeDecision(chat) {
  if (!isGroup(chat)) return { ok: false, reason: 'not a group' };
  if (!getChatPrefs(chat).enabled) return { ok: false, reason: 'chat is off' };
  const agent = agentForChat(chat);
  if (!agent) return { ok: false, reason: 'no agent' };
  if (!agent.enabled) return { ok: false, reason: 'agent is off', agent };
  if (getSettings().paused) return { ok: false, reason: 'paused', agent };
  if (!welcomeOn(agent, chat)) return { ok: false, reason: 'welcome is off', agent };
  return { ok: true, reason: '', agent };
}

/** The welcome text for these people: {name} = their @mentions, {group}, {rules}, {date}. */
function welcomeText(agent, people, { group = '', now = Date.now() } = {}) {
  const tags = people.slice(0, MAX_NAMED).map((p) => `@${String(p.jid).split('@')[0].split(':')[0]}`);
  const extra = people.length - tags.length;
  const names = extra > 0 ? `${tags.join(', ')} and ${extra} other${extra === 1 ? '' : 's'}`
    : tags.length > 1 ? `${tags.slice(0, -1).join(', ')} and ${tags.at(-1)}` : tags[0] || '';
  let text = agent.welcome?.text || DEFAULT_WELCOME;
  const rules = agent.welcome?.rules || '';
  if (rules && !text.includes('{rules}')) text = `${text}\n\n{rules}`;
  return fillPlaceholders(text, { name: names, group: group || 'the group', rules, date: todayText(agent.timezone, now) });
}

const pending = new Map(); // chat -> { people: Map(key -> person), timer }
const lastSent = new Map(); // chat -> time of the last welcome

/**
 * People joined a group: { chat, participants: [{ jid, phone }] }. Queues them (after a short delay one combined
 * welcome goes out). Returns { queued, reason }.
 */
export function noteJoin(channel, { chat, participants = [] }) {
  const d = welcomeDecision(chat);
  if (!d.ok) return { queued: 0, reason: d.reason };
  const entry = pending.get(chat) || { people: new Map(), timer: null };
  for (const p of participants) {
    if (!p?.jid) continue;
    const key = keyOf(chat, p);
    if (!entry.people.has(key) && !seen(key)) entry.people.set(key, { jid: p.jid, phone: p.phone || '' });
  }
  if (!entry.people.size) return { queued: 0, reason: 'already welcomed' };
  pending.set(chat, entry);
  if (!entry.timer) {
    const wait = Math.max(delayMs(), (lastSent.get(chat) || 0) + gapMs() - Date.now());
    entry.timer = setTimeout(() => { flush(channel, chat).catch((e) => activity('error', { chat, summary: `Welcome not posted: ${e.message}` })); }, wait);
    entry.timer.unref?.();
  }
  return { queued: entry.people.size, reason: '' };
}

async function flush(channel, chat) {
  const entry = pending.get(chat);
  pending.delete(chat);
  if (!entry?.people.size) return;
  const d = welcomeDecision(chat); // settings may have changed while waiting
  if (!d.ok) return;
  const agent = d.agent;
  const people = [...entry.people].filter(([key]) => !seen(key));
  if (!people.length) return;
  // The privacy notice comes first when the group was just switched on and it has not been posted yet.
  if (noticeDecision(chat).post) await maybePostNotice(chat, channel);
  const group = await channel.chatName?.(chat).catch(() => '') || '';
  const text = welcomeText(agent, people.map(([, p]) => p), { group });
  const sent = await channel.send(chat, text, { mentions: people.slice(0, MAX_NAMED).map(([, p]) => p.jid) });
  lastSent.set(chat, Date.now());
  const ins = db.prepare('INSERT OR IGNORE INTO welcome_seen (tenant_id, key, ts) VALUES (?, ?, ?)');
  for (const [key] of people) ins.run(TENANT, key, Date.now());
  logMessage({ channel: 'whatsapp', chat, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text, fromAgent: true });
  countStat('reply', { agent: agent.id });
  recordUsage({ agent: agent.id, chat, provider: 'built-in', model: 'welcome', kind: 'welcome', cost: 0, priced: 'free' });
  activity('message.out', { agent: agent.id, chat, summary: `Welcome posted for ${people.length} new member${people.length === 1 ? '' : 's'}` });
}
