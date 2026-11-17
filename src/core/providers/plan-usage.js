// @ts-check
// Plan usage (067, #135): how much of each model account's plan, credit or rate limit is used — only what the provider
// reports, never estimated. One snapshot per account, kept in memory and in ttl_state (so a restart keeps it):
//   { at, sources: { headers?: { at, limits }, endpoint?: { at, limits } }, alerted: { key: level }, name }
// A limit is { id, kind: 'plan' | 'credit' | 'rate', label, used (0–100 %), resetAt? (ms), detail? }.
//  - plan:   ChatGPT's 5-hour and weekly windows, Copilot's premium requests, OpenRouter's free requests per day
//  - credit: OpenRouter's key limit and prepaid credit
//  - rate:   API rate-limit headroom (Anthropic, OpenAI, compatible endpoints): per-minute, never alerted
// Sources: response headers of every answer and failure (noteHeaders), ChatGPT's `codex.rate_limits` stream event
// (noteEvent) and the endpoints that need a request (noteEndpoint: Copilot, OpenRouter, ChatGPT's usage endpoint;
// see providers/index.js).
// Owner alert: once per limit and window at ≥ 90 % and once more when it is used up (plan and credit limits only).
import { putTtl, listTtl, clearTtl, deleteTtl } from '../ttl-store.js';
import { sendOwnerAlert } from '../owner-alerts.js';
import { env } from '../config.js';

const KIND = 'plan-usage';
const KEEP_MS = 8 * 86400000; // longer than a weekly window
const SAVE_EVERY_MS = 60000; // headers arrive with every answer: write the row at most once a minute per account
export const ALERT_AT = 90;
export const HINT_AT = 80;

/** @typedef {{ id: string, kind: 'plan'|'credit'|'rate', label: string, used: number, resetAt?: number|null, detail?: string }} Limit */
/** @typedef {{ at: number, sources: Record<string, { at: number, limits: Limit[], unavailable?: boolean }>, alerted: Record<string, number>, name?: string, savedAt?: number }} Snapshot */
/** @type {Map<string, Snapshot>} */
const snaps = new Map();
try { for (const r of listTtl(KIND, Date.now())) snaps.set(r.key, { ...r.data, savedAt: Date.now() }); } catch { /* no table yet */ }

// ---------- parsing (defensive: anything unknown is left out) ----------
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const pct = (v) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
const getter = (h) => (k) => (typeof h?.get === 'function' ? h.get(k) : h?.[k] ?? null);
const secsAt = (s, now) => (s == null ? null : s < 1e12 ? s * 1000 : s); // Unix seconds (or ms) → ms
/** "5-hour limit", "weekly limit", "daily limit", from a window length in minutes. */
export function windowLabel(min, fallback) {
  if (!min || min <= 0) return fallback;
  if (min === 10080) return 'weekly limit';
  if (min === 1440) return 'daily limit';
  if (min >= 40000 && min <= 45000) return 'monthly limit';
  if (min % 1440 === 0) return `${min / 1440}-day limit`;
  if (min % 60 === 0) return `${min / 60}-hour limit`;
  return `${min}-minute limit`;
}

/**
 * ChatGPT plan (Codex backend): every header family Codex reads (codex-rs/codex-api/src/rate_limits.rs
 * parse_all_rate_limits): x-<limit>-{primary,secondary}-{used-percent,window-minutes,reset-at|reset-after-seconds}, the
 * default limit "codex" plus any other (x-codex-other-…, named by x-<limit>-limit-name).
 */
