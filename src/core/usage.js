// Usage and cost (023). Every model call is recorded with tokens, agent, chat, provider, model and kind
// (reply | summary | ai-helper | test). Costs come only from prices the owner set or the provider publishes
// (e.g. OpenRouter); plan-based providers (ChatGPT plan, GitHub Copilot) are "included", free models cost 0, and
// anything else is reported as "price not set" — never guessed.
import { db } from './db.js';
import { getSetting, updateSettings } from './store.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, agent TEXT, chat TEXT, provider TEXT, model TEXT, kind TEXT,
    input INTEGER, output INTEGER, cost REAL, priced TEXT
  );
  CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
`);
// 042: the account that answered and why the call switched (fallback). Added in place so an update keeps usage.
for (const [col, type] of [['account', 'TEXT'], ['fallback', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(usage)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE usage ADD COLUMN ${col} ${type}`);
}

export const PLAN_PROVIDERS = { chatgpt: 'ChatGPT plan', copilot: 'Copilot allowance' };
const priceSetting = () => getSetting('modelPrices', {}) || {};

/** Owner-set prices in USD per 1M tokens: { "provider:model": { in, out } }. Empty values remove the price. */
export function setPrice(ref, { input, output }) {
  if (!/^[a-z][a-z0-9-]*:.+$/.test(ref)) throw Object.assign(new Error('Model must look like provider:model'), { status: 400 });
  const all = { ...priceSetting() };
  const i = input === '' || input == null ? null : Number(input); const o = output === '' || output == null ? null : Number(output);
  if (i == null && o == null) delete all[ref];
  else {
    if (!(i >= 0) || !(o >= 0) || i > 10000 || o > 10000) throw Object.assign(new Error('Prices are USD per million tokens (0–10000)'), { status: 400 });
    all[ref] = { in: i, out: o };
  }
  updateSettings({ modelPrices: all });
  return all[ref] || null;
}
export const listPrices = () => priceSetting();

/** { in, out, source: 'set' | 'provider' | 'free' | 'plan' } or null. `published` = price the provider lists. */
export function priceFor(provider, model, published = null) {
  const ref = `${provider}:${model}`;
  if (PLAN_PROVIDERS[provider]) return { in: 0, out: 0, source: 'plan' };
  const set = priceSetting()[ref];
  if (set) return { ...set, source: 'set' };
  if (/:free$/.test(model)) return { in: 0, out: 0, source: 'free' };
  if (published && Number.isFinite(published.in) && Number.isFinite(published.out)) return { in: published.in, out: published.out, source: 'provider' };
  return null;
}

const ins = db.prepare('INSERT INTO usage (ts, agent, chat, provider, model, kind, input, output, cost, priced, account, fallback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
/** provider = provider type (prices are per provider); account = the account that answered (042); fallback = why it switched. */
export function recordUsage({ agent = '', chat = '', provider, account = '', model, kind = 'reply', input = 0, output = 0, published = null, fallback = '' }) {
  const price = priceFor(provider, model, published);
  const cost = price ? (input * price.in + output * price.out) / 1e6 : null;
  ins.run(Date.now(), agent || '', chat || '', provider, model, kind, input | 0, output | 0, cost, price?.source || null, account || provider, String(fallback || '').slice(0, 300));
  if (Math.random() < 0.01) db.prepare('DELETE FROM usage WHERE ts < ?').run(Date.now() - 400 * 86400000);
}

const GROUPS = { agent: 'agent', chat: 'chat', provider: 'provider', account: "COALESCE(account, provider)", model: "COALESCE(account, provider) || ':' || model", kind: 'kind',
  fallback: "CASE WHEN fallback IS NULL OR fallback = '' THEN 'first choice' ELSE 'fallback' END", day: "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')" };

/** Totals and breakdowns for a period. */
export function usageReport({ from = 0, to = Date.now(), groupBy = 'agent', agent = '', chat = '' } = {}) {
  const key = GROUPS[groupBy];
  if (!key) throw Object.assign(new Error('groupBy must be one of agent, chat, provider, account, model, kind, fallback, day'), { status: 400 });
  const where = ['ts >= ?', 'ts <= ?']; const args = [Number(from) || 0, Number(to) || Date.now()];
  if (agent) { where.push('agent = ?'); args.push(agent); }
  if (chat) { where.push('chat = ?'); args.push(chat); }
  const cols = `COUNT(*) AS calls, SUM(input) AS input, SUM(output) AS output, SUM(cost) AS cost,
    SUM(CASE WHEN priced IS NULL THEN 1 ELSE 0 END) AS unpriced, SUM(CASE WHEN priced = 'plan' THEN 1 ELSE 0 END) AS plan`;
  const total = db.prepare(`SELECT ${cols} FROM usage WHERE ${where.join(' AND ')}`).get(...args);
  const rows = db.prepare(`SELECT ${key} AS key, ${cols} FROM usage WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY ${groupBy === 'day' ? '1' : 'input + output DESC'} LIMIT 500`).all(...args);
  const clean = (r) => ({ ...r, input: r.input || 0, output: r.output || 0, cost: r.cost == null ? null : Math.round(r.cost * 1e6) / 1e6 });
  return { from: args[0], to: args[1], groupBy, total: clean(total), rows: rows.map(clean) };
}
