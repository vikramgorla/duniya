// Models screen: providers, accounts, defaults, fallback, photos & voice capabilities. Module of the panel (063).
import { $, S, api, ask, can, copyBtn, field, h, icon, menu, toast, toggle, tryApi } from './core.js';
import { chainEditor } from './fallback.js';
import { listDetail, mark } from './listdetail.js';
import { PROVIDER_NAMES } from './names.js';
import { LINKS, helpLink, loadModels, modelLabel, modelSelect, plural, saveSecretKey, usageLine } from './shared.js';
import { usageSummary } from './usage.js';
/** 066: the Add a provider list, in this order: [provider type (names.js) = page id, one short line]. */
const ADD_PROVIDERS = [['openrouter', 'Many models, some free'], ['anthropic', 'Anthropic API key, pay per use'], ['openai', 'API key, pay per use'],
  ['copilot', 'Your Copilot plan, also works with the free plan'], ['chatgpt', 'Sign in with your ChatGPT plan'],
  ['claudecode', 'Your Claude Pro or Max plan, through the Claude Code app'], ['codex', 'Your ChatGPT plan, through the Codex app'], ['compatible', 'Ollama, LM Studio, Groq, Mistral…']];
const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text, ' ↗');
// Small drawings of what to look for on the other site (no images from the web).
const cue = {
  win: (site, ...kids) => h('div', { class: 'cue', 'aria-hidden': 'true' }, h('div', { class: 'cue-top' }, h('i'), h('i'), h('i'), h('span', {}, site)), h('div', { class: 'cue-body' }, kids)),
  btn: (text, dark) => h('span', { class: `cue-btn${dark ? ' dark' : ''}` }, text),
  field: (text) => h('span', { class: 'cue-field' }, text, h('span', { class: 'cue-copy' }, 'Copy')),
  hl: (el) => h('span', { class: 'cue-hl' }, el),
};
const stepList = (steps) => h('ol', { class: 'steps' }, steps.map(([text, drawing]) => h('li', {}, h('div', {}, text), drawing || null)));
const secs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function testBox(id) {
  const out = h('div', { class: 'testout' });
  const btn = h('button', { class: 'btn small mut', onclick: async () => {
    btn.disabled = true; out.replaceChildren(h('div', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Sending “Say hi”…'));
    const r = await tryApi(() => api('POST', `/api/providers/${encodeURIComponent(id)}/test`, {}));
    btn.disabled = false;
    if (!r) return out.replaceChildren();
    out.replaceChildren(r.ok
      ? h('div', { class: 'note ok' }, h('b', {}, `“${r.reply}”`), h('div', { class: 'small' }, `${r.model} · answered in ${secs(r.ms)}`))
      : h('div', { class: 'note bad' }, `Test failed after ${secs(r.ms)}: ${r.error}`));
  } }, 'Test');
  return { btn, out };
}

/** One provider card: what it is + cost, then either the steps to connect or the connected state. */
/** "vikram.gorla@gmail.com" → "v•••a@gmail.com" (068: the account is shown, not spelled out on every screen). */
const maskAccount = (a) => String(a || '').replace(/^([^@\s])[^@\s]*([^@\s])@/, '$1•••$2@');
/** One provider page (068): mark, name and its state; one muted line (sign-in, last 30 days); Test and a ⋯
 *  with Rename and Disconnect / Remove; other accounts and "Add another account" as one row. Not connected: the
 *  steps to connect. */
function providerCard({ id, mark, title, cost, tag, p, steps, form, connected, extra, ownerOnly, accounts, account }) {
  const isOn = p?.connected;
  const u = providerCard.usage?.account?.[id] || providerCard.usage?.provider?.[id];
  const pill = isOn && p.health?.state && p.health.state !== 'ok' ? healthPill(p) // 042: one clear state while paused
    : isOn ? h('span', { class: 'pill ok' }, `Connected · ${plural(p.models, 'model')}`)
    : p?.error ? h('span', { class: 'pill bad' }, 'Needs attention') : h('span', { class: 'pill' }, 'Not connected');
  const t = isOn ? testBox(id) : null;
  const more = [extra].flat(Infinity).filter(Boolean);
  const danger = more.filter((x) => x.classList?.contains('danger')); const rest = more.filter((x) => !danger.includes(x));
  for (const d of danger) d.classList.remove('mut');
  const rename = isOn && can('admin') ? h('button', { class: 'btn small', type: 'button', onclick: async () => {
    const name = h('input', { value: p.label || '', maxlength: 40, placeholder: title, autocomplete: 'off' });
    if (await ask({ title: `Rename ${p.name}`, text: 'A label for this account, e.g. “work”. Empty: just the provider’s name.', ok: 'Rename', body: field('Label', name) })
      && await tryApi(() => api('PUT', `/api/accounts/${encodeURIComponent(p.id)}`, { label: name.value.trim() }), 'Renamed')) { S.models = null; renderModels(); }
  } }, 'Rename') : null;
  const line = [account ? `Signed in as ${maskAccount(account)}` : null].filter(Boolean);
  return h('div', { class: `card pcard${isOn ? ' on' : ''}`, id: `prov-${id}`, 'data-jump': id },
    h('div', { class: 'phead' }, h('span', { class: `pmark ${mark}` }, title[0]), h('h2', {}, p?.name || title),
      isOn && (rename || danger.length) ? menu(`More actions for ${p?.name || title}`, rename, danger) : null),
    h('div', { class: 'pstate' }, pill, tag || null),
    h('div', { class: 'small muted pcost' }, cost, ' ', helpLink('models.md')),
    isOn && (line.length || u) ? h('div', { class: 'small muted num' }, line.join(' · '), line.length && u ? ' · ' : '', u ? [h('a', { href: '#usage' }, 'last 30 days'), `: ${usageLine(u)}`] : null) : null,
    p?.error ? h('div', { class: 'note bad' }, p.error) : null,
    healthNote(p),
    isOn ? h('div', {}, connected, h('div', { class: 'row', style: 'margin-top:10px' }, t.btn, rest), t.out, accounts || null)
      : ownerOnly && !can('owner') ? h('p', { class: 'small muted' }, 'Ask an owner to connect this account.')
        : h('div', {}, h('div', { class: 'eyebrow', style: 'margin-top:14px' }, 'How to connect'), stepList(steps), form));
}

/** 042: "Paused until 14:20 — usage limit reached" with a "Try again now" button; nothing when the account is fine. */
function healthNote(p) {
  const st = p?.health;
  if (!st || st.state === 'ok') return null;
  return h('div', { class: `note ${st.state === 'reconnect' ? 'bad' : 'warn'}` }, h('b', {}, st.text),
    st.message ? h('div', { class: 'small muted', style: 'overflow-wrap:anywhere' }, st.message) : null,
    can('admin') ? h('div', { style: 'margin-top:6px' }, h('button', { class: 'btn small mut', onclick: () => tryApi(async () => { await api('POST', `/api/accounts/${encodeURIComponent(p.id)}/retry`, {}); renderModels(); }, 'It is tried again on the next message') }, 'Try again now')) : null);
}
const healthPill = (p) => (!p.connected ? h('span', { class: 'pill bad' }, 'Needs attention') : p.health?.state === 'reconnect' ? h('span', { class: 'pill bad' }, 'Reconnect')
  : p.health?.state && p.health.state !== 'ok' ? h('span', { class: 'pill warn' }, 'Paused') : h('span', { class: 'pill ok' }, `✓ ${p.models} model${p.models === 1 ? '' : 's'}`));
/** 074: what an agent app costs on this server, as measured here ("about 200 MB while answering · starts in 0.6 s"). */
const appLine = (p) => (p?.app ? h('div', { class: 'small muted num' }, 'Runs on this server for each answer',
  p.app.peakMb ? ` · about ${p.app.peakMb} MB while answering` : '', p.app.startMs ? ` · starts in ${secs(p.app.startMs)}` : '') : null);
const planNote = () => h('p', { class: 'small muted', style: 'margin:6px 0 0' }, 'For your own, personal use with your own account; it counts against your plan’s limits. ', helpLink('models.md#agent-apps', 'What the terms say'));

/** 074: Codex's own device sign-in: a link and a one-time code; the page updates when the owner is done (activity stream). */
function codexFlow() {
  const out = h('div', {});
  const start = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    start.disabled = true; out.replaceChildren(h('div', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Preparing… the first time this downloads Codex (about 400 MB, a minute or two)'));
    const r = await tryApi(() => api('POST', '/api/providers/codex/start', {}));
    start.disabled = false;
    if (!r) return out.replaceChildren();
    start.classList.add('hide');
    out.replaceChildren(h('div', { class: 'note info' }, h('div', {}, 'Open the link, sign in with your ChatGPT account and enter this code:'),
      h('div', { class: 'row', style: 'margin:8px 0' }, h('code', { class: 'devcode' }, r.code), copyBtn(r.code, 'Copy code')),
      h('a', { class: 'btn primary', href: r.url, target: '_blank', rel: 'noopener' }, 'Open the sign-in ↗'),
      h('div', { class: 'small muted', style: 'margin-top:8px' }, h('span', { class: 'spinner' }), ' Waiting for you to finish. This page updates by itself; the code is valid for 15 minutes.')));
    const done = (e) => {
      const a = JSON.parse(e.data);
      if (a.detail?.signin !== 'codex') return;
      S.es?.removeEventListener('message', done);
      if (a.detail.ok) { toast('Codex connected'); S.models = null; renderModels(); } else { start.classList.remove('hide'); out.replaceChildren(h('div', { class: 'note bad' }, a.summary)); }
    };
    S.es?.addEventListener('message', done);
  } }, 'Sign in with ChatGPT');
  return h('div', {}, start, out);
}

const TERMS_NOTE = 'Use your own accounts. Some subscription plans’ terms forbid sharing an account or using several accounts to get around their limits, so check the provider’s terms first.';

/** A label + key form for another account. submit(label, key). */
function accountKeyForm({ placeholder, submit, button = 'Add account', keyLabel = 'Paste its key' }) {
  const lab = h('input', { placeholder: 'Label, e.g. work or your name', maxlength: 40 });
  const v = h('input', { type: 'password', placeholder, autocomplete: 'off', spellcheck: 'false' });
  const err = h('div', { class: 'small', style: 'color:var(--bad)' });
  const btn = h('button', { class: 'btn primary' }, button);
  return h('form', { class: 'mut pasteform', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (!lab.value.trim()) { err.textContent = 'Give the account a label first.'; return; }
    if (!v.value.trim()) { err.textContent = 'Paste the key first.'; return; }
    btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), ' Checking…');
    try { await submit(lab.value.trim(), v.value.trim()); toast('Account added'); S.models = null; renderModels(); } catch (x) { err.textContent = x.message; btn.disabled = false; btn.replaceChildren(button); }
  } }, h('label', {}, 'Label'), lab, h('label', {}, keyLabel), h('div', { class: 'row nowrap' }, v, btn), err);
}

