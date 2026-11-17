// @ts-check
// Shared upkeep (057, #110): small background chores the owner should never have to click, run from the scheduler's
// existing 30-second tick (no timers of their own). Each tick does a bounded amount of work:
//   - history loads the phone did not answer: up to 2 due retries (history-load.js)
//   - address-book names: the channel refreshes a number's contact names when due (after connect, then daily)
//   - group member lists of chats that are on: up to 2 groups whose refresh is due (on start, after a member change,
//     then every 12 h) — learns LID↔phone pairs (the member list carries no tags, #117)
//   - plan usage (067): the usage endpoint of at most one model account (Copilot, OpenRouter), each every 30 minutes
// Names, group and plan-usage refreshes are skipped while memory is tight (optional work, resources.js).
import { optionalPaused } from './resources.js';
import { enabledChats } from './chat-prefs.js';
import { historyRetryTick } from './history-load.js';
import { activity } from './events.js';
import { isGroup } from './config.js';
import { planUsageTick } from './providers/index.js';

const GROUP_EVERY_MS = 12 * 3600000;
const GROUPS_PER_TICK = 2;
const groupDue = new Map(); // chat -> due time (ms)

/** A group's member list changed (participants update): refresh it on the next tick. */
export const markGroupDue = (chat, at = Date.now()) => { if (isGroup(chat)) groupDue.set(chat, at); };

let running = false;
export async function upkeepTick(channel, now = Date.now()) {
  if (running) return { skipped: 'running' };
  running = true;
  const done = { retries: 0, names: false, groups: 0, plan: null };
  try {
    try { done.retries = await historyRetryTick(now); } catch (e) { activity('error', { summary: `History retry failed: ${e.message}` }); }
    if (optionalPaused()) return { ...done, skipped: 'memory' };
    try { done.plan = await planUsageTick(now); } catch { /* the provider did not say; next round */ }
    try { done.names = !!(await channel?.upkeep?.())?.ok; } catch { /* the channel reports its own failures */ }
    if (typeof channel?.refreshGroup !== 'function') return done;
    const on = new Set(enabledChats().filter(isGroup));
    for (const c of [...groupDue.keys()]) if (!on.has(c)) groupDue.delete(c);
    for (const c of on) if (!groupDue.has(c)) groupDue.set(c, now); // new or just switched on: due now
    const due = [...groupDue].filter(([, at]) => at <= now).sort((a, b) => a[1] - b[1]).slice(0, GROUPS_PER_TICK);
    for (const [chat] of due) {
      groupDue.set(chat, now + GROUP_EVERY_MS);
      try { await channel.refreshGroup(chat); done.groups++; } catch { /* offline or not a member: try again next round */ }
    }
    return done;
  } finally { running = false; }
}

/** Tests. */
export const resetUpkeep = () => { groupDue.clear(); running = false; };
