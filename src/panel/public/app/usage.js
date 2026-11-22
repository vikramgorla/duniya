// Usage screen and spending caps (040). Module of the panel (063).
import { $, api, ask, can, field, h, menu, partFailed, tryApi } from './core.js';
import { fmtCost, fmtTok, meter, plural } from './shared.js';
import { accountName, modelName } from './names.js';
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
const capAmount = (c) => [c.cost ? `${fmtCost(c.spent.cost)} of ${fmtCost(c.cost)}` : '', c.tokens ? `${fmtTok(c.spent.tokens)} of ${fmtTok(c.tokens)} tokens` : ''].filter(Boolean).join(' · ');
const capResets = (c) => new Date(c.resetsAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
/** One cap as a progress bar with one state line. */
function capBar(c, { name = true } = {}) {
  const [cls, label] = CAP_STATE[c.state] || CAP_STATE.ok;
  return h('div', { class: 'capbar' },
    h('div', { class: 'row spread', style: 'gap:6px' }, name ? h('b', {}, c.name || c.id) : h('span', { class: 'small' }, 'This month'), h('span', { class: `pill ${cls}` }, `${Math.round(c.used * 100)}% · ${label}`)),
    meter(Math.round(c.used * 100)),
    h('div', { class: 'small muted num' }, `${capAmount(c)} · resets ${capResets(c)}`),
    c.costUntracked ? h('div', { class: 'small', style: 'color:var(--warn)' }, `${plural(c.spent.unpriced, 'call')} ${c.spent.unpriced === 1 ? 'has' : 'have'} no price, so the cost cap can’t count them. Set the price under Usage → Breakdown → Models, or add a token cap.`) : null);
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

let usageBy = 'agent';
/** Usage (073): totals, caps, Smart model choice, Cost per feature (092) and the day chart, then one Breakdown card — a
 *  seg (Agents · Chats · Models · Accounts) over compact rows (name · calls and tokens muted · cost); a model's price is set from its ⋯. */
export async function renderUsage() {
  const [byDay, byAgent, byChat, byModel, byFeature, byAcct, byFb, sum, agents, provList] = await Promise.all(['day', 'agent', 'chat', 'model', 'feature', 'account', 'fallback']
    .map((g) => api('GET', `/api/usage?period=${usagePeriod}&groupBy=${g}`)).concat([usageSummary(), api('GET', '/api/agents').catch(() => []), api('GET', '/api/providers').catch(() => [])]));
  const acctName = Object.fromEntries(provList.map((p) => [p.id, p.name]));
  const failed = (e) => ({ failed: e }); // a part that did not load says so with Retry instead of disappearing
  const [caps, smart] = await Promise.all([api('GET', '/api/budget').catch(failed), api('GET', `/api/usage/smart?period=${usagePeriod}`).catch(failed)]);
  const t = byDay.total;
  const agentName = Object.fromEntries(agents.map((b) => [b.id, b.name]));
  const seg = h('div', { class: 'seg' }, [['1d', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['all', 'All']].map(([v, l]) => h('button', { class: usagePeriod === v ? 'on' : '', onclick: () => { usagePeriod = v; renderUsage(); } }, l)));
  const tile = (eyebrow, stat, sub) => h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, eyebrow), h('div', { class: 'stat' }, stat), sub ? h('div', { class: 'small muted' }, sub) : null);
  // daily bars
  const days = byDay.rows; const max = Math.max(1, ...days.map((d) => d.input + d.output));
  const ns = 'http://www.w3.org/2000/svg'; const chart = document.createElementNS(ns, 'svg'); chart.setAttribute('viewBox', `0 0 ${Math.max(days.length, 1) * 10} 60`); chart.setAttribute('preserveAspectRatio', 'none'); chart.setAttribute('class', 'bars');
  days.forEach((d, i) => { const hgt = ((d.input + d.output) / max) * 56; const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', i * 10 + 1.5); r.setAttribute('y', 60 - hgt); r.setAttribute('width', 7); r.setAttribute('height', Math.max(hgt, 0.5)); r.setAttribute('rx', 1.5);
    const tt = document.createElementNS(ns, 'title'); tt.textContent = `${d.key}: ${fmtTok(d.input + d.output)} tokens, ${fmtCost(d.cost)}`; r.append(tt); chart.append(r); });
  const cost = (r) => (r.plan === r.calls ? 'in plan' : r.unpriced === r.calls ? 'no price' : fmtCost(r.cost));
  const price = (ref, r) => {
    const [prov] = ref.split(':');
    if (sum?.plans?.[prov]) return sum.plans[prov];
    if (r.plan === r.calls) return ''; // an account with a plan (ChatGPT, Copilot): the cost already says "in plan"
    if (/:free$/.test(ref)) return 'free';
    const cur = sum?.prices?.[ref];
    return cur ? `$${cur.in} / $${cur.out} per 1M` : 'price not set';
  };
  const setPrice = async (ref) => {
    const cur = sum?.prices?.[ref];
    const i = h('input', { type: 'number', step: '0.01', min: 0, inputmode: 'decimal', value: cur?.in ?? '', placeholder: 'e.g. 3' });
    const o = h('input', { type: 'number', step: '0.01', min: 0, inputmode: 'decimal', value: cur?.out ?? '', placeholder: 'e.g. 15' });
    if (!await ask({ title: `Price of ${modelName(ref.replace(/^[\w-]+:(?=.)/, ''))}`, text: 'In USD per million tokens, as your provider lists it. Empty removes the price.', ok: 'Save price',
      body: h('div', { class: 'grid2' }, field('Input (read)', i), field('Output (written)', o)) })) return;
    if (await tryApi(() => api('PUT', '/api/usage/prices', { model: ref, input: i.value, output: o.value }), 'Price saved')) { usageCache = null; renderUsage(); }
  };
  const priceable = (ref, r) => !sum?.plans?.[ref.split(':')[0]] && r.plan !== r.calls && !/:free$/.test(ref);
  // one row: name (a link where the item has a page) · muted calls and tokens (+ a model's price) · cost · ⋯
  const row = (name, r, extra = '', more = null) => h('li', {}, h('div', { class: 'u-main' }, h('span', { class: 'u-name' }, name),
    h('span', { class: 'small muted num' }, [plural(r.calls, 'call'), `${fmtTok(r.input)} in / ${fmtTok(r.output)} out`, extra].filter(Boolean).join(' · '))),
    h('span', { class: 'u-cost num' }, cost(r)), more);
  const BY = {
    agent: ['Agents', byAgent, (r) => row(r.key ? h('a', { href: `#agents/${encodeURIComponent(r.key)}` }, agentName[r.key] || r.key) : 'No agent', r)],
    chat: ['Chats', byChat, (r) => row(r.key ? h('a', { href: `#chats/${encodeURIComponent(r.key)}` }, r.chatName || 'a chat') : 'No chat (tests, AI helper)', r)],
    model: ['Models', byModel, (r) => row(modelName(r.key.replace(/^[\w-]+:(?=.)/, '')), r, price(r.key, r),
      can('admin') && priceable(r.key, r) ? menu(`Price of ${r.key}`, h('button', { class: 'btn small', type: 'button', onclick: () => setPrice(r.key) }, 'Set price…')) : null)],
    account: ['Accounts', byAcct, (r) => row(acctName[r.key] || accountName(r.key), r)],
  };
  const list = h('ul', { class: 'urows' });
  const draw = () => { const [, rep, fn] = BY[usageBy]; list.replaceChildren(...(rep.rows.length ? rep.rows.map(fn) : [h('li', { class: 'muted small' }, 'Nothing in this period.')])); };
  const bySeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Break usage down by' }, Object.entries(BY).map(([k, [label]]) => h('button', { class: usageBy === k ? 'on' : '', 'aria-pressed': String(usageBy === k),
    onclick: (e) => { usageBy = k; for (const b of bySeg.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); } draw(); } }, label)));
  draw();
  const fb = byFb.rows.find((r) => r.key === 'fallback');
  $('#main').replaceChildren(
    h('div', { class: 'card console' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Usage & cost'), h('h2', {}, `${fmtTok(t.input + t.output)} tokens · ${t.unpriced === t.calls && t.calls ? 'price not set' : fmtCost(t.cost)}`)), seg),
    h('div', { class: 'tiles' },
      tile('Tokens in', fmtTok(t.input), 'what agents read'),
      tile('Tokens out', fmtTok(t.output), 'what agents wrote'),
      tile('Estimated cost', fmtCost(t.cost), t.unpriced ? `${plural(t.unpriced, 'call')} without a price` : t.plan ? `${plural(t.plan, 'call')} in your plans` : 'from the prices you set'),
      tile('Model calls', String(t.calls || 0), `${byFeature.rows.filter((r) => /^reply/.test(r.key)).reduce((n, r) => n + r.calls, 0)} answers`)),
    caps.failed ? h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, 'Monthly spending caps'), partFailed(caps.failed, '', renderUsage)) : h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, 'Monthly spending caps'),
      caps.caps.length ? h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:14px' }, caps.caps.map((c) => capBar(c)))
        : h('p', { class: 'small muted' }, 'No caps yet. Set one on an agent’s page (Monthly spending cap) or for a chat under Chats → Spending cap.'),
      caps.caps.length && !caps.alertsTo ? h('div', { class: 'note warn', style: 'margin-top:10px' }, 'Cap alerts can’t reach you on WhatsApp yet: add your number under Agents → Owner assistant → Alerts.') : null),
    smartCard(smart), featureCard(byFeature.rows, cost),
    h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, 'Per day'), days.length ? chart : h('p', { class: 'small muted' }, 'Nothing in this period.')),
    h('div', { class: 'card', style: 'margin-top:16px', 'data-jump': 'breakdown' }, h('h2', {}, 'Breakdown'), h('div', { style: 'overflow-x:auto;margin-bottom:6px' }, bySeg), list,
      fb ? h('p', { class: 'small muted' }, `${plural(fb.calls, 'call')} answered by a fallback model (${cost(fb)}).`) : null,
      h('p', { class: 'small muted', style: 'margin-bottom:0' }, 'Costs are estimates from the prices you set (or the provider publishes). ChatGPT plan and Copilot calls are included in those plans; your provider’s bill is the source of truth.')));
}

