import { isChatEnabled, ignoredCounts } from './chat-prefs.js';
import { env } from './config.js';
import { getSettings } from './store.js';
import { listBots, getBot, botForChat, roleIn } from './bots.js';
import { runAgent, handleConfirmCommand } from './agent.js';
import { logMessage, messageByMsgId, saveReaction, savePollVote, pollTally } from './db.js';
import { activity } from './events.js';
import { maybeSummarize } from './memory.js';
import { setWhatsAppChannel } from './whatsapp-tools.js';

const rate = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (rate.get(key) || []).filter((t) => now - t < 60000);
  list.push(now);
  rate.set(key, list);
  return list.length > env.rateLimitPerMin;
}

const isAnyOrganizer = (phone) => !!phone && listBots().some((b) => b.organizers.includes(phone));
const startsWithTrigger = (bot, lower) => (bot.triggers || []).find((t) => lower.startsWith(t));

function stripTriggers(bot, text) {
  let t = text.replace(/@\d{5,}/g, ' ').trim();
  const trig = startsWithTrigger(bot, t.toLowerCase());
  if (trig) t = t.slice(trig.length);
  return t.trim();
}

/**
 * Role of a sender for a bot. Saved organizers decide; while a bot has none saved, WhatsApp admins of the bot's
 * groups are its organizers (015: "group admins as the default").
 */
export async function resolveRole(bot, msg, channel) {
  const saved = roleIn(bot, msg.phone);
  if (saved === 'organizer' || bot.organizers.length || !msg.phone) return saved;
  const groups = msg.isGroup ? [msg.chat] : bot.chats.filter((c) => !/@(s\.whatsapp\.net|lid)$/.test(c));
  for (const g of groups) {
    try {
      const members = await channel.groupMembers?.(g);
      if (members?.some((m) => m.admin && m.phone === msg.phone)) return 'organizer';
    } catch { /* not a member / offline */ }
  }
  return 'participant';
}

/** Pick the bot for a direct message, or null. */
async function botForDm(msg, channel, { openOnly = false } = {}) {
  // A 1:1 chat an admin assigned to a bot (Chats page) always goes to that bot.
  const assigned = botForChat(msg.chat);
  if (assigned) return assigned.enabled && (!openOnly || assigned.dm === 'anyone') ? assigned : null;
  if (openOnly) { // chat is off: only an agent that explicitly answers anyone may take it
    const open = listBots().filter((b) => b.enabled && b.dm === 'anyone');
    const lower = msg.text.trim().toLowerCase();
    const numberDefault = (getSettings().whatsappNumbers || []).find((n) => n.id === (msg.number || 'main'))?.dmBot;
    return open.find((b) => startsWithTrigger(b, lower)) || open.find((b) => b.id === numberDefault) || open.find((b) => b.id === getSettings().defaultDmBot) || open[0] || null;
  }
  const lower = msg.text.trim().toLowerCase();
  const enabled = listBots().filter((b) => b.enabled);
  const byTrigger = enabled.find((b) => startsWithTrigger(b, lower));
  const numberDefault = (getSettings().whatsappNumbers || []).find((n) => n.id === (msg.number || 'main'))?.dmBot;
  const candidates = byTrigger ? [byTrigger]
    : [getBot(numberDefault), getBot(getSettings().defaultDmBot), ...enabled].filter((b) => b?.enabled);
  for (const bot of candidates) {
    if (bot.dm === 'none') continue;
    const role = await resolveRole(bot, msg, channel);
    if (bot.dm === 'anyone' || role === 'organizer') return bot;
    if (bot.dm === 'organizers') continue;
    if (bot.participants.includes(msg.phone)) return bot;
    for (const chat of bot.chats) {
      if (await channel.isMember(chat, msg.phone, msg.senderJid)) return bot;
    }
  }
  return null;
}

const summarizeLater = (chat, bot) => { maybeSummarize(chat, bot).catch(() => {}); };

