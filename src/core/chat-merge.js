// @ts-check
// One chat under two ids becomes one (2.57.2). A messaging app can change the id it uses for a chat: Telegram turns a
// group into a supergroup, WhatsApp delivers a person's messages from its private id (…@lid) while the chat was set up
// under their phone number (…@s.whatsapp.net). Everything the app keeps per chat joins the id the app uses now:
// settings (combined, the stricter choice kept), the agent, the spending cap, stored messages and memory; the old id
// stays as an alias so later messages and lookups find the same chat.
import { db, moveChatData } from './db.js';
import { mergeChatPrefs } from './chat-prefs.js';
import { agentForChat, updateAgent } from './agents.js';
import { activity } from './events.js';

const TENANT = 'default';

/** Move `from` into `to` (`why`: the Activity line). Agent of `to` wins; `from`'s agent follows when `to` has none. */
export async function mergeChats(from, to, why) {
  if (!from || !to || from === to) return;
  moveChatData(from, to);
  mergeChatPrefs(from, to);
  db.prepare("UPDATE OR IGNORE budget_caps SET id = ? WHERE tenant_id = ? AND scope = 'chat' AND id = ?").run(to, TENANT, from);
  db.prepare("DELETE FROM budget_caps WHERE tenant_id = ? AND scope = 'chat' AND id = ?").run(TENANT, from);
  const agent = agentForChat(from);
  const keep = agentForChat(to);
  if (agent) await updateAgent(agent.id, { chats: [...new Set(agent.chats.map((c) => (c === from ? (keep ? null : to) : c)).filter(Boolean))] }, 'system');
  activity('config', { chat: to, agent: (keep || agent)?.id || '', summary: `${why}: its settings${agent ? ', agent' : ''} and memory are now in one chat` });
}
