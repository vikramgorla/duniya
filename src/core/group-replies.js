// 076: group replies without a wake word. An agent in a group answers when woken (wake word, @mention, reply to it)
// and, depending on agent.groupReplies:
//   wake      — only then;
//   followups — also messages right after it spoke, until the group moves to another topic (the default);
//   auto      — any message it judges to be for it.
// A message that is only a candidate runs a normal turn with JUDGE_NOTE: the agent acts and replies when the message is
// for it, answers [quiet] when not, and [done] when the conversation moved on (that closes its follow-ups).
// Follow-ups are bounded so a busy group cannot run up costs: closed after FOLLOW_MS without the agent speaking or after
// MAX_JUDGED candidates. State is in memory only (a restart simply closes open follow-ups).
const FOLLOW_MS = 30 * 60000;
const MAX_JUDGED = 15;
export const GROUP_REPLIES = ['wake', 'followups', 'auto'];
const open = new Map(); // chat -> { agent, at, judged }

/** The agent posted in a group chat: messages after it may be follow-ups. */
export function agentSpoke(chat, agentId) { open.set(chat, { agent: agentId, at: Date.now(), judged: 0 }); }

/** Should this group message (not addressed to the agent) still go to the agent, to judge? */
export function shouldJudge(agent, msg, now = Date.now()) {
  if (!msg.isGroup) return false;
  const mode = agent.groupReplies || 'followups';
  if (mode === 'auto') return true;
  if (mode !== 'followups') return false;
  const o = open.get(msg.chat);
  if (!o || o.agent !== agent.id) return false;
  if (now - o.at > FOLLOW_MS || o.judged >= MAX_JUDGED) { open.delete(msg.chat); return false; }
  o.judged++;
  return true;
}

export const JUDGE_NOTE = 'This message did not use your wake word, mention or reply to you. Answer or act only if it is meant for you or continues your conversation and needs you. If it is not for you, answer exactly [quiet]. If the group has moved on to another topic, answer exactly [done].';

/** 'quiet' | 'done' when the agent decided to stay out of it, else null. */
export function verdictOf(out) {
  const m = /^\W*\[(quiet|done)\]\W*$/i.exec(String(out || '').trim());
  if (!m) return null;
  return m[1].toLowerCase() === 'done' ? 'done' : 'quiet';
}

/** The agent said the conversation moved on: stop treating messages as its follow-ups. */
export function closeFollowups(chat) { open.delete(chat); }