/** Store WhatsApp history batches (link/reconnect sync). Never replies. Group chats only. */
export function createHistoryHandler() {
  return async function onHistory(msgs) {
    const touched = new Map();
    let stored = 0;
    for (const m of msgs) {
      if (!m.isGroup || (m.kind && m.kind !== 'text')) continue; // never store private chats from history
      if (!isChatEnabled(m.chat)) continue; // nor groups that are switched off (#10)
      const bot = botForChat(m.chat);
      const id = logMessage({
        channel: m.channel, chat: m.chat, bot: bot?.id || '', msgId: m.msgId, sender: m.phone, name: m.senderName,
        text: m.text, quoted: m.quoted, fromBot: m.fromMe, ts: m.ts, senderJid: m.fromMe ? '' : m.senderJid,
      });
      if (id) { stored++; touched.set(m.chat, bot); }
    }
    if (stored) activity('memory.history', { summary: `Stored ${stored} history message(s) from ${touched.size} group(s)` });
    for (const [chat, bot] of touched) summarizeLater(chat, bot);
  };
}

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/**
 * Reactions and poll votes (026): stored for context, never answered. Reactions are kept when they are on a bot's
 * message or in a chat bound to an enabled bot; votes when the poll is known (created while the app ran).
 */
function recordEvent(msg) {
  const who = msg.phone || msg.senderJid || 'someone';
  const bot = botForChat(msg.chat);
  if (msg.kind === 'reaction') {
    const target = msg.target ? messageByMsgId(msg.chat, msg.target) : null;
    if (!target?.from_bot && !(bot?.enabled && msg.isGroup)) return;
    saveReaction({ chat: msg.chat, msgId: msg.target, sender: who, name: msg.senderName, emoji: msg.emoji, ts: msg.ts });
    activity('whatsapp.reaction', { bot: bot?.id || target?.bot || '', chat: msg.chat,
      summary: msg.emoji ? `${msg.senderName} reacted ${msg.emoji} to "${clip(target?.text || 'a message', 80)}"` : `${msg.senderName} removed a reaction` });
    return;
  }
  if (msg.kind === 'poll_vote') {
    const p = savePollVote({ chat: msg.chat, msgId: msg.pollId, voter: who, name: msg.senderName, selected: msg.selected || [], ts: msg.ts });
    if (!p) return;
    activity('whatsapp.vote', { bot: bot?.id || '', chat: msg.chat,
      summary: `${msg.senderName} voted ${msg.selected?.length ? msg.selected.join(', ') : '(withdrew)'} in "${clip(p.name, 60)}" → ${pollTally(p).map((o) => `${o.name} ${o.votes}`).join(', ')}` });
  }
}

