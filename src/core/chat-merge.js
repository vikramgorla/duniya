// @ts-check
// One chat under two ids becomes one (2.57.2). A messaging app can change the id it uses for a chat: Telegram turns a
// group into a supergroup, WhatsApp delivers a person's messages from its private id (…@lid) while the chat was set up
// under their phone number (…@s.whatsapp.net). Everything the app keeps per chat joins the id the app uses now:
// settings (combined, the stricter choice kept), the agent, the spending cap, stored messages and memory; the old id
// stays as an alias so later messages and lookups find the same chat.
import { db, getChatMemory, moveChatData, setChatMemory } from './db.js';
import { mergeChatPrefs } from './chat-prefs.js';
import { agentForChat, updateAgent } from './agents.js';
import { activity } from './events.js';

const TENANT = 'default';

/** A chat list with `from` replaced by `to` (dropped when `to` is null), without doubles. */
const swapped = (chats, from, to) => [...new Set(chats.map((c) => (c === from ? to : c)).filter(Boolean))];

/** `from`'s agent has the chat under `to` from now on (`to` null: another agent has it): its chats and the schedules limited to some chats. */
function followChat(agent, from, to) {
  return updateAgent(agent.id, { chats: swapped(agent.chats, from, to),
    schedules: agent.schedules.map((s) => (s.chats === 'all' ? s : { ...s, chats: swapped(s.chats, from, to) })) }, 'system');
}

/**
 * Both ids have a running summary: `to` keeps both texts, the older first, and the mark of what is summarised goes back
 * to the earlier of the two, so the next regular summary covers every message at least once (a summary alone would
 * hide the other id's conversation from the agent). One summary, or none: it moves with the other rows.
 */
function joinSummaries(from, to) {
  const [older, newer] = [getChatMemory(from), getChatMemory(to)].sort((a, b) => (a?.updated_at || 0) - (b?.updated_at || 0));
  if (!older?.summary || !newer?.summary) return;
  setChatMemory(to, `${older.summary}\n\n${newer.summary}`, Math.min(older.upto_id, newer.upto_id));
}

/** Move `from` into `to` (`why`: the Activity line). Agent of `to` wins; `from`'s agent follows when `to` has none. */
export async function mergeChats(from, to, why) {
  if (!from || !to || from === to) return;
  joinSummaries(from, to);
  moveChatData(from, to);
  mergeChatPrefs(from, to);
  db.prepare("UPDATE OR IGNORE budget_caps SET id = ? WHERE tenant_id = ? AND scope = 'chat' AND id = ?").run(to, TENANT, from);
  db.prepare("DELETE FROM budget_caps WHERE tenant_id = ? AND scope = 'chat' AND id = ?").run(TENANT, from);
  const agent = agentForChat(from);
  const keep = agentForChat(to);
  if (agent) await followChat(agent, from, !keep || keep.id === agent.id ? to : null);
  activity('config', { chat: to, agent: (keep || agent)?.id || '', summary: `${why}: its settings${agent ? ', agent' : ''} and memory are now in one chat` });
}
