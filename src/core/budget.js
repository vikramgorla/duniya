// Spending caps (040, issue #35). Monthly caps per agent and per chat, by cost (USD, the currency of the usage table:
// prices only from owner settings, provider-published prices, plans or free models — never guessed) and/or by tokens
// (for models without a known price). Checked before a model call: at 80 % the owner gets one WhatsApp alert; at 100 %
// the agent stays quiet in that scope (or switches to a cheaper model the owner chose) and the owner gets one more
// alert. Months follow the server's timezone; alerts are remembered per scope and month, so they reset monthly.
import { db, kvGet, kvSet } from './db.js';
import './usage.js'; // creates the usage table this module indexes
import { bad, localParts, zoneOffset } from './config.js';
import { ownerTz } from './owner-clock.js';
import { activity } from './events.js';
import { sendOwnerAlert } from './owner-alerts.js';
import { chatLabel } from './chat-names.js';

const TENANT = 'default';
db.exec(`
  CREATE TABLE IF NOT EXISTS budget_caps (
    tenant_id TEXT NOT NULL, scope TEXT NOT NULL, id TEXT NOT NULL, cost REAL, tokens INTEGER, fallback TEXT NOT NULL DEFAULT '',
    updated_at INTEGER, PRIMARY KEY (tenant_id, scope, id)
  );
  CREATE INDEX IF NOT EXISTS usage_agent_ts ON usage(agent, ts);
  CREATE INDEX IF NOT EXISTS usage_chat_ts ON usage(chat, ts);
`);

export const CURRENCY = 'USD';
export const SCOPES = ['agent', 'chat'];
export const ALERT_AT = 0.8;
const MODEL_RE = /^[a-z][a-z0-9-]{1,30}:[A-Za-z0-9._:/@+-]{1,120}$/;

// ---------- months on the owner's clock ----------
/** Epoch ms of local midnight on y-m-d in tz. */
export function zonedMidnight(y, m, d, tz = ownerTz()) {
  const guess = Date.UTC(y, m - 1, d);
  return guess - zoneOffset(tz, guess);
}
/** { key: 'YYYY-MM', from, to, resetsAt } for the month containing ts. */
export function monthOf(ts = Date.now(), tz = ownerTz()) {
  const [y, m] = localParts(tz, ts).date.split('-').map(Number);
  const from = zonedMidnight(y, m, 1, tz);
  const next = m === 12 ? zonedMidnight(y + 1, 1, 1, tz) : zonedMidnight(y, m + 1, 1, tz);
  return { key: `${y}-${String(m).padStart(2, '0')}`, from, to: next, resetsAt: next };
}

// ---------- caps ----------
const capView = (r) => ({ scope: r.scope, id: r.id, cost: r.cost ?? null, tokens: r.tokens ?? null, fallback: r.fallback || '' });
export const listCaps = () => db.prepare('SELECT * FROM budget_caps WHERE tenant_id = ? ORDER BY scope, id').all(TENANT).map(capView);
export function getCap(scope, id) {
  const r = db.prepare('SELECT * FROM budget_caps WHERE tenant_id = ? AND scope = ? AND id = ?').get(TENANT, scope, String(id || ''));
  return r ? capView(r) : null;
}
const num = (v) => (v === '' || v == null ? null : Number(v));

