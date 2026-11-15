import { isChatEnabled, ignoredCounts } from './chat-prefs.js';
import { env } from './config.js';
import { getSettings } from './store.js';
import { listAgents, getAgent, agentForChat, roleIn } from './agents.js';
import { runAgent, handleConfirmCommand } from './runner.js';
import { logMessage, messageByMsgId, saveReaction, savePollVote, pollTally } from './db.js';
import { activity } from './events.js';
import { maybeSummarize } from './memory.js';
import { setWhatsAppChannel } from './whatsapp-tools.js';
import { countStat } from './stats.js';
import { silenceReason } from './silences.js';
import { handleOwnerMessage } from './owner-assistant.js';
import { dmNoticeOnce } from './privacy-notice.js';

export { silenceReason }; // #34: other modules (usage caps) report why an agent stayed silent, e.g. silenceReason('budget', …)

const rate = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (rate.get(key) || []).filter((t) => now - t < 60000);
  list.push(now);
  rate.set(key, list);
  return list.length > env.rateLimitPerMin;
}

const isAnyOrganizer = (phone) => !!phone && listAgents().some((b) => b.organizers.includes(phone));
const startsWithTrigger = (agent, lower) => (agent.triggers || []).find((t) => lower.startsWith(t));

function stripTriggers(agent, text) {
  let t = text.replace(/@\d{5,}/g, ' ').trim();
  const trig = startsWithTrigger(agent, t.toLowerCase());
  if (trig) t = t.slice(trig.length);
  return t.trim();
}

/**
 * Role of a sender for an agent. Saved organizers decide; while an agent has none saved, WhatsApp admins of the agent's
 * groups are its organizers (015: "group admins as the default").
 */
export async function resolveRole(agent, msg, channel) {
  const saved = roleIn(agent, msg.phone);
  if (saved === 'organizer' || agent.organizers.length || !msg.phone) return saved;
  const groups = msg.isGroup ? [msg.chat] : agent.chats.filter((c) => !/@(s\.whatsapp\.net|lid)$/.test(c));
  for (const g of groups) {
    try {
      const members = await channel.groupMembers?.(g);
      if (members?.some((m) => m.admin && m.phone === msg.phone)) return 'organizer';
    } catch { /* not a member / offline */ }
  }
  return 'participant';
}

/** Pick the agent for a direct message, or null. */
async function agentForDm(msg, channel, { openOnly = false } = {}) {
  // A 1:1 chat an admin assigned to an agent (Chats page) always goes to that agent.
  const assigned = agentForChat(msg.chat);
  if (assigned) return assigned.enabled && (!openOnly || assigned.dm === 'anyone') ? assigned : null;
  if (openOnly) { // chat is off: only an agent that explicitly answers anyone may take it
    const open = listAgents().filter((b) => b.enabled && b.dm === 'anyone');
    const lower = msg.text.trim().toLowerCase();
    const numberDefault = (getSettings().whatsappNumbers || []).find((n) => n.id === (msg.number || 'main'))?.dmAgent;
    return open.find((b) => startsWithTrigger(b, lower)) || open.find((b) => b.id === numberDefault) || open.find((b) => b.id === getSettings().defaultDmAgent) || open[0] || null;
  }
  const lower = msg.text.trim().toLowerCase();
  const enabled = listAgents().filter((b) => b.enabled);
  const byTrigger = enabled.find((b) => startsWithTrigger(b, lower));
  const numberDefault = (getSettings().whatsappNumbers || []).find((n) => n.id === (msg.number || 'main'))?.dmAgent;
  const candidates = byTrigger ? [byTrigger]
    : [getAgent(numberDefault), getAgent(getSettings().defaultDmAgent), ...enabled].filter((b) => b?.enabled);
  for (const agent of candidates) {
    if (agent.dm === 'none') continue;
    const role = await resolveRole(agent, msg, channel);
    if (agent.dm === 'anyone' || role === 'organizer') return agent;
    if (agent.dm === 'organizers') continue;
    if (agent.participants.includes(msg.phone)) return agent;
    for (const chat of agent.chats) {
      if (await channel.isMember(chat, msg.phone, msg.senderJid)) return agent;
    }
  }
  return null;
}