/** Sign in with ChatGPT: body = {} (first account), { label } (another account) or { account } (sign in again). */
function chatgptFlow(body = {}) {
  const paste = h('input', { placeholder: '127.0.0.1:1455/auth/callback?code=…', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none', autocorrect: 'off' });
  const err = h('div', { class: 'small', style: 'color:var(--bad)' });
  const open = h('div', { class: 'row' });
  const label = body.label === '' ? h('input', { placeholder: 'Label, e.g. your name', maxlength: 40 }) : null;
  const start = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    if (label && !label.value.trim()) { err.textContent = 'Give the account a label first.'; return; }
    err.textContent = ''; start.disabled = true;
    const r = await tryApi(() => api('POST', '/api/providers/chatgpt/start', label ? { label: label.value.trim() } : body));
    start.disabled = false; if (!r) return;
    open.replaceChildren(h('a', { class: 'btn primary', href: r.authorizeUrl, target: '_blank', rel: 'noopener' }, 'Open ChatGPT sign-in ↗'), h('span', { class: 'small muted' }, 'Link valid for 15 minutes'));
    start.classList.add('hide');
  } }, body.account ? 'Sign in again' : 'Sign in with ChatGPT');
  const form = h('form', { class: 'mut pasteform', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const d = await api('POST', '/api/providers/chatgpt/complete', { callbackUrl: paste.value }).catch((x) => { err.textContent = x.message; });
    if (d) { toast(`Connected ${d.email} · ${d.models} models`); S.models = null; renderModels(); }
  } }, h('label', {}, 'Paste the whole address here'), h('div', { class: 'row nowrap' }, paste, h('button', { class: 'btn primary' }, 'Finish')),
    h('div', { class: 'small muted' }, 'Fine without http:// (iPad and iPhone copy it that way), with localhost or 127.0.0.1.'), err);
  return { start: h('div', {}, label ? field('Label', label) : null, h('div', { style: 'margin-top:8px' }, start, open)), form };
}

