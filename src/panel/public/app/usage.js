// Usage screen and spending caps (040). Module of the panel (063).
import { $, api, can, field, h, tryApi } from './core.js';
import { fmtCost, fmtTok, meter } from './shared.js';
import { plansCard } from './plans.js';
let usageCache = null;
/** Last-30-days usage per agent, chat, provider and model (cached 60 s) for inline badges. */
export async function usageSummary() {
  if (usageCache && Date.now() - usageCache.at < 60000) return usageCache.v;
  const v = await api('GET', '/api/usage/summary?period=30d').catch(() => null);
  usageCache = { at: Date.now(), v }; return v;
}
let usagePeriod = '30d';
// ---------- spending caps (040, #35) ----------
const CAP_STATE = { ok: ['ok', 'Within cap'], warning: ['warn', '80%+ used'], quiet: ['bad', 'Cap reached — quiet'], fallback: ['warn', 'Cap reached — cheaper model'] };
export const capAmount = (c) => [c.cost ? `${fmtCost(c.spent.cost)} of ${fmtCost(c.cost)}` : '', c.tokens ? `${fmtTok(c.spent.tokens)} of ${fmtTok(c.tokens)} tokens` : ''].filter(Boolean).join(' · ');
const capResets = (c) => new Date(c.resetsAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
/** One cap as a progress bar with one state line. */
function capBar(c, { name = true } = {}) {
  const [cls, label] = CAP_STATE[c.state] || CAP_STATE.ok;
  return h('div', { class: 'capbar' },
    h('div', { class: 'row spread', style: 'gap:6px' }, name ? h('b', {}, c.name || c.id) : h('span', { class: 'small' }, 'This month'), h('span', { class: `pill ${cls}` }, `${Math.round(c.used * 100)}% · ${label}`)),
    meter(Math.round(c.used * 100)),
    h('div', { class: 'small muted num' }, `${capAmount(c)} · resets ${capResets(c)}`),
    c.costUntracked ? h('div', { class: 'small', style: 'color:var(--warn)' }, `${c.spent.unpriced} call(s) have no price, so the cost cap can’t count them. Set the price under Usage → By model, or add a token cap.`) : null);
}
/** Editor for the monthly cap of an agent or a chat; saves on its own. */
export async function capEditor(scope, id, models) {
  const box = h('div', {});
  const path = `/api/budget/${scope}/${encodeURIComponent(id)}`;
  const draw = (cap) => {
    const cost = h('input', { type: 'number', min: 0, step: '0.5', inputmode: 'decimal', value: cap?.cost ?? '', placeholder: 'e.g. 5', 'aria-label': 'Monthly cost cap in USD', disabled: !can('admin') });
    const tokens = h('input', { type: 'number', min: 1000, step: 1000, inputmode: 'numeric', value: cap?.tokens ?? '', placeholder: 'e.g. 2000000', 'aria-label': 'Monthly token cap', disabled: !can('admin') });
    const fb = h('select', { 'aria-label': 'At the cap', disabled: !can('admin') }, h('option', { value: '' }, 'Stay quiet until next month'),
      (models?.models || []).map((m) => h('option', { value: m.ref, selected: cap?.fallback === m.ref }, `Switch to ${m.label}`)),
      cap?.fallback && !(models?.models || []).some((m) => m.ref === cap.fallback) ? h('option', { value: cap.fallback, selected: true }, `Switch to ${cap.fallback} (not available)`) : null);
    const save = (body, msg) => tryApi(async () => { const r = await api('PUT', path, body); usageCache = null; draw(r.cap); }, msg);
    box.replaceChildren(
      h('p', { class: 'small muted', style: 'margin-top:0' }, scope === 'agent'
        ? 'Limit what this agent may spend per calendar month. At 80% you get a WhatsApp alert; at 100% it stays quiet (or uses a cheaper model) until the month ends.'
        : 'Limit what agents may spend in this chat per calendar month. At 80% you get a WhatsApp alert; at 100% the agent stays quiet here (or uses a cheaper model).'),
      cap ? capBar(cap, { name: false }) : h('p', { class: 'small' }, 'No cap — no limit.'),
      h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px' },
        field('Cost per month (USD)', cost, 'Needs model prices'), field('or tokens per month', tokens, 'Works without prices')),
      field('At the cap', fb),
      can('admin') ? h('div', { class: 'row', style: 'margin-top:10px;gap:8px' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => save({ cost: cost.value, tokens: tokens.value, fallback: fb.value }, cost.value || tokens.value ? 'Cap saved' : 'Cap removed') }, 'Save cap'),
        cap ? h('button', { class: 'btn', type: 'button', onclick: () => save({ cost: '', tokens: '' }, 'Cap removed') }, 'Remove cap') : null) : null);
  };
  api('GET', path).then((r) => draw(r.cap)).catch((e) => box.replaceChildren(h('p', { class: 'small muted' }, `Could not load the cap: ${e.message}`)));
  return box;
}