/** Why no agent took a direct message (#34): the agent it would have gone to, and the reason. */
function dmSilence(msg) {
  const assigned = agentForChat(msg.chat);
  if (assigned) return { agent: assigned.id, reason: assigned.enabled ? 'role_not_allowed' : 'agent_disabled' };
  const all = listAgents();
  const enabled = all.filter((b) => b.enabled);
  if (!enabled.length) return { agent: all[0]?.id || '', reason: all.length ? 'agent_disabled' : 'no_agent' };
  const lower = msg.text.trim().toLowerCase();
  const numberDefault = (getSettings().whatsappNumbers || []).find((n) => n.id === (msg.number || 'main'))?.dmAgent;
  const c = enabled.find((b) => startsWithTrigger(b, lower)) || [getAgent(numberDefault), getAgent(getSettings().defaultDmAgent)].find((b) => b?.enabled) || enabled[0];
  return { agent: c.id, reason: c.dm === 'none' ? 'dm_not_allowed' : 'role_not_allowed' };
}

const summarizeLater = (chat, agent) => { maybeSummarize(chat, agent).catch(() => {}); };

/** Store WhatsApp history batches (link/reconnect sync). Never replies. Group chats only. */
export function createHistoryHandler() {
  return async function onHistory(msgs) {
    const touched = new Map();
    let stored = 0;
    for (const m of msgs) {
      if (!m.isGroup || (m.kind && m.kind !== 'text')) continue; // never store private chats from history
      if (!isChatEnabled(m.chat)) continue; // nor groups that are switched off (#10)
      const agent = agentForChat(m.chat);
      const id = logMessage({
        channel: m.channel, chat: m.chat, agent: agent?.id || '', msgId: m.msgId, sender: m.phone, name: m.senderName,
        text: m.text, quoted: m.quoted, fromAgent: m.fromMe, ts: m.ts, senderJid: m.fromMe ? '' : m.senderJid,
      });
      if (id) { stored++; touched.set(m.chat, agent); }
    }
    if (stored) activity('memory.history', { summary: `Stored ${stored} history message(s) from ${touched.size} group(s)` });
    for (const [chat, agent] of touched) summarizeLater(chat, agent);
  };
}

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/**
 * Reactions and poll votes (026): stored for context, never answered. Reactions are kept when they are on an agent's
 * message or in a chat bound to an enabled agent; votes when the poll is known (created while the app ran).
 */
function recordEvent(msg) {
  const who = msg.phone || msg.senderJid || 'someone';
  const agent = agentForChat(msg.chat);
  if (msg.kind === 'reaction') {
    const target = msg.target ? messageByMsgId(msg.chat, msg.target) : null;
    if (!target?.from_agent && !(agent?.enabled && msg.isGroup)) return;
    saveReaction({ chat: msg.chat, msgId: msg.target, sender: who, name: msg.senderName, emoji: msg.emoji, ts: msg.ts });
    activity('whatsapp.reaction', { agent: agent?.id || target?.agent || '', chat: msg.chat,
      summary: msg.emoji ? `${msg.senderName} reacted ${msg.emoji} to "${clip(target?.text || 'a message', 80)}"` : `${msg.senderName} removed a reaction` });
    return;
  }
  if (msg.kind === 'poll_vote') {
    const p = savePollVote({ chat: msg.chat, msgId: msg.pollId, voter: who, name: msg.senderName, selected: msg.selected || [], ts: msg.ts });
    if (!p) return;
    activity('whatsapp.vote', { agent: agent?.id || '', chat: msg.chat,
      summary: `${msg.senderName} voted ${msg.selected?.length ? msg.selected.join(', ') : '(withdrew)'} in "${clip(p.name, 60)}" → ${pollTally(p).map((o) => `${o.name} ${o.votes}`).join(', ')}` });
  }
}

