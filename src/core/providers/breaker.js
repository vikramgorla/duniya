// @ts-check
// Circuit breaker per provider account (042, issue #43). A retryable failure pauses the account: 1 minute, doubling up
// to 30 minutes, or until the provider's Retry-After / reset time for quota and rate limits. While paused the account
// is skipped; after the pause one call probes it (others keep skipping) and success closes the breaker. An expired or
// rejected sign-in marks the account "needs reconnect" until its credentials change.
// State is kept in memory and mirrored to SQLite (#64), so a restart keeps pauses, back-off and "needs reconnect";
// only the in-flight probe flag is not stored (after a restart the next call probes).
import { activity } from '../events.js';
import { putTtl, deleteTtl, clearTtl, listTtl } from '../ttl-store.js';
import { sendOwnerAlert } from '../owner-alerts.js';
import { env } from '../config.js';
import { REASON_TEXT } from './errors.js';

export const BASE_MS = 60000;
export const MAX_MS = 30 * 60000;
export const QUOTA_MAX_MS = 24 * 3600000; // a monthly reset is still probed once a day
export const ALERT_AFTER_MS = 15 * 60000;
const ALL_FAILED_ALERT_MS = 60 * 60000;

const states = new Map(); // accountId -> { failures, since, until, reason, message, needsReconnect, probing, alerted, name }
const KIND = 'breaker';
const KEEP_MS = 24 * 3600000; // after the pause ends the failure count (back-off) is kept this long
const RECONNECT_KEEP_MS = 30 * 24 * 3600000; // "needs reconnect" lasts until the credentials change (reset)
let clock = () => Date.now();
/** Tests: replace the clock. Pass null to restore. */
export function setClock(fn) { clock = fn || (() => Date.now()); }
export const now = () => clock();

function save(id, s) {
  const { probing, ...stored } = s;
  try { putTtl(KIND, id, stored, (s.needsReconnect ? now() + RECONNECT_KEEP_MS : Math.max(s.until, now()) + KEEP_MS)); } catch { /* memory still works */ }
}
/** (Re)load stored states, as at startup. Tests call it to simulate a restart. */
export function loadStored() {
  states.clear();
  try { for (const r of listTtl(KIND, now())) states.set(r.key, { ...r.data, probing: false }); } catch { /* no table yet */ }
}
loadStored();

const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: env.timezone });

/** Why it failed: the plan window that is used up when the provider reported it (067), else the reason. */
const why = (s) => s.limit || REASON_TEXT[s.reason] || s.reason;
/** Plain-language status line, e.g. "Paused until 14:20 — usage limit reached" or "… — 5-hour limit used up, resets 14:20". */
function describe(s) {
  if (s.needsReconnect) return 'Sign-in expired or key rejected — reconnect this account';
  if (s.probing) return `Checking again — last error: ${why(s)}`;
  if (s.until > now()) return `Paused until ${hhmm(s.until)} — ${why(s)}`;
  return `Will be tried again on the next message — last error: ${why(s)}`;
}

/** Status of one account for the panel: { state: ok|paused|probing|reconnect, until?, reason?, message?, text? }. */
export function accountState(id) {
  const s = states.get(id);
  if (!s) return { state: 'ok' };
  const state = s.needsReconnect ? 'reconnect' : s.probing ? 'probing' : s.until > now() ? 'paused' : 'probing';
  return { state, until: s.until, since: s.since, reason: s.reason, message: s.message, failures: s.failures, text: describe(s), ...(s.limit ? { limit: s.limit } : {}) };
}
export const allStates = () => Object.fromEntries([...states.keys()].map((id) => [id, accountState(id)]));

/**
 * May this account be called now? false while paused (or while another call probes it). After the pause the first
 * caller gets true and becomes the probe.
 */
export function canTry(id, { name = id } = {}) {
  const s = states.get(id);
  if (!s) return true;
  maybeAlert(id, s, name);
  if (s.until > now()) return false;
  if (s.probing) return false;
  s.probing = true;
  return true;
}

/** Paused (cooling down, or another call is probing it)? Also sends the "failing > 15 min" alert when due. */
/** @param {string} id  @param {{ name?: string }} [o] */
export function isPaused(id, { name } = {}) {
  const s = states.get(id);
  if (!s) return false;
  maybeAlert(id, s, name || s.name || id);
  return s.until > now() || !!s.probing;
}
/** A probe that did not reach the provider (request refused, model missing): let the next call probe instead. */
export function release(id) { const s = states.get(id); if (s) s.probing = false; }

