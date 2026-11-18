// @ts-check
// Shared upkeep (057, #110): small background chores the owner should never have to click, run from the scheduler's
// existing 30-second tick (no timers of their own). Each tick does a bounded amount of work:
//   - history loads the phone did not answer: up to 2 due retries (history-load.js)
//   - address-book names: the channel refreshes a number's contact names when due (after connect, then daily)
//   - group member lists of chats that are on: up to 2 groups whose refresh is due (on start, after a member change,
//     then every 12 h) — learns LID↔phone pairs (the member list carries no tags, #117)
//   - retention and health (069): free disk space every tick; old data pruned in bounded batches at most hourly
//     (retention.js) — also while memory is tight (pruning makes things smaller); a WhatsApp number that keeps
//     reconnecting for 15 minutes is reported to the owner once
//   - People (078): merge undo records older than 30 days (at most 200 per tick); 079: the members of those groups
//     become people (identities only), and up to 300 changed phone contacts per tick become people
//   - read receipts (080): the ones that are due (pace.js; also drained on every incoming message)
//   - agent apps (074): turns whose tool calls nobody answered are ended; idle app runtimes (Copilot) are stopped
// Names and group refreshes are skipped while memory is tight (optional work, resources.js).
import { optionalPaused } from './resources.js';
import { enabledChats } from './chat-prefs.js';
import { historyRetryTick } from './history-load.js';
import { activity } from './events.js';
import { isGroup } from '../channels/index.js';
import { retentionTick } from './retention.js';
import { sendOwnerAlert } from './owner-alerts.js';
import { appsTick } from './providers/apps.js';
import { pruneMerges } from './people-ops.js';
import { noteMembers, syncPhonePeople } from './people-access.js';
import { rebuildStaleSummary } from './memory.js';
import { agentForChat } from './agents.js';
import { channelOf } from '../channels/index.js';
import { drainReads } from './pace.js';

const GROUP_EVERY_MS = 12 * 3600000;
const DOWN_ALERT_MS = 15 * 60000;
const downSince = new Map(); // number -> { since, alerted }

/** 069: a number that keeps reconnecting for 15 minutes (not unlinked, not waiting for a scan) is reported once. */
async function channelHealth(channel, now) {
  const numbers = (await channel?.status?.().catch(() => null))?.numbers || [];
  for (const n of numbers) {
    if (!['reconnecting', 'closed', 'starting'].includes(n.status)) { downSince.delete(n.id); continue; }
    const d = downSince.get(n.id) || { since: now, alerted: false };
    downSince.set(n.id, d);
    if (!d.alerted && now - d.since >= DOWN_ALERT_MS) {
      d.alerted = true;
      const text = `WhatsApp number ${n.label || n.id} has been reconnecting for ${Math.round((now - d.since) / 60000)} minutes${n.lastError ? ` (${n.lastError})` : ''}. It keeps retrying by itself; if it stays down, check the server's internet connection or restart the app on the Server screen.`;
      activity('error', { summary: text });
      sendOwnerAlert(`Duniya: ${text}`, { kind: 'whatsapp' }).catch(() => {});
    }
  }
}
const GROUPS_PER_TICK = 2;
const groupDue = new Map(); // chat -> due time (ms)

/** A group's member list changed (participants update): refresh it on the next tick. */
export const markGroupDue = (chat, at = Date.now()) => { if (isGroup(chat)) groupDue.set(chat, at); };

let running = false;
export async function upkeepTick(channel, now = Date.now()) {
  if (running) return { skipped: 'running' };
  running = true;
  const done = { retries: 0, names: false, groups: 0, prune: null, phonePeople: 0, reads: 0 };
  try {
    try { done.prune = retentionTick(now); } catch (e) { activity('error', { summary: `Pruning old data failed: ${e.message}` }); }
    try { pruneMerges(now); } catch { /* 078: retried next tick */ }
    try { appsTick(now); } catch { /* 074: agent apps — abandoned turns, idle runtimes; never blocks upkeep */ }
    await channelHealth(channel, now);
    try { done.reads = await drainReads(channel, now); } catch { /* 080: retried next tick */ }
    try { done.retries = await historyRetryTick(now); } catch (e) { activity('error', { summary: `History retry failed: ${e.message}` }); }
    if (optionalPaused()) return { ...done, skipped: 'memory' };
    try { done.names = !!(await channel?.upkeep?.())?.ok; } catch { /* the channel reports its own failures */ }
    try { await rebuildStaleSummary(agentForChat); } catch { /* #178: retried next tick */ }
    try { done.phonePeople = syncPhonePeople(); } catch (e) { activity('error', { summary: `Phone contacts to People failed: ${e.message}` }); }
    if (typeof channel?.groupMembers !== 'function') return done;
    const on = new Set(enabledChats().filter(isGroup));
    for (const c of [...groupDue.keys()]) if (!on.has(c)) groupDue.delete(c);
    for (const c of on) if (!groupDue.has(c)) groupDue.set(c, now); // new or just switched on: due now
    const due = [...groupDue].filter(([, at]) => at <= now).sort((a, b) => a[1] - b[1]).slice(0, GROUPS_PER_TICK);
    for (const [chat] of due) {
      groupDue.set(chat, now + GROUP_EVERY_MS);
      try {
        await channel.refreshGroup?.(chat);
        noteMembers(channelOf(chat), chat, await channel.groupMembers(chat) || []); // 079: members become people
        done.groups++;
      } catch { /* offline or not a member: try again next round */ }
    }
    return done;
  } finally { running = false; }
}

/** Tests. */
export const resetUpkeep = () => { groupDue.clear(); downSince.clear(); running = false; };