/** Build the live message router for a channel. */
export function createRouter(channel) {
  setWhatsAppChannel(channel);
  return async function onMessage(msg) {
    // Reactions and poll votes: recorded only for chats that are on (#10).
    if (msg.kind && msg.kind !== 'text') { if (isChatEnabled(msg.chat)) recordEvent(msg); return; }
    // A media caption can address the bot ("!panduga what is this?"); the stored text is the placeholder.
    const wake = msg.caption || msg.text;
    const lower = wake.trim().toLowerCase();
    const groupBot = msg.isGroup ? botForChat(msg.chat) : null;

    // Silent by default (#10): a chat that is off is ignored completely — nothing stored, no model call — except
    // organizers' admin helpers below, and direct messages to an agent explicitly set to answer anyone.
    let openBot = null;
    if (!isChatEnabled(msg.chat)) {
      const helper = isAnyOrganizer(msg.phone) && ((msg.isGroup && lower === '!groupid') || (!msg.isGroup && lower === '!groups'));
      const open = !msg.isGroup && !helper ? await botForDm(msg, channel, { openOnly: true }) : null;
      if (!helper && !open) {
        ignoredCounts.set(msg.chat, (ignoredCounts.get(msg.chat) || 0) + 1);
        return;
      }
      openBot = open;
      if (helper) { // organizer helper in a chat that is off: answer it, store nothing
        if (msg.isGroup) await channel.send(msg.chat, `Group id: ${msg.chat}`, { quoted: msg.raw });
        else await channel.send(msg.chat, (await channel.listChats()).map((g) => `${g.name} (${g.size})\n${g.id}`).join('\n\n') || 'No groups.');
        return;
      }
    }

    // Groups: remember everything said (bound or not, paused or not) so bots have context.
    let rowId = 0;
    if (msg.isGroup) {
      rowId = logMessage({
        channel: msg.channel, chat: msg.chat, bot: groupBot?.id || '', msgId: msg.msgId, sender: msg.phone,
        name: msg.senderName, text: msg.text, quoted: msg.quoted, ts: msg.ts, senderJid: msg.senderJid,
      });
      summarizeLater(msg.chat, groupBot);
    }
    if (getSettings().paused) return;

    // Admin helpers for organizers of any bot
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

    const bot = msg.isGroup ? groupBot : openBot || await botForDm(msg, channel);
    if (!bot || !bot.enabled) return;
    if (!msg.isGroup) {
      rowId = logMessage({
        channel: msg.channel, chat: msg.chat, bot: bot.id, msgId: msg.msgId, sender: msg.phone,
        name: msg.senderName, text: msg.text, quoted: msg.quoted, addressed: true, ts: msg.ts, senderJid: msg.senderJid,
      });
    }

    const role = bot.hooks.role ? (await bot.hooks.role(msg, bot)) || await resolveRole(bot, msg, channel) : await resolveRole(bot, msg, channel);
    const isConfirm = /^(confirm|cancel)\s+[a-z0-9]{4}$/i.test(lower);
    const addressed = !msg.isGroup
      || (bot.respondToMentions && (msg.mentioned || msg.replyToBot))
      || !!startsWithTrigger(bot, lower);
    const triggered = addressed || isConfirm;

    // Hooks can observe every routed message and optionally answer without the LLM.
    if (bot.hooks.onMessage) {
      const hookReply = await bot.hooks.onMessage({ msg, bot, role, triggered, channel });
      if (typeof hookReply === 'string' && hookReply) {
        await reply(hookReply);
        return;
      }
    }
    if (!triggered) return;
    if (rateLimited(`${bot.id}:${msg.phone || msg.senderJid}`)) {
      activity('system', { bot: bot.id, chat: msg.chat, summary: `Rate limited ${msg.senderName}` });
      return;
    }

    const text = msg.caption ? `${msg.text.replace(/:.*$/s, ']')} ${stripTriggers(bot, msg.caption)}`.trim() : stripTriggers(bot, msg.text);
    let out = await handleConfirmCommand({ bot, text, role, chat: msg.chat });
    if (out === undefined && !addressed) return; // looked like "cancel ABCD" but isn't ours
    activity('message.in', {
      bot: bot.id, chat: msg.chat,
      summary: `${msg.senderName} (${role}): ${text}`,
      detail: { phone: msg.phone, isGroup: msg.isGroup, quoted: msg.quoted || undefined },
    });

    if (out === undefined) {
      if (!text) return;
      await channel.typing?.(msg.chat);
      const ctx = {
        bot, role, chat: msg.chat, senderName: msg.senderName, requester: msg.phone,
        text, isGroup: msg.isGroup, source: msg.channel, msgRowId: rowId, msgId: msg.msgId, senderJid: msg.senderJid,
        chatName: msg.isGroup ? await channel.chatName?.(msg.chat) : '',
      };
      try {
        out = await runAgent(ctx);
      } catch (e) {
        activity('error', { bot: bot.id, chat: msg.chat, summary: `Agent failed: ${e.message}` });
        out = 'Sorry, I hit an error. Please try again in a minute.';
      }
    }
    if (out) await reply(out);

    async function reply(text) {
      const sent = await channel.send(msg.chat, text, { quoted: msg.raw });
      logMessage({
        channel: msg.channel, chat: msg.chat, bot: bot.id, msgId: sent?.msgId || null, sender: 'bot',
        name: 'Assistant', text, fromBot: true,
      });
      activity('message.out', { bot: bot.id, chat: msg.chat, summary: text });
    }
  };
}
