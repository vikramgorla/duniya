// Why didn't the agent answer? (#34) Every time an agent stays silent the router records the reason here, compactly:
// one row per (chat, agent, reason) with a count, the last time and one sample sender — never a row per message and
// never message text. The activity log gets at most one `silence` entry per chat + reason per hour.
import { db } from './db.js';
import { activity } from './events.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS silences (
    chat TEXT NOT NULL, agent TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    first_ts INTEGER, last_ts INTEGER, sample_sender TEXT, logged_ts INTEGER DEFAULT 0,
    PRIMARY KEY (chat, agent, reason)
  );
  CREATE INDEX IF NOT EXISTS silences_last ON silences(last_ts);
`);

/** Reasons, in plain words. `label` fits "Quiet: …"; `fix` names the one-click fix the panel offers. */
export const SILENCE_REASONS = Object.freeze({
  chat_off: { label: 'chat is off', explain: 'This chat is switched off, so agents ignore it.', fix: 'chat_on' },
  not_addressed: { label: 'not mentioned', explain: 'Nobody @mentioned the agent, replied to it or started with one of its triggers.', fix: 'triggers' },
  no_agent: { label: 'no agent chosen', explain: 'Someone addressed an agent, but no agent is chosen for this group.', fix: 'assign' },
  agent_disabled: { label: 'agent is off', explain: 'The agent for this chat is switched off.', fix: 'agent_on' },
  paused: { label: 'all agents paused', explain: 'All agents are paused (Overview → Control).', fix: 'resume' },
  dm_not_allowed: { label: 'direct messages off', explain: 'The agent does not take direct messages.', fix: 'agent' },
  role_not_allowed: { label: 'sender not allowed', explain: 'The agent only answers organizers or members of its groups in direct messages.', fix: 'agent' },
  rate_limited: { label: 'rate limit', explain: 'The sender sent too many messages in a minute.', fix: '' },
  model_error: { label: 'model error', explain: 'The AI model or its provider failed.', fix: 'models' },
  no_reply: { label: 'empty answer', explain: 'The model returned an empty answer.', fix: 'models' },
  budget: { label: 'budget cap reached', explain: 'The usage cap for this agent or chat is reached.', fix: 'usage' },
  overloaded: { label: 'server busy', explain: 'Too many photos and voice notes were waiting; the sender was asked to send it again in a few minutes.', fix: 'server' },
  stale: { label: 'waited too long', explain: 'A photo or voice note waited longer than 15 minutes in the queue; the sender got a short apology instead of a late answer.', fix: 'server' },
});

const HOUR = 3600000;
const upsert = db.prepare(`INSERT INTO silences (chat, agent, reason, count, first_ts, last_ts, sample_sender, logged_ts)
  VALUES (?, ?, ?, 1, ?, ?, ?, 0)
  ON CONFLICT (chat, agent, reason) DO UPDATE SET count = count + 1, last_ts = excluded.last_ts,
    sample_sender = CASE WHEN excluded.sample_sender <> '' THEN excluded.sample_sender ELSE sample_sender END
  RETURNING count, logged_ts`);
const markLogged = db.prepare('UPDATE silences SET logged_ts = ? WHERE chat = ? AND agent = ? AND reason = ?');
const lastLogged = db.prepare('SELECT MAX(logged_ts) AS ts FROM silences WHERE chat = ? AND reason = ?');

/** Shorten a sender to a name or a masked number; never message text. */
const sampleOf = (sender) => String(sender || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);

/**
 * Record that an agent stayed silent. `reason` is a key of SILENCE_REASONS. Other modules call this too, e.g.
 * `silenceReason('budget', { chat, agent, sender })` when a usage cap stops a reply. Never throws.
 */
export function silenceReason(reason, { chat = '', agent = '', sender = '' } = {}) {
  if (!SILENCE_REASONS[reason] || !chat) return null;
  try {
    const now = Date.now();
    const row = upsert.get(String(chat), String(agent || ''), reason, now, now, sampleOf(sender));
    // One activity entry per chat + reason per hour (whichever agent).
    if (now - (lastLogged.get(String(chat), reason)?.ts || 0) >= HOUR) {
      markLogged.run(now, String(chat), String(agent || ''), reason);
      const r = SILENCE_REASONS[reason];
      activity('silence', { agent, chat, summary: `Stayed quiet: ${r.label} (${row.count}×). ${r.explain}`, detail: { reason, count: row.count } });
    }
    if (Math.random() < 0.001) pruneSilences();
    return { reason, count: row.count };
  } catch (e) {
    console.error('silence record failed', e.message);
    return null;
  }
}

const view = (r) => ({
  chat: r.chat, agent: r.agent, reason: r.reason, count: r.count, firstTs: r.first_ts, lastTs: r.last_ts,
  sampleSender: r.sample_sender || '', label: SILENCE_REASONS[r.reason]?.label || r.reason,
  explain: SILENCE_REASONS[r.reason]?.explain || '', fix: SILENCE_REASONS[r.reason]?.fix || '',
});

/** Silences seen in the last `days` days, most frequent first. Filters: chat, agent, reason. */
export function listSilences({ chat = '', agent = '', reason = '', days = 7, limit = 200 } = {}) {
  const where = ['last_ts >= ?']; const args = [Date.now() - Math.max(1, Math.min(Number(days) || 7, 400)) * 86400000];
  if (chat) { where.push('chat = ?'); args.push(chat); }
  if (agent) { where.push('agent = ?'); args.push(agent); }
  if (reason) { where.push('reason = ?'); args.push(reason); }
  const lim = Math.max(1, Math.min(Number(limit) || 200, 1000));
  return db.prepare(`SELECT * FROM silences WHERE ${where.join(' AND ')} ORDER BY count DESC, last_ts DESC LIMIT ?`).all(...args, lim).map(view);
}

/** Forget silences (after a fix, or "Clear"). Returns how many rows went. */
export function clearSilences({ chat = '', agent = '', reason = '' } = {}) {
  const where = ['1 = 1']; const args = [];
  if (chat) { where.push('chat = ?'); args.push(chat); }
  if (agent) { where.push('agent = ?'); args.push(agent); }
  if (reason) { where.push('reason = ?'); args.push(reason); }
  return Number(db.prepare(`DELETE FROM silences WHERE ${where.join(' AND ')}`).run(...args).changes);
}

/** Old rows go after 90 days. */
const pruneSilences = () => db.prepare('DELETE FROM silences WHERE last_ts < ?').run(Date.now() - 90 * 86400000);
