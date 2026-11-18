// @ts-check
import { isChatEnabled } from './chat-prefs.js';
import { env, localParts } from './config.js';
import { isGroup } from '../channels/index.js';
import { getSetting } from './store.js';
import { listAgents, isBuiltin } from './agents.js';
import { runAgent } from './runner.js';
import { kvGet, kvSet, logMessage } from './db.js';
import { activity } from './events.js';
import { runOwnerSchedule } from './owner-assistant.js';
import { upkeepTick } from './upkeep.js';

const dayMatches = (days, day) => !days || days === 'daily' || days.split(',').map((d) => d.trim().toLowerCase()).includes(day);

/** Run one schedule now. Returns [{chat, reply}] */
export async function runSchedule(agent, sched, channel, { force = false } = {}) {
  const { date } = localParts(agent.timezone || env.timezone);
  if (isBuiltin(agent)) return runOwnerSchedule(sched, { date, force }); // 059: to linked owners and admins
  const chats = sched.chats === 'all' ? agent.chats : sched.chats;
  const results = [];
  for (const chat of chats) {
    if (!isChatEnabled(chat)) continue; // #10: never post into chats that are off
    const key = `sched:${agent.id}:${sched.id}:${chat}:${date}`;
    if (!force && kvGet(key)) continue;
    kvSet(key, '1');
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
    upkeepTick(channel).catch(() => {}); // 057: names, member lists, history retries — bounded, never blocks schedules
    const paused = getSetting('paused', false);
    for (const agent of listAgents()) {
      if (!agent.enabled || (paused && !isBuiltin(agent))) continue; // 059: the owner assistant's schedules run even while paused
      const { hhmm, day } = localParts(agent.timezone || env.timezone);
      for (const s of agent.schedules || []) {
        if (s.enabled === false || s.at !== hhmm || !dayMatches(s.days, day)) continue;
        await runSchedule(agent, s, channel);
      }
    }
  }, 30 * 1000).unref();
}