/** Set (or with no cost and no tokens: remove) a monthly cap. cost in USD, tokens per month, fallback = model ref. */
export function setCap(scope, id, { cost, tokens, fallback = '' } = {}) {
  if (!SCOPES.includes(scope)) throw bad('Scope must be agent or chat', 'scope');
  if (!id) throw bad('Which agent or chat?', 'id');
  const c = num(cost); const t = num(tokens);
  if (c != null && !(c > 0 && c <= 100000)) throw bad('Monthly cost cap must be between 0.01 and 100000 USD', 'cost');
  if (t != null && !(Number.isInteger(t) && t >= 1000 && t <= 1e11)) throw bad('Monthly token cap must be a whole number of at least 1000', 'tokens');
  const fb = String(fallback || '').trim();
  if (fb && !MODEL_RE.test(fb)) throw bad('Cheaper model must look like provider:model', 'fallback');
  if (c == null && t == null) {
    db.prepare('DELETE FROM budget_caps WHERE tenant_id = ? AND scope = ? AND id = ?').run(TENANT, scope, String(id));
    return null;
  }
  db.prepare('INSERT OR REPLACE INTO budget_caps (tenant_id, scope, id, cost, tokens, fallback, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, scope, String(id), c, t, fb, Date.now());
  return getCap(scope, id);
}
export const removeCapsFor = (scope, id) => db.prepare('DELETE FROM budget_caps WHERE tenant_id = ? AND scope = ? AND id = ?').run(TENANT, scope, String(id)).changes > 0;

// ---------- spend ----------
/** Month-to-date spend of a scope: { cost (priced calls only), tokens, calls, unpriced }. */
export function spendOf(scope, id, month = monthOf()) {
  const col = scope === 'chat' ? 'chat' : 'agent';
  const r = db.prepare(`SELECT COUNT(*) AS calls, SUM(cost) AS cost, SUM(input + output) AS tokens, SUM(CASE WHEN priced IS NULL THEN 1 ELSE 0 END) AS unpriced
    FROM usage WHERE ${col} = ? AND ts >= ? AND ts < ?`).get(String(id), month.from, month.to);
  return { cost: Math.round((r.cost || 0) * 1e6) / 1e6, tokens: r.tokens || 0, calls: r.calls || 0, unpriced: r.unpriced || 0 };
}

/** How full a cap is: the larger of the cost and token fractions (0…∞). */
export function capStatus(cap, month = monthOf()) {
  const spent = spendOf(cap.scope, cap.id, month);
  const costPct = cap.cost ? spent.cost / cap.cost : 0;
  const tokenPct = cap.tokens ? spent.tokens / cap.tokens : 0;
  const used = Math.max(costPct, tokenPct);
  const by = costPct >= tokenPct && cap.cost ? 'cost' : 'tokens';
  const state = used >= 1 ? (cap.fallback ? 'fallback' : 'quiet') : used >= ALERT_AT ? 'warning' : 'ok';
  return { ...cap, spent, used: Math.round(used * 1000) / 1000, by, state, month: month.key, resetsAt: month.resetsAt,
    costUntracked: !!cap.cost && spent.unpriced > 0 && !cap.tokens };
}

// ---------- alerts ----------
const fmtUsd = (c) => (c < 0.01 ? '<$0.01' : `$${c < 10 ? c.toFixed(2) : Math.round(c)}`);
const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
function describe(st) {
  const parts = [];
  if (st.cost) parts.push(`${fmtUsd(st.spent.cost)} of ${fmtUsd(st.cost)}`);
  if (st.tokens) parts.push(`${fmtTok(st.spent.tokens)} of ${fmtTok(st.tokens)} tokens`);
  return parts.join(', ');
}

async function alertOnce(st, level, label) {
  const key = `budget:alert:${st.scope}:${st.id}:${st.month}:${level}`;
  if (kvGet(key)) return false;
  kvSet(key, String(Date.now()));
  const resets = new Date(st.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: ownerTz() });
  const text = level === 100
    ? `Duniya: monthly cap reached for ${label} (${describe(st)}). ${st.fallback ? `It now uses the cheaper model ${st.fallback}` : 'It stays quiet'} until ${resets}. Raise the cap in the panel to change this.`
    : `Duniya: ${label} has used ${Math.round(st.used * 100)}% of its monthly cap (${describe(st)}). At 100% it ${st.fallback ? `switches to ${st.fallback}` : 'stays quiet'} until ${resets}.`;
  activity('system', { agent: st.scope === 'agent' ? st.id : '', chat: st.scope === 'chat' ? st.id : '', summary: `Budget ${level}%: ${label} (${describe(st)})`, detail: { silenceReason: level === 100 && !st.fallback ? 'budget' : undefined } });
  await sendOwnerAlert(text, { kind: 'budget' });
  return true;
}

/**
 * Check the caps that apply to a model call of `agent` in `chat`. Returns
 * { action: 'ok' | 'fallback' | 'quiet', model?, status? } and sends alerts (once per scope, month and level).
 * names: optional { agent, chat } display names for the alert text.
 */
export async function checkBudget(agent, chat, { names = {} } = {}) {
  const caps = [getCap('agent', agent?.id), chat ? getCap('chat', chat) : null].filter(Boolean);
  if (!caps.length) return { action: 'ok' };
  const month = monthOf();
  let worst = { action: 'ok' };
  for (const cap of caps) {
    const st = capStatus(cap, month);
    const label = cap.scope === 'agent' ? `agent "${names.agent || agent.name || agent.id}"` : `chat "${names.chat || chatLabel(chat)}"`;
    try {
      if (st.used >= 1) await alertOnce(st, 100, label);
      else if (st.used >= ALERT_AT) await alertOnce(st, 80, label);
    } catch { /* an alert never blocks a reply */ }
    if (st.used < 1) continue;
    const action = st.fallback ? 'fallback' : 'quiet';
    if (action === 'quiet' || worst.action === 'ok') worst = { action, model: st.fallback || undefined, status: st };
  }
  return worst;
}

/** All caps with their status and display names, for the Usage page. */
export function budgetOverview({ agentName = (id) => id, chatName = (id) => id } = {}) {
  const month = monthOf();
  return { currency: CURRENCY, month: month.key, resetsAt: month.resetsAt, alertAt: ALERT_AT,
    caps: listCaps().map((c) => ({ ...capStatus(c, month), name: c.scope === 'agent' ? agentName(c.id) : chatName(c.id) })) };
}