function codexHeaders(get, keys, now) {
  const fams = new Set(['codex']);
  for (const k of keys) { const m = /^x-([a-z0-9-]+)-primary-used-percent$/.exec(k); if (m && !m[1].startsWith('ratelimit')) fams.add(m[1]); }
  const out = [];
  for (const fam of fams) {
    const name = fam === 'codex' ? '' : String(get(`x-${fam}-limit-name`) || '').trim().slice(0, 60);
    for (const [w, fallback] of [['primary', 'short limit'], ['secondary', 'weekly limit']]) {
      const used = num(get(`x-${fam}-${w}-used-percent`));
      if (used === null) continue;
      const min = num(get(`x-${fam}-${w}-window-minutes`));
      const at = num(get(`x-${fam}-${w}-reset-at`)); const after = num(get(`x-${fam}-${w}-reset-after-seconds`));
      out.push(windowLimit(fam === 'codex' ? `codex-${w}` : `${fam}-${w}`, name || (fam === 'codex' ? '' : fam), min, fallback, used, at !== null ? secsAt(at, now) : after !== null ? now + after * 1000 : null));
    }
  }
  return out;
}
const windowLimit = (id, name, min, fallback, used, resetAt) =>
  ({ id, kind: /** @type {'plan'} */ ('plan'), label: `${name ? `${name} ` : ''}${windowLabel(min, fallback)}`, used: pct(used), resetAt, window: min || null });
/** Anthropic: anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset (RFC 3339)}. */
function anthropicHeaders(get) {
  const out = [];
  for (const [k, label] of [['requests', 'requests per minute'], ['input-tokens', 'input tokens per minute'], ['output-tokens', 'output tokens per minute'], ['tokens', 'tokens per minute']]) {
    const limit = num(get(`anthropic-ratelimit-${k}-limit`)); const left = num(get(`anthropic-ratelimit-${k}-remaining`));
    if (!limit || left === null) continue;
    const reset = Date.parse(String(get(`anthropic-ratelimit-${k}-reset`) || ''));
    out.push({ id: `rate-${k}`, kind: 'rate', label, used: pct(((limit - left) / limit) * 100), resetAt: Number.isFinite(reset) ? reset : null, detail: `${left.toLocaleString('en')} of ${limit.toLocaleString('en')} left` });
  }
  return out;
}
/** "6m0s", "1.5s", "20ms", "2h" → ms (OpenAI-style reset durations); a plain number is seconds. */
export function durationMs(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  let ms = 0; let any = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) { any = true; ms += Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]]; }
  return any ? Math.round(ms) : null;
}
/** OpenAI and compatible endpoints: x-ratelimit-{limit,remaining,reset}-{requests,tokens}. */
function openaiHeaders(get, now) {
  const out = [];
  for (const [k, label] of [['requests', 'requests per minute'], ['tokens', 'tokens per minute']]) {
    const limit = num(get(`x-ratelimit-limit-${k}`)); const left = num(get(`x-ratelimit-remaining-${k}`));
    if (!limit || left === null) continue;
    const ms = durationMs(get(`x-ratelimit-reset-${k}`));
    out.push({ id: `rate-${k}`, kind: 'rate', label, used: pct(((limit - left) / limit) * 100), resetAt: ms !== null ? now + ms : null, detail: `${left.toLocaleString('en')} of ${limit.toLocaleString('en')} left` });
  }
  return out;
}
/** Every limit the response headers report (the header families do not overlap). */
export function parseHeaders(headers, now = Date.now()) {
  if (!headers) return [];
  const get = getter(headers);
  const keys = typeof headers.keys === 'function' ? [...headers.keys()] : Object.keys(headers);
  return [...codexHeaders(get, keys.map((k) => String(k).toLowerCase()), now), ...anthropicHeaders(get), ...openaiHeaders(get, now)];
}
/** ChatGPT's `codex.rate_limits` stream event: { rate_limits: { primary, secondary: { used_percent, window_minutes, reset_at } } }. */
export function parseCodexEvent(ev, now = Date.now()) {
  const rl = ev?.rate_limits;
  if (!rl || typeof rl !== 'object') return [];
  const out = [];
  for (const [w, fallback] of [['primary', 'short limit'], ['secondary', 'weekly limit']]) {
    const x = rl[w]; const used = num(x?.used_percent);
    if (used === null) continue;
    const min = num(x.window_minutes); const at = num(x.reset_at ?? x.resets_at); const after = num(x.reset_after_seconds ?? x.resets_in_seconds);
    out.push(windowLimit(`codex-${w}`, '', min, fallback, used, at !== null ? secsAt(at, now) : after !== null ? now + after * 1000 : null));
  }
  return out;
}