/**
 * 042: the other accounts of a provider (each with its own status, Test, Rename, Remove), how they are used
 * (in order / spread) and "Add another account".
 */
function accountsBox({ first, provs, addForm, ownerOnly }) {
  if (!first?.connected && !first?.error) return null;
  const others = provs.filter((p) => p.group === first.group && p.id !== first.id && (p.connected || p.error));
  const n = others.length + 1;
  const mayAdd = ownerOnly ? can('owner') : can('admin');
  const rows = others.map((p) => {
    const t = p.connected ? testBox(p.id) : null;
    const u = providerCard.usage?.account?.[p.id];
    const name = h('input', { value: p.label || '', maxlength: 40, placeholder: 'Label', autocomplete: 'off' });
    return h('div', { class: 'number-card acct' },
      h('div', { class: 'row spread' }, h('div', {}, h('b', {}, p.name), p.account ? h('div', { class: 'small muted' }, p.account) : null), healthPill(p)),
      u ? h('div', { class: 'small num' }, 'Last 30 days: ', usageLine(u)) : null,
      p.error ? h('div', { class: 'note bad' }, p.error) : null,
      healthNote(p),
      p.health?.state === 'reconnect' && p.type === 'chatgpt' && can('owner') ? (() => { const f = chatgptFlow({ account: p.id }); return h('div', {}, f.start, f.form); })() : null,
      h('div', { class: 'row', style: 'margin-top:8px' }, t?.btn,
        can('admin') ? Object.assign(menu(`More actions for ${p.name}`,
          h('button', { class: 'btn small', type: 'button', onclick: async () => { if (await ask({ title: `Rename ${p.name}`, ok: 'Rename', body: field('Label', name) }) && await tryApi(() => api('PUT', `/api/accounts/${encodeURIComponent(p.id)}`, { label: name.value.trim() }), 'Renamed')) { S.models = null; renderModels(); } } }, 'Rename'),
          can('owner') ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => (await ask({ title: `Remove ${p.name}?`, text: 'Its key or sign-in is deleted. Agents set to its models switch to the next model in the fallback chain.', ok: 'Remove account', danger: true })) && tryApi(async () => { await api('DELETE', `/api/accounts/${encodeURIComponent(p.id)}`); S.models = null; renderModels(); }, 'Removed') }, 'Remove') : null), { style: 'margin-left:auto' }) : null),
      t?.out);
  });
  const strat = first.strategy || 'order';
  const seg = n > 1 ? h('div', { class: 'seg', role: 'group', 'aria-label': 'How the accounts are used' }, [['order', 'In order'], ['spread', 'Spread']].map(([v, l]) => h('button', { type: 'button', class: strat === v ? 'on' : '', disabled: !can('admin'),
    onclick: () => tryApi(async () => { await api('PUT', '/api/fallback/strategy', { group: first.group, strategy: v }); renderModels(); }, v === 'spread' ? 'Spread across accounts' : 'In order') }, l))) : null;
  return h('div', { style: 'margin-top:14px' },
    n > 1 ? h('div', { class: 'eyebrow' }, `${n} accounts`) : null,
    rows,
    seg ? h('div', { style: 'margin-top:10px' }, seg, h('div', { class: 'small muted', style: 'margin-top:4px' }, strat === 'spread' ? 'Each message goes to the account used least recently. A failing account is skipped.' : 'The first account answers; the others only when it hits a limit or fails.')) : null,
    mayAdd ? h('details', { class: 'mut add-acct' }, h('summary', {}, h('span', { class: 'lmark add', 'aria-hidden': 'true' }, '+'), h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, 'Add another account'), h('span', { class: 'lrow-sub' }, 'When one hits a limit, the next one answers'))),
      h('div', { class: 'note info small' }, TERMS_NOTE), addForm()) : null);
}

