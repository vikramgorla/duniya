import { isChatEnabled } from './chat-prefs.js';
import { env } from './config.js';
import { getSettings } from './store.js';
import { listAgents } from './agents.js';
import { runAgent } from './runner.js';
import { kvGet, kvSet, logMessage } from './db.js';
import { activity } from './events.js';
import { weeklyTick } from './weekly.js';
import { upkeepTick } from './upkeep.js';

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
export async function runSchedule(agent, sched, channel, { force = false } = {}) {
  const chats = sched.chats === 'all' ? agent.chats : sched.chats;
  const results = [];
  const { date } = nowParts(agent.timezone || env.timezone);
  for (const chat of chats) {
    if (!isChatEnabled(chat)) continue; // #10: never post into chats that are off
    const key = `sched:${agent.id}:${sched.id}:${chat}:${date}`;
    if (!force && kvGet(key)) continue;
    kvSet(key, '1');
    try {
      const reply = await runAgent({
        agent, role: 'participant', chat, senderName: 'scheduler', requester: 'scheduler',
        text: `${sched.prompt}\n(If there is nothing worth posting, reply with exactly: SKIP)`,
        isGroup: chat.endsWith('@g.us'), source: 'schedule',
      });
      const skip = !reply || reply.trim() === 'SKIP';
      if (!skip) {
        const sent = await channel.send(chat, reply);
        logMessage({ chat, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text: reply, fromAgent: true });
      }
      activity('schedule.run', { agent: agent.id, chat, summary: `${sched.id}: ${skip ? 'skipped' : 'posted'}`, detail: { reply } });
      results.push({ chat, reply: skip ? null : reply });
    } catch (e) {
      activity('error', { agent: agent.id, chat, summary: `Schedule ${sched.id} failed: ${e.message}` });
    }
  }
  return results;
}

export function startScheduler(channel) {
  setInterval(async () => {
    try { await weeklyTick(); } catch (e) { activity('error', { summary: `Weekly summary failed: ${e.message}` }); } // 041: owner summary, even while paused
    upkeepTick(channel).catch(() => {}); // 057: names, member lists, history retries — bounded, never blocks schedules
    if (getSettings().paused) return;
    for (const agent of listAgents()) {
      if (!agent.enabled) continue;
      const { hhmm, day } = nowParts(agent.timezone || env.timezone);
      for (const s of agent.schedules || []) {
        if (s.enabled === false || s.at !== hhmm || !dayMatches(s.days, day)) continue;
        await runSchedule(agent, s, channel);
      }
    }
  }, 30 * 1000).unref();
}

export { DAYS };