/** 092: Cost per feature: what each feature used in the period (most expensive first: cost, then tokens), one line each; the top 6, then all. */
function featureCard(rows, cost) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => (b.cost || 0) - (a.cost || 0) || b.input + b.output - (a.input + a.output));
  const top = Math.max(...sorted.map((r) => r.input + r.output), 1);
  const li = (r) => h('li', {}, h('div', { class: 'u-main' }, h('span', { class: 'u-name' }, r.label),
    h('span', { class: 'small muted' }, r.line), h('span', { class: 'small muted num' }, `${plural(r.calls, 'call')} · ${fmtTok(r.input + r.output)} tokens`),
    h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(2, Math.round(((r.input + r.output) / top) * 100))}%` }))), h('span', { class: 'u-cost num' }, cost(r)));
  const list = h('ul', { class: 'urows' }, sorted.slice(0, 6).map(li));
  const all = sorted.length > 6 ? h('button', { class: 'btn small', type: 'button', onclick: () => { list.replaceChildren(...sorted.map(li)); all.remove(); } }, `Show all ${sorted.length}`) : null;
  return h('div', { class: 'card', style: 'margin-top:16px', 'data-jump': 'features' }, h('h2', {}, 'Cost per feature'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'What each part of Duniya used in this period, the most expensive first.'), list, all);
}

/** 088: agents on "Auto: light or strong": how the answers split and what it saved. */
function smartCard(r) {
  if (r?.failed) return h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, 'Smart model choice'), partFailed(r.failed, '', renderUsage));
  if (!r?.answers) return null;
  const light = r.tiers.light?.answers || 0; const per = (v) => (v == null ? 'price not set' : fmtCost(v * 100)); // per 100 answers: readable sums
  return h('div', { class: 'card', style: 'margin-top:16px', 'data-jump': 'smart' }, h('h2', {}, 'Smart model choice'),
    meter(Math.round((light / r.answers) * 100)),
    h('p', { class: 'small num' }, `${plural(r.answers, 'answer')}: ${light} light, ${r.answers - light} strong.`),
    r.compared ? h('p', { class: 'small num' }, `${per(r.perAnswer)} per 100 answers — ${per(r.perAnswerStrong)} if the strong model had answered all; ${fmtCost(r.saved)} saved.`)
      : h('p', { class: 'small muted' }, 'Set the prices of the light and strong models to see what it saves.'),
    h('ul', { class: 'urows' }, r.reasons.map((x) => h('li', {}, h('div', { class: 'u-main' }, h('span', { class: 'u-name' }, x.reason), h('span', { class: 'small muted' }, x.tier)), h('span', { class: 'u-cost num' }, String(x.n))))));
}