function keyForm({ placeholder, button = 'Connect', submit, busy = 'Checking…' }) {
  const v = h('input', { type: 'password', placeholder, autocomplete: 'off', spellcheck: 'false' });
  const err = h('div', { class: 'small', style: 'color:var(--bad)' });
  const btn = h('button', { class: 'btn primary' }, button);
  return h('form', { class: 'mut pasteform', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (!v.value.trim()) { err.textContent = 'Paste the key first.'; return; }
    btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), ` ${busy}`);
    try { await submit(v.value.trim()); toast('Connected'); renderModels(); } catch (x) { err.textContent = x.message; btn.disabled = false; btn.replaceChildren(button); }
  } }, h('label', {}, 'Paste it here'), h('div', { class: 'row nowrap' }, v, btn), err);
}
const replaceKey = (form) => h('details', { class: 'small mut' }, h('summary', {}, 'Replace key'), form);

export async function renderModels() {
  const [provs, models, us, media] = await Promise.all([api('GET', '/api/providers'), loadModels(true), usageSummary(), api('GET', '/api/media').catch(() => null)]);
  providerCard.usage = us;
  const by = Object.fromEntries(provs.map((p) => [p.id, p]));
  const anyOn = provs.some((p) => p.connected);
  const disconnect = (what, path, consequence) => h('button', { class: 'btn small danger mut', onclick: async () => (await ask({ title: `Disconnect ${what}?`, text: consequence, ok: 'Disconnect', danger: true })) && tryApi(async () => { await api('DELETE', path); S.models = null; renderModels(); }, 'Disconnected') }, 'Disconnect');

  // OpenRouter
  const or = by.openrouter;
  const freeToggle = or ? h('label', { class: 'inline' }, toggle(or.freeOnly, (on) => tryApi(async () => { await api('POST', '/api/providers/openrouter', { freeOnly: on }); S.models = null; renderModels(); }, on ? 'Free models only' : 'All models allowed')), 'Free models only') : null;
  const orCard = providerCard({
    id: 'openrouter', mark: 'm-or', title: or?.name || 'OpenRouter', p: or,
    cost: 'Free models: 50 requests a day (1,000 a day after buying $10 of credit), 20 a minute. Paid models cost per use.',
    tag: h('span', { class: 'pill info' }, 'Zero-cost start'),
    steps: [
      [h('span', {}, 'Open ', ext(LINKS.openrouterKeys, 'OpenRouter keys'), ' and sign in (Google, GitHub or email).')],
      [h('span', {}, 'Click ', h('b', {}, 'Create API Key'), ', name it “duniya” and create it.'), cue.win('openrouter.ai/settings/keys', h('span', { class: 'muted' }, 'API Keys'), cue.hl(cue.btn('Create API Key', true)))],
      [h('span', {}, 'Copy the key. It starts with ', h('code', {}, 'sk-or-'), ' and is shown only once.'), cue.win('openrouter.ai', cue.hl(cue.field('sk-or-v1-8f2c…')))],
    ],
    form: keyForm({ placeholder: 'sk-or-v1-…', button: 'Add OpenRouter', submit: (key) => api('POST', '/api/providers/openrouter', { key, freeOnly: true }) }),
    connected: h('div', {}, h('div', { class: 'row spread' }, freeToggle, ext(LINKS.openrouterFree, 'See free models')),
      h('p', { class: 'small muted', style: 'margin:4px 0 0' }, or?.freeOnly ? 'Only models ending in “:free” are listed and used, so nothing is charged. Auto picks one of them.' : 'All OpenRouter models are listed. Paid models use your OpenRouter credit.')),
    accounts: accountsBox({ first: or, provs, addForm: () => accountKeyForm({ placeholder: 'sk-or-v1-…', submit: (label, key) => api('POST', '/api/providers/openrouter', { label, key, freeOnly: true }) }) }),
    extra: [replaceKey(keyForm({ placeholder: 'sk-or-v1-…', button: 'Save', submit: (key) => api('POST', '/api/providers/openrouter', { key }) })),
      h('button', { class: 'btn small danger mut', onclick: async () => (await ask({ title: 'Remove OpenRouter?', text: 'Agents using OpenRouter models switch to Auto.', ok: 'Remove OpenRouter', danger: true })) && tryApi(async () => { await api('DELETE', '/api/providers/compatible/openrouter'); S.models = null; renderModels(); }, 'Removed') }, 'Remove')],
  });

  // Anthropic
  const anCard = providerCard({
    id: 'anthropic', mark: 'm-an', title: by.anthropic?.name || 'Claude', p: by.anthropic,
    cost: 'Pay per use with prepaid credit in the Claude Console. Very good with tools.',
    steps: [
      [h('span', {}, 'Open ', ext(LINKS.anthropicKeys, 'Claude Console → API keys'), '. Sign in, and add credit under Billing if asked.')],
      [h('span', {}, 'Click ', h('b', {}, 'Create Key'), ', name it “duniya”.'), cue.win('platform.claude.com/settings/keys', h('span', { class: 'muted' }, 'API keys'), cue.hl(cue.btn('+ Create Key', true)))],
      [h('span', {}, 'Copy the key (starts with ', h('code', {}, 'sk-ant-'), '). It is shown only once.'), cue.win('platform.claude.com', cue.hl(cue.field('sk-ant-api03-Xk…')))],
    ],
    form: keyForm({ placeholder: 'sk-ant-…', submit: saveSecretKey('ANTHROPIC_API_KEY') }),
    connected: h('p', { class: 'small muted', style: 'margin:0' }, 'This uses your API key. For your Claude Pro or Max plan, connect ', h('a', { href: '#models/claudecode' }, 'Claude Code'), '.'),
    accounts: accountsBox({ first: by.anthropic, provs, addForm: () => accountKeyForm({ placeholder: 'sk-ant-…', submit: (label, key) => api('POST', '/api/accounts', { type: 'anthropic', label, key }) }) }),
    extra: [replaceKey(keyForm({ placeholder: 'sk-ant-…', button: 'Save', submit: saveSecretKey('ANTHROPIC_API_KEY') })),
      h('button', { class: 'btn small danger mut', onclick: async () => (await ask({ title: 'Remove the Anthropic key?', text: 'Agents using Claude stop answering until another model is chosen.', ok: 'Remove key', danger: true })) && tryApi(async () => { await api('PUT', '/api/secrets', { name: 'ANTHROPIC_API_KEY', value: '' }); S.models = null; renderModels(); }, 'Removed') }, 'Remove')],
  });

  // OpenAI
  const oaCard = providerCard({
    id: 'openai', mark: 'm-oa', title: by.openai?.name || 'OpenAI', p: by.openai,
    cost: 'Pay per use with prepaid credit on the OpenAI platform (separate from ChatGPT plans).',
    steps: [
      [h('span', {}, 'Open ', ext(LINKS.openaiKeys, 'OpenAI → API keys'), ' and sign in. Add credit under Billing if asked.')],
      [h('span', {}, 'Click ', h('b', {}, 'Create new secret key'), ', name it “duniya”.'), cue.win('platform.openai.com/api-keys', cue.hl(cue.btn('+ Create new secret key', true)))],
      [h('span', {}, 'Copy the key (starts with ', h('code', {}, 'sk-'), '). It is shown only once.'), cue.win('platform.openai.com', cue.hl(cue.field('sk-proj-4Tq…')))],
    ],
    form: keyForm({ placeholder: 'sk-…', submit: saveSecretKey('OPENAI_API_KEY') }),
    accounts: accountsBox({ first: by.openai, provs, addForm: () => accountKeyForm({ placeholder: 'sk-…', submit: (label, key) => api('POST', '/api/accounts', { type: 'openai', label, key }) }) }),
    extra: [replaceKey(keyForm({ placeholder: 'sk-…', button: 'Save', submit: saveSecretKey('OPENAI_API_KEY') })),
      h('button', { class: 'btn small danger mut', onclick: async () => (await ask({ title: 'Remove the OpenAI key?', text: 'Agents using OpenAI models stop answering until another model is chosen.', ok: 'Remove key', danger: true })) && tryApi(async () => { await api('PUT', '/api/secrets', { name: 'OPENAI_API_KEY', value: '' }); S.models = null; renderModels(); }, 'Removed') }, 'Remove')],
  });

  // ChatGPT plan (sign-in logic unchanged; clearer steps)
  const cg = by.chatgpt;
  const cgFlow = chatgptFlow({});
  const cgCard = providerCard({
    id: 'chatgpt', mark: 'm-cg', title: cg?.name || 'ChatGPT', p: cg, ownerOnly: true,
    cost: 'Included in your ChatGPT plan; its limits apply.', account: cg?.account,
    steps: [
      [h('span', {}, 'Click the button and open the sign-in.'), cgFlow.start],
      [h('span', {}, 'Sign in with your ChatGPT account and allow access.'), cue.win('auth.openai.com', h('span', { class: 'muted' }, 'Allow duniya to use your plan?'), cue.hl(cue.btn('Allow', true)))],
      [h('span', {}, 'Your browser then shows “This site can’t be reached”. ', h('b', {}, 'That’s expected'), ', the sign-in worked.'),
        h('div', { class: 'cue', 'aria-hidden': 'true' }, h('div', { class: 'cue-addr' }, cue.hl(h('span', {}, '127.0.0.1:1455/auth/callback?code=ac_…&state=…'))), h('div', { class: 'cue-body' }, h('b', {}, 'This site can’t be reached'), h('span', { class: 'muted' }, '127.0.0.1 refused to connect.')))],
      [h('span', {}, 'Click the address bar, copy the ', h('b', {}, 'whole address'), ' and paste it below. It may start with ', h('code', {}, 'localhost'), ' or ', h('code', {}, '127.0.0.1'), ' without ', h('code', {}, 'http://'), ': that’s fine.')],
    ],
    form: cgFlow.form,
    connected: cg?.health?.state === 'reconnect' && can('owner') ? h('div', {}, cgFlow.start, cgFlow.form) : null,
    accounts: accountsBox({ first: cg, provs, ownerOnly: true, addForm: () => { const f = chatgptFlow({ label: '' }); return h('div', {}, f.start, f.form); } }),
    extra: can('owner') ? disconnect('ChatGPT', '/api/providers/chatgpt', 'Agents using ChatGPT models stop answering until another model is chosen.') : null,
  });

  // GitHub Copilot (official SDK)
  const co = by.copilot;
  const coCard = providerCard({
    id: 'copilot', mark: 'm-gh', title: co?.name || 'GitHub Copilot', p: co, ownerOnly: true,
    cost: 'Uses your Copilot allowance (Free, Pro or Business).',
    tag: h('span', { class: 'pill' }, 'Uses your Copilot allowance'),
    steps: [
      [h('span', {}, 'You need a GitHub account with Copilot turned on. No account yet? ', ext(LINKS.githubSignup, 'Sign up'), '.')],
      [h('span', {}, 'Open ', ext(LINKS.copilotToken, 'this pre-filled token page'), '. Check that ', h('b', {}, 'Copilot requests'), ' is set, then click ', h('b', {}, 'Generate token'), '.'),
        cue.win('github.com/settings/personal-access-tokens/new', h('div', { class: 'cue-perm' }, h('span', {}, 'Copilot requests'), cue.hl(h('span', { class: 'cue-select' }, 'Read and write ▾'))), cue.btn('Generate token', true))],
      [h('span', {}, 'Copy the token (starts with ', h('code', {}, 'github_pat_'), '). It is shown only once. Classic tokens (', h('code', {}, 'ghp_'), ') don’t work.'), cue.win('github.com', cue.hl(cue.field('github_pat_11AB…')))],
    ],
    form: h('div', {}, keyForm({ placeholder: 'github_pat_…', busy: 'Connecting… the first time this downloads Copilot support (about 220 MB, a minute)', submit: (token) => api('POST', '/api/providers/copilot', { token }) }),
      h('p', { class: 'small muted' }, 'Refused? Switch “Copilot requests” to the other access level on GitHub and try again. The first connection downloads GitHub’s Copilot helper (about 220 MB).')),
    connected: appLine(co),
    account: co?.account,
    accounts: accountsBox({ first: co, provs, ownerOnly: true, addForm: () => accountKeyForm({ placeholder: 'github_pat_…', keyLabel: 'Paste its GitHub token (fine-grained, with Copilot requests)', submit: (label, token) => api('POST', '/api/providers/copilot', { label, token }) }) }),
    extra: can('owner') ? [replaceKey(keyForm({ placeholder: 'github_pat_…', button: 'Save', submit: (token) => api('POST', '/api/providers/copilot', { token }) })),
      disconnect('GitHub Copilot', '/api/providers/copilot', 'Agents using Copilot models stop answering until another model is chosen.')] : null,
  });

  // 074: agent apps — the official apps run on this server with your own plan
  const cc = by.claudecode;
  const ccCard = providerCard({
    id: 'claudecode', mark: 'm-an', title: cc?.name || 'Claude Code', p: cc, ownerOnly: true,
    cost: 'Included in your Claude Pro or Max plan; its limits apply. Runs Anthropic’s Claude Code app on this server.',
    steps: [
      [h('span', {}, 'You need a Claude Pro or Max plan. On your computer, install Claude Code (', ext(LINKS.claudeCodeSetup, 'how'), ') and run ', h('code', {}, 'claude setup-token'), ' in a terminal. Sign in when your browser opens.')],
      [h('span', {}, 'Copy the token it prints. It starts with ', h('code', {}, 'sk-ant-oat01-'), ' and is valid for a year.'), cue.win('Terminal', cue.hl(cue.field('sk-ant-oat01-Xk…')))],
    ],
    form: h('div', {}, keyForm({ placeholder: 'sk-ant-oat01-…', busy: 'Connecting… the first time this downloads Claude Code (about 360 MB, a minute)', submit: (token) => api('POST', '/api/providers/claudecode', { token }) }), planNote()),
    connected: h('div', {}, appLine(cc), planNote()),
    extra: can('owner') ? [replaceKey(keyForm({ placeholder: 'sk-ant-oat01-…', button: 'Save', submit: (token) => api('POST', '/api/providers/claudecode', { token }) })),
      disconnect('Claude Code', '/api/providers/claudecode', 'Its token and the downloaded app are removed. Agents using it switch to the next model.')] : null,
  });
  const cx = by.codex;
  const cxCard = providerCard({
    id: 'codex', mark: 'm-cg', title: cx?.name || 'Codex', p: cx, ownerOnly: true, account: cx?.account,
    cost: 'Included in your ChatGPT plan; its Codex limits apply. Runs OpenAI’s Codex app on this server.',
    steps: [[h('span', {}, 'Click the button. You get a link and a one-time code.'), codexFlow()],
      [h('span', {}, 'Open the link on any device, sign in with your ChatGPT account and enter the code. This page updates by itself.')]],
    form: planNote(),
    connected: h('div', {}, appLine(cx), planNote()),
    extra: can('owner') ? disconnect('Codex', '/api/providers/codex', 'Its sign-in and the downloaded app are removed. Agents using it switch to the next model.') : null,
  });

  // Other OpenAI-compatible endpoints (advanced)
  const cid = h('input', { placeholder: 'id, e.g. ollama' }); const cname = h('input', { placeholder: 'Name' });
  const curl = h('input', { placeholder: 'http://localhost:11434/v1' }); const ckey = h('input', { type: 'password', placeholder: 'API key (optional)' });
  const compat = provs.filter((p) => p.type === 'compatible' && p.id !== 'openrouter');
  const otherCard = h('div', { class: 'card' }, h('h2', {}, 'Other endpoints'),
    h('p', { class: 'small muted' }, 'Ollama, LM Studio, vLLM, Groq, Mistral… anything with an OpenAI-style /chat/completions.'),
    compat.map((p) => { const t = p.connected ? testBox(p.id) : null; return h('div', { class: 'number-card' },
      h('div', { class: 'row spread' }, h('div', {}, h('b', {}, p.name), h('div', { class: 'small muted' }, p.baseUrl)), healthPill(p)),
      p.error ? h('div', { class: 'note bad' }, p.error) : null, healthNote(p),
      h('div', { class: 'row', style: 'margin-top:8px' }, t?.btn, h('button', { class: 'btn small danger mut', onclick: async () => (await ask({ title: `Remove ${p.name}?`, text: 'Agents using its models switch to Auto.', ok: `Remove ${p.name}`, danger: true })) && tryApi(async () => { await api('DELETE', `/api/providers/compatible/${p.id}`); S.models = null; renderModels(); }, 'Removed') }, 'Remove')), t?.out); }),
    h('details', { class: 'mut' }, h('summary', {}, 'Add an endpoint'),
      h('form', { onsubmit: async (e) => { e.preventDefault(); if (await tryApi(() => api('POST', '/api/providers/compatible', { id: cid.value.trim(), name: cname.value.trim(), baseUrl: curl.value.trim(), key: ckey.value }), 'Saved')) { S.models = null; renderModels(); } } },
        h('div', { class: 'row', style: 'margin-top:8px' }, cid, cname), h('div', { class: 'row', style: 'margin-top:6px' }, curl, ckey), h('button', { class: 'btn', style: 'margin-top:8px' }, 'Add endpoint'))));

  // Defaults
  const def = modelSelect(models, models.defaultModel, { autoLabel: `Auto${models.resolvedDefault ? ` (now ${models.resolvedDefault})` : ''}` });
  const bg = modelSelect(models, models.backgroundModel, { autoLabel: `Auto${models.resolvedBackground ? ` (now ${models.resolvedBackground})` : ''}` });
  const defaults = h('div', { class: 'card' }, h('h2', {}, 'Default models'),
    anyOn ? null : h('p', { class: 'small muted' }, 'Connect a provider above first.'),
    field('Default model (agents on Auto)', def, models.resolvedDefault ? `Auto currently means ${models.resolvedDefault}` : ''),
    field('Background model (memory summaries)', bg, models.resolvedBackground ? `Auto currently means ${models.resolvedBackground}` : ''),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn primary mut', onclick: () => tryApi(async () => { await api('POST', '/api/models/defaults', { defaultModel: def.value, backgroundModel: bg.value }); S.models = null; renderModels(); }, 'Saved') }, 'Save'),
      h('button', { class: 'btn', onclick: async () => { S.models = null; await api('GET', '/api/providers?refresh=1'); renderModels(); } }, 'Refresh model lists')));

  // When a model fails (042)
  const fb = models.fallback || { enabled: true, chain: [] };
  const fbOn = h('input', { type: 'checkbox', checked: fb.enabled, disabled: !can('admin') });
  const fbChain = chainEditor(models, fb.chain);
  const troubled = provs.filter((p) => p.connected && p.health && p.health.state !== 'ok');
  const fallbackCard = h('div', { class: 'card', id: 'fallback' }, h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'When a model fails'),
    h('span', { class: `pill ${troubled.length ? 'warn' : fb.enabled ? 'ok' : ''}` }, troubled.length ? `${troubled.length} paused` : fb.enabled ? 'Switching on' : 'Off')),
    h('p', { class: 'small muted' }, 'If the model an agent uses hits a usage limit, is down, times out or its sign-in expired, the agent answers with the next model below instead of failing. A paused account is skipped and tried again later (1 minute, then longer; for usage limits when the provider says it resets). Refused requests never switch, and tools never run twice.'),
    troubled.map((p) => h('div', { class: 'row spread small', style: 'margin:4px 0' }, h('span', {}, h('b', {}, p.name), ` — ${p.health.text}`), h('a', { href: `#models/${p.type}` }, 'See account'))),
    h('label', { class: 'inline', style: 'margin-top:8px' }, fbOn, 'Switch to another model automatically'),
    field('Try these, in order', fbChain.el, 'Agents and chats can have their own setting (agent page, Chats).'),
    can('admin') ? h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary mut', onclick: () => tryApi(async () => { await api('PUT', '/api/fallback', { enabled: fbOn.checked, chain: fbChain.value() }); S.models = null; renderModels(); }, 'Saved') }, 'Save')) : null);

  // 064: a list of providers (mark, name, health, short status) → the chosen provider's page; #models/<id>
  const MARKS = { openrouter: ['O', 'c4'], anthropic: ['A', 'c1'], openai: ['O', 'c3'], chatgpt: ['C', 'c5'], copilot: ['G', 'c0'], claudecode: ['C', 'c1'], codex: ['X', 'c5'] };
  const pages = { openrouter: orCard, anthropic: anCard, openai: oaCard, chatgpt: cgCard, copilot: coCard, claudecode: ccCard, codex: cxCard };
  const names = Object.fromEntries(Object.entries(pages).map(([id, card]) => [id, card.querySelector('h2')?.textContent || id]));
  const state = (p) => (!p?.connected ? (p?.error ? ['bad', 'needs attention'] : ['', 'not connected']) : p.health?.state && p.health.state !== 'ok' ? [p.health.state === 'reconnect' ? 'bad' : 'warn', p.health.text] : ['ok', `Connected · ${plural(p.models, 'model')}`]);
  const row = (id, p, name) => {
    const [st, text] = state(p);
    return { id, name, mark: mark(...(MARKS[id] || [name[0], 'c0'])), status: h('span', { class: `dot ${st}`, 'aria-hidden': 'true' }), sub: text };
  };
  const on = Object.keys(pages).filter((id) => by[id]?.connected || by[id]?.error);
  const off = Object.keys(pages).filter((id) => !on.includes(id));
  for (const p of compat) pages[`x-${p.id}`] = otherCard;
  pages.add = h('div', { class: 'card start' }, h('h2', {}, anyOn ? 'Add a provider' : 'Connect a model so your agents can answer'),
    h('p', { class: 'small muted', style: 'margin-top:-6px' }, anyOn ? 'Pick one; you choose the model per agent.' : 'Pick one to begin. You can add more later and choose per agent.'),
    // 066: compact rows named by provider (names.js), one short line each; connected ones stay listed (another account)
    h('ul', { class: 'add-list' }, ADD_PROVIDERS.map(([id, line]) => {
      const isOn = by[id]?.connected; const [letter, c] = MARKS[id] || ['E', 'c0'];
      return h('li', {}, h('a', { class: 'lrow', href: `#models/${id === 'compatible' ? 'endpoints' : id}` }, mark(letter, c),
        h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, PROVIDER_NAMES[id]), h('span', { class: 'lrow-sub' }, isOn ? 'Connected · add another account' : line)),
        isOn ? h('span', { class: 'dot ok', 'aria-hidden': 'true' }) : null, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
    })));
  pages.endpoints = otherCard; pages.fallback = fallbackCard; pages.defaults = defaults;
  if (media && anyOn) pages.abilities = mediaCapsCard(media);
  $('#main').replaceChildren(listDetail({ screen: 'models', title: 'Models', known: (id) => Object.hasOwn(pages, id), first: anyOn ? on[0] : 'add', page: (id) => pages[id] || pages.add, groups: [
    { title: 'Providers', items: [...on.map((id) => row(id, by[id], names[id])), ...compat.map((p) => row(`x-${p.id}`, p, p.name)),
      { id: 'add', name: anyOn ? 'Add a provider' : 'Connect a model', sub: anyOn ? `${off.length} more available` : 'Start here: free or your own plan', mark: h('span', { class: 'lmark add', 'aria-hidden': 'true' }, '+') }] },
    { title: 'How models are used', items: [
      { id: 'defaults', name: 'Default models', sub: models.resolvedDefault ? `Auto uses ${modelLabel(models.resolvedDefault, models)}` : 'Auto', mark: mark(icon('models'), 'c4') },
      anyOn ? { id: 'fallback', name: 'When a model fails', sub: troubled.length ? `${troubled.length} paused` : fb.enabled ? 'Switches automatically' : 'Off', mark: mark(icon('refresh'), 'c1'), status: troubled.length ? h('span', { class: 'dot warn', 'aria-hidden': 'true' }) : null } : null,
      pages.abilities ? { id: 'abilities', name: 'Photos & voice', sub: 'What each provider can do', mark: mark(icon('image'), 'c2') } : null,
      { id: 'endpoints', name: 'Other endpoints', sub: compat.length ? plural(compat.length, 'endpoint') : 'Ollama, LM Studio…', mark: mark(icon('globe'), 'c0') }].filter(Boolean) }] }));
}