// ---------- endpoints ----------
/**
 * ChatGPT's usage endpoint (GET {chatgpt_base_url}/wham/usage, as Codex reads it: codex-rs/backend-client
 * rate_limit_resets.rs + codex-backend-openapi-models RateLimitStatusPayload): { plan_type, rate_limit: { primary_window,
 * secondary_window: { used_percent, limit_window_seconds, reset_after_seconds, reset_at } }, additional_rate_limits:
 * [{ limit_name, metered_feature, rate_limit }] }. Null when the body has none of it.
 */
export function parseWhamUsage(json, now = Date.now()) {
  if (!json || typeof json !== 'object') return null;
  const out = [];
  const windows = (rl, prefix, name) => {
    if (!rl || typeof rl !== 'object') return;
    for (const [w, key, fallback] of [['primary', 'primary_window', 'short limit'], ['secondary', 'secondary_window', 'weekly limit']]) {
      const x = rl[key]; const used = num(x?.used_percent);
      if (used === null) continue;
      const secs = num(x.limit_window_seconds); const at = num(x.reset_at); const after = num(x.reset_after_seconds);
      out.push(windowLimit(`${prefix}-${w}`, name, secs ? Math.round(secs / 60) : null, fallback, used, at ? secsAt(at, now) : after !== null ? now + after * 1000 : null));
    }
  };
  windows(json.rate_limit, 'codex', '');
  for (const a of Array.isArray(json.additional_rate_limits) ? json.additional_rate_limits.slice(0, 10) : []) {
    const id = String(a?.metered_feature || a?.limit_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    if (id) windows(a.rate_limit, id, String(a.limit_name || '').trim().slice(0, 60));
  }
  return out.length || json.rate_limit === null ? out : null;
}
const COPILOT_LABELS = { premium_interactions: 'premium requests', chat: 'chat messages' };
/** GitHub's copilot_internal/user (what the editors show): quota_snapshots with entitlement / remaining / unlimited. */
export function parseCopilotUser(json) {
  const snapsIn = json?.quota_snapshots;
  if (!snapsIn || typeof snapsIn !== 'object') return null;
  const reset = Date.parse(json.quota_reset_date_utc || json.quota_reset_date || '');
  const out = [];
  for (const [key, label] of Object.entries(COPILOT_LABELS)) {
    const s = snapsIn[key];
    if (!s || s.unlimited) continue;
    const total = num(s.entitlement); const left = num(s.remaining); const remPct = num(s.percent_remaining);
    const used = remPct !== null ? 100 - remPct : total ? ((total - (left ?? total)) / total) * 100 : null;
    if (used === null) continue;
    out.push({ id: `copilot-${key}`, kind: 'plan', label, used: pct(used), resetAt: Number.isFinite(reset) ? reset : null,
      detail: total !== null && left !== null ? `${Math.max(0, Math.round(left))} of ${Math.round(total)} left` : '' });
  }
  return out;
}
const usd = (v) => `$${v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString('en')}`;
const nextUtc = (unit, now) => {
  const d = new Date(now);
  if (unit === 'daily') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  if (unit === 'weekly') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  if (unit === 'monthly') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return null;
};
/** OpenRouter GET /key (`data`): key credit limit and free-model requests per day; GET /credits: prepaid credit. */
export function parseOpenRouter(key, credits, now = Date.now()) {
  const d = key?.data; const out = [];
  if (!d || typeof d !== 'object') return null;
  const limit = num(d.limit); const left = num(d.limit_remaining);
  if (limit && limit > 0) {
    const used = left !== null ? limit - left : num(d.usage);
    if (used !== null) {
      out.push({ id: 'or-key-limit', kind: 'credit', label: d.limit_reset ? `${d.limit_reset} key limit` : 'key credit limit', used: pct((used / limit) * 100),
        resetAt: nextUtc(String(d.limit_reset || ''), now), detail: `${usd(Math.max(0, limit - used))} of ${usd(limit)} left` });
    }
  }
  const free = d.free_model_daily_requests;
  if (free && num(free.limit) > 0 && num(free.used) !== null) {
    out.push({ id: 'or-free-daily', kind: 'plan', label: 'free requests today', used: pct((num(free.used) / num(free.limit)) * 100), resetAt: nextUtc('daily', now),
      detail: `${Math.max(0, num(free.remaining) ?? num(free.limit) - num(free.used))} of ${num(free.limit)} left` });
  }
  const c = credits?.data; const total = num(c?.total_credits); const spent = num(c?.total_usage);
  if (total && total > 0 && spent !== null) {
    out.push({ id: 'or-credit', kind: 'credit', label: 'prepaid credit', used: pct((spent / total) * 100), resetAt: null, detail: `${usd(Math.max(0, total - spent))} of ${usd(total)} left` });
  }
  return out;
}

// ---------- store ----------
function save(id, s, force = false) {
  if (!force && s.savedAt && Date.now() - s.savedAt < SAVE_EVERY_MS) return;
  s.savedAt = Date.now();
  const { savedAt, ...stored } = s;
  try { putTtl(KIND, id, stored, Date.now() + KEEP_MS); } catch { /* memory still works */ }
}
function note(id, source, limits, { name = '', now = Date.now() } = {}) {
  if (!id || !Array.isArray(limits) || !limits.length) return null;
  const s = snaps.get(id) || { at: 0, sources: {}, alerted: {} };
  const before = JSON.stringify(s.sources[source]?.limits || []);
  s.sources[source] = { at: now, limits };
  s.at = now; if (name) s.name = name;
  snaps.set(id, s);
  const changed = before !== JSON.stringify(limits);
  alertIfDue(id, s, now);
  save(id, s, changed && source === 'endpoint');
  return view(id, now);
}
/** Response or error headers of a model call. */
export const noteHeaders = (id, headers, o = {}) => note(id, 'headers', parseHeaders(headers, o.now), o);
/** ChatGPT's rate-limit stream event. */
export const noteEvent = (id, ev, o = {}) => note(id, 'headers', parseCodexEvent(ev, o.now), o);
/**
 * Limits read from a provider endpoint (Copilot, OpenRouter, ChatGPT). An empty list means "nothing to show": it clears
 * them; `{ unavailable: true }` means the endpoint refuses this account (kept, so it is asked again only rarely).
 */
export function noteEndpoint(id, limits, o = {}) {
  const now = o.now || Date.now();
  const unavailable = !Array.isArray(limits) && !!limits?.unavailable;
  if (unavailable || (Array.isArray(limits) && !limits.length)) {
    const s = snaps.get(id) || { at: 0, sources: {}, alerted: {} };
    if (o.name) s.name = o.name;
    s.sources.endpoint = { at: now, limits: [], ...(unavailable ? { unavailable: true } : {}) }; snaps.set(id, s); save(id, s, true);
    return view(id, now);
  }
  return note(id, 'endpoint', limits, { ...o, now });
}
/** When the endpoint of this account was last read (0 = never). */
export const endpointAt = (id) => snaps.get(id)?.sources?.endpoint?.at || 0;
/** True when the account's usage endpoint refused it the last time (#140: "not available for this sign-in"). */
export const endpointUnavailable = (id) => !!snaps.get(id)?.sources?.endpoint?.unavailable;
/** Forget an account (removed, credentials changed). Without id: everything (tests). */
export function forget(id) {
  if (id) { snaps.delete(id); try { deleteTtl(KIND, id); } catch { /* ignore */ } } else { snaps.clear(); try { clearTtl(KIND); } catch { /* ignore */ } }
}

/**
 * What the panel, the admin tools and the alerts show: { at (latest update), limits } or null when the provider
 * reports nothing. A window whose reset time has passed is shown as renewed (0 % used).
 */
export function view(id, now = Date.now()) {
  const s = snaps.get(id);
  if (!s) return null;
  const limits = []; const seen = new Set();
  // the newest source wins for a limit both report (ChatGPT: answer headers and the usage endpoint, #140)
  for (const src of Object.values(s.sources || {}).sort((a, b) => b.at - a.at)) {
    for (const l of src.limits || []) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      if (l.resetAt && l.resetAt <= now) limits.push({ ...l, used: 0, resetAt: null, detail: l.kind === 'rate' ? 'full again' : 'renewed since the last answer' });
      else limits.push({ ...l });
    }
  }
  if (!limits.length) return null;
  const order = { plan: 0, credit: 1, rate: 2 };
  limits.sort((a, b) => order[a.kind] - order[b.kind] || b.used - a.used);
  return { at: s.at, limits };
}
/** The tightest plan or credit limit (for list rows, Overview and the owner assistant). */
export const tightest = (id, now) => view(id, now)?.limits.find((l) => l.kind !== 'rate') || null;

