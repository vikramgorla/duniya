import { env } from './config.js';
import { getSettings } from './store.js';
import { listBots } from './bots.js';
import { runAgent } from './agent.js';
import { kvGet, kvSet, logMessage } from './db.js';
import { activity } from './events.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function nowParts(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, day: p.weekday.slice(0, 3).toLowerCase() };
}

const dayMatches = (days, day) => !days || days === 'daily' || days.split(',').map((d) => d.trim().toLowerCase()).includes(day);

/** Run one schedule now. Returns [{chat, reply}] */
export async function runSchedule(bot, sched, channel, { force = false } = {}) {
  const chats = sched.chats === 'all' ? bot.chats : sched.chats;
  const results = [];
  const { date } = nowParts(bot.timezone || env.timezone);
  for (const chat of chats) {
    const key = `sched:${bot.id}:${sched.id}:${chat}:${date}`;
    if (!force && kvGet(key)) continue;
    kvSet(key, '1');
    try {
      const reply = await runAgent({
        bot, role: 'participant', chat, senderName: 'scheduler', requester: 'scheduler',
        text: `${sched.prompt}\n(If there is nothing worth posting, reply with exactly: SKIP)`,
        isGroup: chat.endsWith('@g.us'), source: 'schedule',
      });
      const skip = !reply || reply.trim() === 'SKIP';
      if (!skip) {
        const sent = await channel.send(chat, reply);
        logMessage({ chat, bot: bot.id, msgId: sent?.msgId || null, sender: 'bot', name: 'Assistant', text: reply, fromBot: true });
      }
      activity('schedule.run', { bot: bot.id, chat, summary: `${sched.id}: ${skip ? 'skipped' : 'posted'}`, detail: { reply } });
      results.push({ chat, reply: skip ? null : reply });
    } catch (e) {
      activity('error', { bot: bot.id, chat, summary: `Schedule ${sched.id} failed: ${e.message}` });
    }
  }
  return results;
}

export function startScheduler(channel) {
  setInterval(async () => {
    if (getSettings().paused) return;
    for (const bot of listBots()) {
      if (!bot.enabled) continue;
      const { hhmm, day } = nowParts(bot.timezone || env.timezone);
      for (const s of bot.schedules || []) {
        if (s.enabled === false || s.at !== hhmm || !dayMatches(s.days, day)) continue;
        await runSchedule(bot, s, channel);
      }
    }
  }, 30 * 1000).unref();
}

export { DAYS };