/** Earliest time any of these accounts can be tried again (for "paused until"). */
export const nextTry = (ids) => Math.min(...ids.map((id) => states.get(id)?.until || 0));

/** `limit` (067): the plan window that is used up, e.g. "weekly limit used up, resets Thu 14:20". */
export function recordFailure(id, cls, { name = id, message = '', limit = '' } = {}) {
  const t = now();
  const s = states.get(id) || { failures: 0, since: t, alerted: false, name };
  s.failures++; s.name = name; s.reason = cls.reason; s.message = String(message).slice(0, 300); s.probing = false; s.limit = String(limit || '').slice(0, 120);
  let ms = Math.min(BASE_MS * 2 ** (s.failures - 1), MAX_MS);
  if (cls.retryAfterMs) ms = Math.max(Math.min(cls.retryAfterMs, QUOTA_MAX_MS), cls.reason === 'rate_limit' ? 5000 : BASE_MS);
  if (cls.reason === 'auth') { s.needsReconnect = true; ms = MAX_MS; }
  const first = !states.has(id);
  s.until = t + ms;
  states.set(id, s);
  save(id, s);
  if (first || s.failures === 2) { // one entry when it pauses (and one when the first probe fails), not one per probe
    activity('model.provider', { summary: `${name}: ${describe(s)}`, detail: { account: id, reason: s.reason, until: s.until, error: s.message } });
  }
  maybeAlert(id, s, name);
  return accountState(id);
}

export function recordSuccess(id, { name = id } = {}) {
  const s = states.get(id);
  if (!s) return;
  states.delete(id);
  deleteTtl(KIND, id);
  activity('model.provider', { summary: `${name} is answering again (was paused ${Math.max(1, Math.round((now() - s.since) / 60000))} min: ${why(s)})`, detail: { account: id, recovered: true } });
  if (s.alerted) sendOwnerAlert(`Duniya: ${name} is answering again.`, { kind: 'provider' }).catch(() => {});
}

/** Forget an account's state (credentials changed, account removed). */
export function reset(id) {
  if (id) { states.delete(id); deleteTtl(KIND, id); } else { states.clear(); clearTtl(KIND); }
}

function maybeAlert(id, s, name) {
  if (s.alerted || now() - s.since < ALERT_AFTER_MS) return;
  s.alerted = true;
  if (states.get(id) === s) save(id, s); // one alert per outage, also across a restart
  const text = s.needsReconnect
    ? `Duniya: ${name} needs to be reconnected (sign-in expired or key rejected). Open Models in the panel and reconnect it. Other connected providers answer meanwhile.`
    : `Duniya: ${name} has been failing for ${Math.round((now() - s.since) / 60000)} minutes (${why(s)}). ${s.until > now() ? `It is paused until ${hhmm(s.until)}; ` : ''}other connected providers answer meanwhile. See Models in the panel.`;
  sendOwnerAlert(text, { kind: 'provider' }).catch(() => {});
}

let lastAllFailed = 0;
/** Every candidate failed or was paused: one owner alert per hour. */
export function allFailed(summary) {
  activity('error', { summary: `No AI provider could answer: ${summary}` });
  if (now() - lastAllFailed < ALL_FAILED_ALERT_MS) return false;
  lastAllFailed = now();
  sendOwnerAlert(`Duniya: no AI provider could answer (${summary}). Agents can't reply until one works again. Check Models in the panel.`, { kind: 'provider' }).catch(() => {});
  return true;
}
export const resetAllFailedAlert = () => { lastAllFailed = 0; };

// ---------- switches (deduplicated activity) ----------
const switches = new Map(); // "from>to:reason" -> ts
const SWITCH_DEDUP_MS = 15 * 60000;
/** One activity entry per from → to + reason every 15 minutes. */
export function noteSwitch({ from, to, reason, limit = '', agent = '', chat = '' }) {
  const key = `${from}>${to}:${reason}`;
  if (now() - (switches.get(key) || 0) < SWITCH_DEDUP_MS) return false;
  switches.set(key, now());
  activity('model.fallback', { agent, chat, summary: `Answered by ${to} after ${from} failed (${limit || REASON_TEXT[reason] || reason})`, detail: { from, to, reason, ...(limit ? { limit } : {}) } });
  return true;
}
export const resetSwitches = () => switches.clear();