const when = (ts, now = Date.now()) => {
  const opts = /** @type {Intl.DateTimeFormatOptions} */ ({ hour: '2-digit', minute: '2-digit', timeZone: env.timezone, hour12: false });
  if (ts - now > 20 * 3600000) Object.assign(opts, { weekday: 'short', day: 'numeric', month: 'short' });
  return new Date(ts).toLocaleString('en-GB', opts);
};
/** "5-hour limit used up, resets 14:20" / "92% of the weekly limit used". */
export function limitText(l, now = Date.now()) {
  const reset = l.resetAt ? `, resets ${when(l.resetAt, now)}` : '';
  return l.used >= 100 ? `${l.label} used up${reset}` : `${Math.round(l.used)}% of the ${l.label} used${reset}`;
}
/**
 * Why a plan account is out (for pause and fallback messages): the plan/credit limit that is used up (or, failing that,
 * the fullest one at ≥ 90 %): { text, resetAt } or null.
 */
export function exhausted(id, now = Date.now()) {
  const v = view(id, now);
  const l = v?.limits.filter((x) => x.kind !== 'rate').find((x) => x.used >= ALERT_AT);
  return l ? { text: limitText(l, now), resetAt: l.resetAt || null, used: l.used } : null;
}
/** Plan and credit limits at ≥ 80 % across accounts (Overview hint): [{ account, name, ...limit }]. */
export function warnings(now = Date.now()) {
  const out = [];
  for (const id of snaps.keys()) {
    const l = tightest(id, now);
    if (l && l.used >= HINT_AT) out.push({ account: id, name: snaps.get(id)?.name || id, ...l, text: limitText(l, now) });
  }
  return out.sort((a, b) => b.used - a.used);
}

