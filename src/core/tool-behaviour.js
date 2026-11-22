// @ts-check
// How an agent uses each tool service (094). Five settings per service — a default on the service (Settings → Tool
// services), overridable per agent (its Tools page); nothing here knows a service or tool by name:
//   1. Who can use it      — the per-role tool rules (tools.js).
//   2. When to use it      — asked | useful (default) | proactive, plus a short note: one compact line per service in
//                            the agent's instructions (servicesNote, token-budgeted).
//   3. Changes it makes    — ask | clear | act for that service (default: the agent's "How sure before changing
//                            things"); the risk of each call comes from the tool's annotations (autonomy.js riskOf),
//                            with a per-tool override.
//   4. Share on its own    — off | sometimes | often + style words, for read-only tools that return media (sharing.js).
//   5. Limits              — uses per reply and per day, and groups and direct messages | direct messages only;
//                            enforced in code (limitStop), with an Activity line when a limit stops a call.
import { kvGet, kvSet } from './db.js';
import { activity } from './events.js';
import { autonomyOf } from './autonomy.js';
import { isGroup } from '../channels/index.js';
import { SERVICE_DEFAULTS } from './schema.js';
import { clip, env, localParts } from './config.js';

/**
 * A service's settings for an agent: the agent's override field by field, else the service's default, else the
 * defaults. `changes` ends as ask | clear | act (empty = the agent's own setting). `srv` may be null (Duniya's tools).
 */
export function behaviourOf(agent, key, srv) {
  const own = agent?.services?.[key] || {};
  const dflt = srv?.behaviour || {};
  const out = {};
  for (const k of Object.keys(SERVICE_DEFAULTS)) {
    if (k === 'tools') continue;
    const v = own[k] !== undefined && own[k] !== 'inherit' && own[k] !== '' ? own[k] : dflt[k] !== undefined && dflt[k] !== '' ? dflt[k] : SERVICE_DEFAULTS[k];
    out[k] = v;
  }
  out.tools = { ...(dflt.tools || {}), ...(own.tools || {}) };
  out.changes = out.changes || autonomyOf(agent);
  return /** @type {typeof SERVICE_DEFAULTS & { changes: string }} */ (out);
}

// ---------- 2. when to use it (and 3. when a service changes differently from the agent): the instructions ----------
const WHEN_TEXT = { asked: 'only when someone asks for that kind of thing', proactive: 'look for chances to use it when it helps' };
const CHANGES_TEXT = { ask: 'show each change and wait for a yes', clear: 'a clear request from an organizer is the go-ahead', act: 'also make changes that clearly follow; report each' };
const NOTE_BUDGET = 900; // characters for the whole section
/**
 * One short line per service whose settings differ from "the agent decides" (and its note), in the agent's instructions.
 * `services`: [{ key, behaviour }]. '' when nothing needs saying.
 */
export function servicesNote(agent, services) {
  const own = autonomyOf(agent);
  const lines = [];
  for (const { key, behaviour: b } of services) {
    const bits = [WHEN_TEXT[b.when], b.changes !== own ? `changes: ${CHANGES_TEXT[b.changes]}` : '', b.where === 'dm' ? 'its results only in direct messages' : '', b.note ? clip(b.note, 160) : ''].filter(Boolean);
    if (bits.length) lines.push(`- ${key}: ${bits.join('; ')}.`);
  }
  if (!lines.length) return '';
  let out = 'How to use your tool services:';
  for (const l of lines) { if (out.length + l.length > NOTE_BUDGET) break; out += `\n${l}`; }
  return out;
}

// ---------- 5. limits ----------
// one row per agent and service: { day, n } (today's uses), overwritten, so nothing piles up
const usesKey = (agent, key) => `uses:${agent}:${key}`;
const today = () => localParts(env.timezone).date;
function usedToday(agent, key) {
  try { const u = JSON.parse(kvGet(usesKey(agent, key)) || '{}'); return u.day === today() ? Number(u.n) || 0 : 0; } catch { return 0; }
}
/**
 * Would this use of a service break one of its limits? `turn`: this reply's uses per service (a Map). Returns the
 * reason (logged in Activity, told to the model) or ''. A use that may go ahead is counted.
 */
export function limitStop(ctx, key, b, turn) {
  const why = b.where === 'dm' && isGroup(ctx.chat) ? 'its results may only be posted in direct messages'
    : b.perReply && (turn.get(key) || 0) >= b.perReply ? `at most ${b.perReply} per reply`
      : b.perDay && usedToday(ctx.agent.id, key) >= b.perDay ? `at most ${b.perDay} per day` : '';
  if (why) {
    activity('limit', { agent: ctx.agent.id, chat: ctx.chat, summary: `Limit: ${key} was not used (${why})`, detail: { service: key, why } });
    return why;
  }
  turn.set(key, (turn.get(key) || 0) + 1);
  if (b.perDay) kvSet(usesKey(ctx.agent.id, key), JSON.stringify({ day: today(), n: usedToday(ctx.agent.id, key) + 1 }));
  return '';
}
