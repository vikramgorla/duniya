// @ts-check
import { isChatEnabled } from './chat-prefs.js';
import { dueAt, localParts } from './config.js';
import { agentTz } from './owner-clock.js';
import { isGroup } from '../channels/index.js';
import { getSetting } from './store.js';
import { listAgents, isBuiltin } from './agents.js';
import { runAgent } from './runner.js';
import { kvGet, kvSet, logMessage } from './db.js';
import { activity } from './events.js';
import { runOwnerSchedule, runMorningBrief } from './owner-assistant.js';
import { upkeepTick } from './upkeep.js';

const dayMatches = (days, day) => !days || days === 'daily' || days.split(',').map((d) => d.trim().toLowerCase()).includes(day);

// Posts in progress, in memory only: stored as "running", a restart in that minute (an update) left the post marked
// for good and it never went out that day. Only outcomes are stored ('1', 'fail:<n>').
const running = new Set();
/** Run one schedule now. Returns [{chat, reply}] */
export async function runSchedule(agent, sched, channel, { force = false } = {}) {
  const { date } = localParts(agentTz(agent));
  if (isBuiltin(agent)) return runOwnerSchedule(sched, { date, force }); // 059: to linked owners and admins
  const chats = sched.chats === 'all' ? agent.chats : sched.chats;
  const results = [];
  for (const chat of chats) {
    if (!isChatEnabled(chat)) continue; // #10: never post into chats that are off
    // once a day per chat; a failed run is tried again on the next ticks, at most 3 times
    const key = `sched:${agent.id}:${sched.id}:${chat}:${date}`;
    const was = kvGet(key) || '';
    const fails = Number(was.match(/^fail:(\d)$/)?.[1] || 0);
    if (running.has(key) || (!force && was && !(fails && fails < 3))) continue;
    running.add(key);
    try {
      const reply = await runAgent({
        agent, role: 'participant', chat, senderName: 'scheduler', requester: 'scheduler',
        text: `${sched.prompt}\n(If there is nothing worth posting, reply with exactly: SKIP)`,
        isGroup: isGroup(chat), source: 'schedule',
      });
      const skip = !reply || reply.trim() === 'SKIP';
      if (!skip) {
        const sent = await channel.send(chat, reply);
        logMessage({ chat, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text: reply, fromAgent: true });
      }
      kvSet(key, '1');
      activity('schedule.run', { agent: agent.id, chat, summary: `${sched.id}: ${skip ? 'skipped' : 'posted'}`, detail: { reply } });
      results.push({ chat, reply: skip ? null : reply });
    } catch (e) {
      kvSet(key, `fail:${fails + 1}`);
      activity('error', { agent: agent.id, chat, summary: `Schedule ${sched.id} failed: ${e.message}` });
    } finally { running.delete(key); }
  }
  return results;
}

export function startScheduler(channel) {
  setInterval(async () => {
    upkeepTick(channel).catch(() => {}); // 057: names, member lists, history retries — bounded, never blocks schedules
    runMorningBrief().catch((e) => activity('error', { summary: `Morning brief failed: ${e.message}` })); // 090: once a day, at its time
    const paused = getSetting('paused', false);
    for (const agent of listAgents()) {
      if (!agent.enabled || (paused && !isBuiltin(agent))) continue; // 059: the owner assistant's schedules run even while paused
      const { hhmm, day } = localParts(agentTz(agent));
      for (const s of agent.schedules || []) {
        if (s.enabled === false || !dueAt(s.at, hhmm) || !dayMatches(s.days, day)) continue; // 2.56: or up to 30 min late (a restart that minute)
        await runSchedule(agent, s, channel);
      }
    }
  }, 30 * 1000).unref();
}

