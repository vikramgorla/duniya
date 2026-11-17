// Plan usage (067): what a model account's provider reports about its plan, credit and rate limits — the ChatGPT plan's
// 5-hour and weekly windows, Copilot's premium requests, OpenRouter's credit, an API key's rate-limit headroom — and
// what Duniya spent through it this month. Never estimated: without data nothing is shown. Used by Models and Usage.
import { ago, h } from './core.js';
import { fmtCost, meter, plural } from './shared.js';

/** Plan and credit limits, tightest first (`p.usage` from /api/providers). */
const planLimits = (p) => (p?.usage?.limits || []).filter((l) => l.kind !== 'rate');
const rateLimits = (p) => (p?.usage?.limits || []).filter((l) => l.kind === 'rate');
const pctText = (l) => `${Math.round(l.used)}%`;
/** "resets 14:20" today, "resets Thu 14:20" this week, "resets 1 Dec" later. */
function resetText(t) {
  if (!t) return '';
  const d = new Date(t); const days = (t - Date.now()) / 86400000;
  const opts = /** @type {Intl.DateTimeFormatOptions} */ (days < 0.8 ? { hour: '2-digit', minute: '2-digit' } : days < 6 ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' });
  return `resets ${d.toLocaleString([], opts)}`;
}
/** Short status for a list row: "62% of 5-hour limit" with a 3 px meter, or null. */
export function rowStatus(p) {
  const l = planLimits(p)[0];
  if (!l) return null;
  return [`${l.used >= 100 ? 'Used up' : `${pctText(l)} of`} ${l.label}`, h('span', { class: `lmeter${l.used >= 85 ? ' hot' : ''}`, 'aria-hidden': 'true' }, h('i', { style: `width:${Math.min(100, Math.round(l.used))}%` }))];
}
const limitRow = (l) => h('div', { class: 'limit' },
  h('div', { class: 'row spread small' }, h('span', {}, l.label[0].toUpperCase() + l.label.slice(1)), h('b', { class: 'num' }, l.used >= 100 ? 'Used up' : l.kind === 'rate' ? `${Math.round(100 - l.used)}% left` : `${pctText(l)} used`)),
  meter(l.used), h('div', { class: 'small muted' }, [l.detail, resetText(l.resetAt)].filter(Boolean).join(' · ')));
const spendLine = (p) => (p?.spend?.calls ? h('div', { class: 'small muted num' }, `This month through Duniya: ${p.spend.unpriced && !p.spend.cost ? 'price not set' : fmtCost(p.spend.cost)} · ${plural(p.spend.calls, 'call')}`) : null);

/**
 * A provider page's "Plan usage" section: a meter per plan or credit limit with what is left and its reset time, then
 * the rate-limit headroom of API keys, this month's spend and when the provider last reported. Null without data.
 */
export function planSection(p) {
  const plans = planLimits(p); const rates = rateLimits(p); const spend = spendLine(p);
  if (!plans.length && !rates.length && !spend) return null;
  return h('div', { class: 'plan-usage' },
    h('h3', {}, plans.length ? 'Plan usage' : 'Usage and limits'),
    plans.map(limitRow),
    rates.length ? h('div', { class: 'limit' }, h('div', { class: 'eyebrow', style: 'margin:0 0 4px' }, 'Rate limit headroom'), rates.map(limitRow)) : null,
    spend ? h('div', { class: 'limit' }, spend) : null,
    p.usage ? h('div', { class: 'small muted', style: 'margin-top:6px' }, `Updated ${ago(p.usage.at)} ago, from what ${p.name} reports`) : null);
}

/** Usage screen: one row per account with a plan or credit limit, or null when no provider reports one. */
export function plansCard(provs) {
  const rows = provs.filter((p) => p.connected && planLimits(p).length);
  if (!rows.length) return null;
  return h('div', { class: 'card', id: 'plans', style: 'margin-top:16px' }, h('h2', {}, 'Plans and credit'),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:14px' }, rows.map((p) => {
      const l = planLimits(p)[0]; const more = planLimits(p).length - 1;
      return h('a', { class: 'capbar plan', href: `#models/${p.type === 'compatible' ? `x-${p.id}` : p.type}` },
        h('div', { class: 'row spread', style: 'gap:6px' }, h('b', {}, p.name), h('span', { class: `pill ${l.used >= 100 ? 'bad' : l.used >= 80 ? 'warn' : 'ok'}` }, l.used >= 100 ? 'Used up' : `${pctText(l)} used`)),
        meter(l.used),
        h('div', { class: 'small muted num' }, [l.label, l.detail, resetText(l.resetAt), more > 0 ? `+${plural(more, 'more limit')}` : ''].filter(Boolean).join(' · ')));
    })),
    h('p', { class: 'small muted', style: 'margin-bottom:0' }, 'What each provider reports about your plan. Duniya switches to the next model when one runs out.'));
}