// ---------- Models → Photos & voice (043): what each connected provider can do beyond text ----------
const CAP_COLS = [['sees', 'Sees images'], ['hears', 'Hears voice'], ['creates', 'Creates images'], ['speaks', 'Speaks']];
const capPill = (on, some) => h('span', { class: `pill ${on ? 'ok' : ''}` }, some ? '✓ some models' : on ? '✓ yes' : '— no');
function mediaCapsCard(m) {
  const cell = (r, k) => {
    const v = r[k];
    const on = v === true || v === 'yes' || v === 'some';
    return h('td', { 'data-label': CAP_COLS.find((c) => c[0] === k)[1] }, capPill(on, v === 'some'));
  };
  // One "how to enable" line per distinct hint, under the provider's name (not repeated in every cell).
  const hints = (r) => [...new Set(CAP_COLS.filter(([k]) => !(r[k] === true || r[k] === 'yes' || r[k] === 'some') && r.how?.[k]).map(([k]) => r.how[k]))]
    .map((x) => h('div', { class: 'small muted', style: 'margin-top:3px' }, x));
  const s = m.summary;
  const local = s.localListen || s.localSpeak ? h('tr', {}, h('td', { 'data-label': '' }, h('b', {}, 'This server'), h('div', { class: 'small muted' }, 'On-server engines')),
    h('td', { 'data-label': 'Sees images' }, capPill(false)), h('td', { 'data-label': 'Hears voice' }, capPill(s.localListen)),
    h('td', { 'data-label': 'Creates images' }, capPill(false)), h('td', { 'data-label': 'Speaks' }, capPill(s.localSpeak))) : null;
  const line = [s.sees && 'see photos', s.hears && 'listen to voice notes', s.creates && 'create pictures', s.speaks && 'answer with voice'].filter(Boolean);
  return h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'Photos & voice'), h('a', { class: 'btn small', href: '#settings' }, 'Settings')),
    h('p', { class: 'small muted', style: 'margin:6px 0 10px' }, line.length ? `With what is connected, agents can ${line.join(', ')}. Photos and voice notes are sent to the provider. Switch each agent’s use on its page (Photos & voice).` : 'Connect a provider to let agents see photos, listen to voice notes, create pictures or answer with voice.'),
    h('table', { class: 'stack' }, h('thead', {}, h('tr', {}, h('th', {}, 'Provider'), CAP_COLS.map(([, l]) => h('th', {}, l)))),
      h('tbody', {}, m.providers.map((r) => h('tr', {}, h('td', { 'data-label': '' }, h('b', {}, r.name), hints(r)), CAP_COLS.map(([k]) => cell(r, k)))), local)));
}