function alertIfDue(id, s, now) {
  for (const k of Object.keys(s.alerted || {})) if (s.alerted[k] < now - KEEP_MS) delete s.alerted[k];
  // One alert per limit, level and window. A window is known by its reset time (which jitters a little when a provider
  // sends "resets in N seconds"); a limit without one (prepaid credit) alerts at most once a week.
  const sameWindow = (k, l) => { const prev = s.alerted[k]; return !!prev && (l.resetAt ? Math.abs(prev - l.resetAt) < 30 * 60000 : now - prev < KEEP_MS - 86400000); };
  for (const l of view(id, now)?.limits || []) {
    if (l.kind === 'rate' || l.used < ALERT_AT) continue;
    const level = l.used >= 100 ? 'out' : 'high';
    if (sameWindow(`${l.id}:${level}`, l) || (level === 'high' && sameWindow(`${l.id}:out`, l))) continue;
    s.alerted[`${l.id}:${level}`] = l.resetAt || now;
    save(id, s, true);
    const name = s.name || id;
    const text = level === 'out'
      ? `Duniya: ${name} has used up its ${l.label}${l.resetAt ? ` until ${when(l.resetAt, now)}` : ''}. Other connected providers answer meanwhile (fallback on Models).`
      : `Duniya: ${name} has used ${Math.round(l.used)}% of its ${l.label}${l.resetAt ? ` (resets ${when(l.resetAt, now)})` : ''}. When it runs out, other connected providers answer.`;
    sendOwnerAlert(text, { kind: 'plan usage' }).catch(() => {});
  }
}