export async function renderUsage() {
  const [byDay, byAgent, byChat, byProv, byModel, byKind, byAcct, byFb, sum, chats, agents, provList] = await Promise.all(['day', 'agent', 'chat', 'provider', 'model', 'kind', 'account', 'fallback']
    .map((g) => api('GET', `/api/usage?period=${usagePeriod}&groupBy=${g}`)).concat([usageSummary(), api('GET', '/api/chats').catch(() => []), api('GET', '/api/agents').catch(() => []), api('GET', '/api/providers').catch(() => [])]));
  const acctName = Object.fromEntries(provList.map((p) => [p.id, p.name]));
  const caps = await api('GET', '/api/budget').catch(() => null);
  const t = byDay.total;
  const chatName = Object.fromEntries(chats.map((c) => [c.id, c.name])); const agentName = Object.fromEntries(agents.map((b) => [b.id, b.name]));
  const KIND = { reply: 'Replies', summary: 'Memory summaries', scheduled: 'Scheduled posts', 'ai-helper': 'AI helper', test: 'Tests' };
  const seg = h('div', { class: 'seg' }, [['1d', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['all', 'All']].map(([v, l]) => h('button', { class: usagePeriod === v ? 'on' : '', onclick: () => { usagePeriod = v; renderUsage(); } }, l)));
  const tile = (eyebrow, stat, sub) => h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, eyebrow), h('div', { class: 'stat' }, stat), sub ? h('div', { class: 'small muted' }, sub) : null);
  // daily bars
  const days = byDay.rows; const max = Math.max(1, ...days.map((d) => d.input + d.output));
  const ns = 'http://www.w3.org/2000/svg'; const chart = document.createElementNS(ns, 'svg'); chart.setAttribute('viewBox', `0 0 ${Math.max(days.length, 1) * 10} 60`); chart.setAttribute('preserveAspectRatio', 'none'); chart.setAttribute('class', 'bars');
  days.forEach((d, i) => { const hgt = ((d.input + d.output) / max) * 56; const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', i * 10 + 1.5); r.setAttribute('y', 60 - hgt); r.setAttribute('width', 7); r.setAttribute('height', Math.max(hgt, 0.5)); r.setAttribute('rx', 1.5);
    const tt = document.createElementNS(ns, 'title'); tt.textContent = `${d.key}: ${fmtTok(d.input + d.output)} tokens, ${fmtCost(d.cost)}`; r.append(tt); chart.append(r); });
  const table = (title, rep, name, extra) => h('div', { class: 'card' }, h('h2', {}, title), rep.rows.length ? h('table', { class: 'stack' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { style: 'text-align:right' }, 'Calls'), h('th', { style: 'text-align:right' }, 'Tokens in / out'), h('th', { style: 'text-align:right' }, 'Cost'), extra ? h('th', {}, 'Price / 1M (in · out)') : null)),
    h('tbody', {}, rep.rows.map((r) => h('tr', {}, h('td', { 'data-label': '', class: 'tname' }, name(r.key)), h('td', { class: 'num', style: 'text-align:right', 'data-label': 'Calls' }, r.calls), h('td', { class: 'num', style: 'text-align:right', 'data-label': 'Tokens in / out' }, `${fmtTok(r.input)} / ${fmtTok(r.output)}`),
      h('td', { class: 'num', style: 'text-align:right', 'data-label': 'Cost' }, r.plan === r.calls ? 'in plan' : r.unpriced === r.calls ? 'price not set' : fmtCost(r.cost)), extra ? h('td', { 'data-label': 'Price / 1M' }, extra(r.key)) : null)))) : h('p', { class: 'small muted' }, 'Nothing in this period.'));
  const priceEditor = (ref) => {
    const [prov] = ref.split(':');
    if (sum?.plans?.[prov]) return h('span', { class: 'pill ok' }, sum.plans[prov]);
    if (/:free$/.test(ref)) return h('span', { class: 'pill ok' }, 'free');
    const cur = sum?.prices?.[ref];
    const i = h('input', { type: 'number', step: '0.01', min: 0, value: cur?.in ?? '', placeholder: 'in', 'aria-label': `Input price per 1M tokens for ${ref}`, style: 'flex:0 1 76px;min-width:0' });
    const o = h('input', { type: 'number', step: '0.01', min: 0, value: cur?.out ?? '', placeholder: 'out', 'aria-label': `Output price per 1M tokens for ${ref}`, style: 'flex:0 1 76px;min-width:0' });
    return can('admin') ? h('div', { class: 'row nowrap', style: 'gap:6px' }, i, o, h('button', { class: 'btn small', onclick: () => tryApi(async () => { await api('PUT', '/api/usage/prices', { model: ref, input: i.value, output: o.value }); usageCache = null; renderUsage(); }, 'Price saved') }, 'Save'))
      : h('span', { class: 'small muted' }, cur ? `$${cur.in} · $${cur.out}` : '—');
  };
  $('#main').replaceChildren(
    h('div', { class: 'card console' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Usage & cost'), h('h2', {}, `${fmtTok(t.input + t.output)} tokens · ${t.unpriced === t.calls && t.calls ? 'price not set' : fmtCost(t.cost)}`)), seg),
    h('div', { class: 'tiles' },
      tile('Tokens in', fmtTok(t.input), 'what agents read: instructions, chat context, tool results'),
      tile('Tokens out', fmtTok(t.output), 'what agents wrote'),
      tile('Estimated cost', fmtCost(t.cost), t.unpriced ? `${t.unpriced} call(s) without a price — set prices under “By model”` : t.plan ? `${t.plan} call(s) included in your plans` : 'from the prices below'),
      tile('Model calls', String(t.calls || 0), `${(byKind.rows.find((r) => r.key === 'reply')?.calls) || 0} replies`)),
    plansCard(provList), // 067: plans and credit as the providers report them
    caps ? h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, 'Monthly spending caps'),
      caps.caps.length ? h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:14px' }, caps.caps.map((c) => capBar(c)))
        : h('p', { class: 'small muted' }, 'No caps yet. Set one on an agent’s page (Monthly spending cap) or for a chat under Chats → Spending cap.'),
      caps.caps.length && !caps.alertsTo ? h('div', { class: 'note warn', style: 'margin-top:10px' }, 'Cap alerts can’t reach you on WhatsApp yet: add your number under Agents → Owner assistant → Alerts.') : null) : null,
    h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, 'Per day'), days.length ? chart : h('p', { class: 'small muted' }, 'Nothing in this period.')),
    h('div', { class: 'grid', style: 'margin-top:16px;align-items:start' },
      table('By agent', byAgent, (k) => agentName[k] || k || '(no agent)'),
      table('By chat', byChat, (k) => chatName[k] || (k ? k.replace(/@.*/, '') : '(no chat)')),
      table('By provider', byProv, (k) => k),
      byAcct.rows.length > 1 || byProv.rows.some((r) => !byAcct.rows.some((a) => a.key === r.key)) ? table('By account', byAcct, (k) => acctName[k] || k) : null,
      byFb.rows.some((r) => r.key === 'fallback') ? table('First choice or fallback', byFb, (k) => (k === 'fallback' ? 'Answered by a fallback model' : 'Answered by the chosen model')) : null,
      table('By kind', byKind, (k) => KIND[k] || k)),
    h('div', { style: 'margin-top:16px' }, table('By model', byModel, (k) => k, priceEditor)),
    h('p', { class: 'small muted' }, 'Costs are estimates from the prices you set (or the provider publishes, e.g. OpenRouter). ChatGPT plan and Copilot calls are included in those plans. Your provider’s bill is the source of truth.'));
}