/** Build the live message router for a channel. */
export function createRouter(channel) {
  setWhatsAppChannel(channel);
  return async function onMessage(msg) {
    // Reactions and poll votes: recorded only for chats that are on (#10).
    if (msg.kind && msg.kind !== 'text') { if (isChatEnabled(msg.chat)) recordEvent(msg); return; }
    // Owner assistant (044): link codes and linked panel users' direct messages (unless they start with an agent trigger).
    if (!msg.isGroup && await handleOwnerMessage(msg, channel)) return;
    // A media caption can address the agent ("!panduga what is this?"); the stored text is the placeholder.
    const wake = msg.caption || msg.text;
    const lower = wake.trim().toLowerCase();
    const groupAgent = msg.isGroup ? agentForChat(msg.chat) : null;
    // #34: would this message have woken an agent? (Only then is staying silent worth explaining.)
    const wakes = !msg.isGroup || msg.mentioned || msg.replyToAgent || listAgents().some((b) => startsWithTrigger(b, lower));
    const sender = msg.senderName || (msg.phone ? `+${msg.phone}` : '');
    const quiet = (reason, agentId = groupAgent?.id || '') => silenceReason(reason, { chat: msg.chat, agent: agentId, sender });

    // Silent by default (#10): a chat that is off is ignored completely — nothing stored, no model call — except
    // organizers' admin helpers below, and direct messages to an agent explicitly set to answer anyone.
    let openAgent = null;
    if (!isChatEnabled(msg.chat)) {
      const helper = isAnyOrganizer(msg.phone) && ((msg.isGroup && lower === '!groupid') || (!msg.isGroup && lower === '!groups'));
      const open = !msg.isGroup && !helper ? await agentForDm(msg, channel, { openOnly: true }) : null;
      if (!helper && !open) {
        ignoredCounts.set(msg.chat, (ignoredCounts.get(msg.chat) || 0) + 1);
        countStat('ignored', { chat: msg.chat }); // weekly summary (041): counts only
        if (wakes) quiet('chat_off', groupAgent?.id || agentForChat(msg.chat)?.id || '');
        return;
      }
      openAgent = open;
      if (helper) { // organizer helper in a chat that is off: answer it, store nothing
        if (msg.isGroup) await channel.send(msg.chat, `Group id: ${msg.chat}`, { quoted: msg.raw });
        else await channel.send(msg.chat, (await channel.listChats()).map((g) => `${g.name} (${g.size})\n${g.id}`).join('\n\n') || 'No groups.');
        return;
      }
    }

    // Groups: remember everything said (bound or not, paused or not) so agents have context.
    let rowId = 0;
    if (msg.isGroup) {
      rowId = logMessage({
        channel: msg.channel, chat: msg.chat, agent: groupAgent?.id || '', msgId: msg.msgId, sender: msg.phone,
        name: msg.senderName, text: msg.text, quoted: msg.quoted, ts: msg.ts, senderJid: msg.senderJid,
      });
      summarizeLater(msg.chat, groupAgent);
    }
    if (getSettings().paused) { if (wakes) quiet('paused'); return; }

    // Admin helpers for organizers of any agent
    if (isAnyOrganizer(msg.phone)) {
      if (msg.isGroup && lower === '!groupid') {
        await channel.send(msg.chat, `Group id: ${msg.chat}`, { quoted: msg.raw });
        return;
      }
      if (!msg.isGroup && lower === '!groups') {
        const chats = await channel.listChats();
        await channel.send(msg.chat, chats.map((g) => `${g.name} (${g.size})\n${g.id}`).join('\n\n') || 'No groups.');
        return;
      }
    }

    const agent = msg.isGroup ? groupAgent : openAgent || await agentForDm(msg, channel);
    if (!agent || !agent.enabled) {
      if (msg.isGroup) {
        if (!groupAgent) { if (wakes) quiet('no_agent', ''); }
        else if (msg.mentioned || msg.replyToAgent || startsWithTrigger(groupAgent, lower)) quiet('agent_disabled');
      } else { const d = dmSilence(msg); quiet(d.reason, d.agent); }
      return;
    }
    if (!msg.isGroup) {
      rowId = logMessage({
        channel: msg.channel, chat: msg.chat, agent: agent.id, msgId: msg.msgId, sender: msg.phone,
        name: msg.senderName, text: msg.text, quoted: msg.quoted, addressed: true, ts: msg.ts, senderJid: msg.senderJid,
      });
    }

    const role = agent.hooks.role ? (await agent.hooks.role(msg, agent)) || await resolveRole(agent, msg, channel) : await resolveRole(agent, msg, channel);
    const isConfirm = /^(confirm|cancel)\s+[a-z0-9]{4}$/i.test(lower);
    const addressed = !msg.isGroup
      || (agent.respondToMentions && (msg.mentioned || msg.replyToAgent))
      || !!startsWithTrigger(agent, lower);
    const triggered = addressed || isConfirm;

    // Hooks can observe every routed message and optionally answer without the LLM.
    if (agent.hooks.onMessage) {
      const hookReply = await agent.hooks.onMessage({ msg, agent, role, triggered, channel });
      if (typeof hookReply === 'string' && hookReply) {
        await reply(hookReply);
        return;
      }
    }
    if (!triggered) { quiet('not_addressed', agent.id); return; }
    if (rateLimited(`${agent.id}:${msg.phone || msg.senderJid}`)) { quiet('rate_limited', agent.id); return; }

    const text = msg.caption ? `${msg.text.replace(/:.*$/s, ']')} ${stripTriggers(agent, msg.caption)}`.trim() : stripTriggers(agent, msg.text);
    let out = await handleConfirmCommand({ agent, text, role, chat: msg.chat });
    if (out === undefined && !addressed) return; // looked like "cancel ABCD" but isn't ours
    countStat('handled', { agent: agent.id });
    activity('message.in', {
      agent: agent.id, chat: msg.chat,
      summary: `${msg.senderName} (${role}): ${text}`,
      detail: { phone: msg.phone, isGroup: msg.isGroup, quoted: msg.quoted || undefined },
    });

    if (out === undefined) {
      if (!text) return;
      await channel.typing?.(msg.chat);
      const ctx = {
        agent, role, chat: msg.chat, senderName: msg.senderName, requester: msg.phone,
        text, isGroup: msg.isGroup, source: msg.channel, msgRowId: rowId, msgId: msg.msgId, senderJid: msg.senderJid,
        chatName: msg.isGroup ? await channel.chatName?.(msg.chat) : '',
      };
      try {
        out = await runAgent(ctx);
      } catch (e) {
        activity('error', { agent: agent.id, chat: msg.chat, summary: `Agent failed: ${e.message}` });
        quiet('model_error', agent.id);
        out = 'Sorry, I hit an error. Please try again in a minute.';
      }
      if (ctx.modelError) quiet('model_error', agent.id);
      else if (!out) quiet('no_reply', agent.id);
    }
    if (out) await reply(out);

    async function reply(text) {
      if (!msg.isGroup) { const notice = dmNoticeOnce(msg.phone || msg.chat); if (notice) text = `${text}\n\n_${notice}_`; } // 044: once per person
      const sent = await channel.send(msg.chat, text, { quoted: msg.raw });
      countStat('reply', { agent: agent.id });
      logMessage({
        channel: msg.channel, chat: msg.chat, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent',
        name: 'Assistant', text, fromAgent: true,
      });
      activity('message.out', { agent: agent.id, chat: msg.chat, summary: text });
    }
  };
}
