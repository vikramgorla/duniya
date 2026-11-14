import { env } from './config.js';
import { getSettings } from './store.js';
import { listBots, getBot, botForChat, roleIn } from './bots.js';
import { runAgent, handleConfirmCommand } from './agent.js';
import { logMessage } from './db.js';
import { activity } from './events.js';
import { maybeSummarize } from './memory.js';

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

/** Pick the bot for a direct message, or null. */
async function botForDm(msg, channel) {
  const lower = msg.text.trim().toLowerCase();
  const enabled = listBots().filter((b) => b.enabled);
  const byTrigger = enabled.find((b) => startsWithTrigger(b, lower));
  const candidates = byTrigger ? [byTrigger]
    : [getBot(getSettings().defaultDmBot), ...enabled].filter((b) => b?.enabled);
  for (const bot of candidates) {
    if (bot.dm === 'none') continue;
    const role = roleIn(bot, msg.phone);
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
      if (!m.isGroup) continue; // never store private chats from history
      const bot = botForChat(m.chat);
      const id = logMessage({
        channel: m.channel, chat: m.chat, bot: bot?.id || '', msgId: m.msgId, sender: m.phone, name: m.senderName,
        text: m.text, quoted: m.quoted, fromBot: m.fromMe, ts: m.ts,
      });
      if (id) { stored++; touched.set(m.chat, bot); }
    }
    if (stored) activity('memory.history', { summary: `Stored ${stored} history message(s) from ${touched.size} group(s)` });
    for (const [chat, bot] of touched) summarizeLater(chat, bot);
  };
}

/** Build the live message router for a channel. */
export function createRouter(channel) {
  return async function onMessage(msg) {
    const lower = msg.text.trim().toLowerCase();
    const groupBot = msg.isGroup ? botForChat(msg.chat) : null;

    // Groups: remember everything said (bound or not, paused or not) so bots have context.
    let rowId = 0;
    if (msg.isGroup) {
      rowId = logMessage({
        channel: msg.channel, chat: msg.chat, bot: groupBot?.id || '', msgId: msg.msgId, sender: msg.phone,
        name: msg.senderName, text: msg.text, quoted: msg.quoted, ts: msg.ts,
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

    const bot = msg.isGroup ? groupBot : await botForDm(msg, channel);
    if (!bot || !bot.enabled) return;
    if (!msg.isGroup) {
      rowId = logMessage({
        channel: msg.channel, chat: msg.chat, bot: bot.id, msgId: msg.msgId, sender: msg.phone,
        name: msg.senderName, text: msg.text, quoted: msg.quoted, addressed: true, ts: msg.ts,
      });
    }

    const role = bot.hooks.role ? (await bot.hooks.role(msg, bot)) || roleIn(bot, msg.phone) : roleIn(bot, msg.phone);
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

    const text = stripTriggers(bot, msg.text);
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
        text, isGroup: msg.isGroup, source: msg.channel, msgRowId: rowId,
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
