// Chats screen: on/off per chat, direct chats; a chat's page with Messages, Memory and the WhatsApp group (072). Module of the panel (063).
import { $, S, ago, api, ask, avatar, can, copyRow, emptyState, field, h, icon, menu, refreshStatus, tagPill, time, toast, toggle, tryApi, whoLabel } from './core.js';
import { answerActions } from './answers.js';
import { chatFallbackEditor, chatFallbackLine } from './fallback.js';
import { silenceFix } from './quiet.js';
import { listDetail } from './listdetail.js';
import { highlight, searchWords } from './find.js';
import { helpLink, loadModels, modelSelect, plural, quietLine, usageLine } from './shared.js';
import { capEditor, usageSummary } from './usage.js';
let chatsFilter = 'all';
let chatsQuery = ''; // 062: Find a chat
/** 049 (#92): set up a direct chat by phone number (or a contact) before the person writes. */
function addDirectChatCard(agents, { pre = null, onDone } = {}) {
  const numbers = (S.status?.channel?.numbers || []).length ? S.status.channel.numbers : [{ id: 'main', label: 'Main' }];
  const phone = h('input', { placeholder: '+41 79 123 45 67', inputmode: 'tel', autocomplete: 'off', value: pre?.phone ? `+${pre.phone}` : '', 'aria-label': 'Phone number with country code' });
  const who = h('div', { class: 'small muted', style: 'margin-top:4px;min-height:1.2em' }, pre?.name ? `Contact: ${pre.name}` : '');
  const search = h('input', { type: 'search', placeholder: 'Or search your contacts', 'aria-label': 'Search contacts' });
  const hits = h('div', { class: 'row', style: 'gap:6px;margin-top:6px' });
  let timer;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => {
    const q = search.value.trim(); if (!q) { hits.replaceChildren(); return; }
    const list = await api('GET', `/api/contacts?q=${encodeURIComponent(q)}&limit=6`).catch(() => []);
    hits.replaceChildren(...list.slice(0, 6).map((c) => h('button', { type: 'button', class: 'btn small', onclick: () => { phone.value = `+${c.phone}`; who.textContent = `Contact: ${c.name}`; hits.replaceChildren(); search.value = ''; check(); } }, `${c.name} · +${c.phone}`)),
      list.length ? null : h('span', { class: 'small muted' }, 'No contact matches.'));
  }, 250); };
  const number = h('select', { 'aria-label': 'WhatsApp number' }, numbers.map((n) => h('option', { value: n.id }, n.label || n.id)));
  const agent = h('select', { 'aria-label': 'Agent' }, h('option', { value: '' }, '— no agent yet —'), agents.filter((b) => !b.builtin).map((b) => h('option', { value: b.id }, b.name + (b.enabled ? '' : ' (off)'))));
  const on = h('input', { type: 'checkbox', checked: true }); const priv = h('input', { type: 'checkbox' });
  const status = h('div', { class: 'small', style: 'min-height:1.2em;margin-top:4px' });
  const check = () => tryApi(async () => {
    if (!phone.value.trim()) { status.replaceChildren(); return; }
    const r = await api('POST', '/api/direct-chats/check', { phone: phone.value, number: number.value });
    if (r.name && !who.textContent) who.textContent = `Contact: ${r.name}`;
    status.replaceChildren(h('span', { style: `color:var(--${r.onWhatsApp === false ? 'warn' : r.onWhatsApp ? 'ok' : 'muted'})` },
      r.onWhatsApp === false ? '⚠ Not on WhatsApp? You can still set it up.' : r.onWhatsApp ? '✓ On WhatsApp' : 'Could not check (WhatsApp offline)'),
    r.existing ? h('span', { class: 'muted' }, ' · already set up — saving changes it') : null);
  }).catch(() => {});
  phone.oninput = () => { who.textContent = ''; status.replaceChildren(); };
  phone.onchange = check; number.onchange = check;
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Set up chat');
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    const r = await tryApi(() => api('POST', '/api/direct-chats', { phone: phone.value, number: number.value, agent: agent.value || undefined, enabled: on.checked, private: priv.checked }));
    if (!r) return;
    toast(r.warning ? `Chat ready. ${r.warning}` : `Chat with ${r.name} ready — waiting for the first message`);
    onDone?.(r);
  } },
  h('div', { class: 'sec-head' }, h('h2', { tabindex: '-1' }, 'Add a direct chat'), helpLink('chats.md#set-up-a-direct-chat-before-the-person-writes')),
  h('p', { class: 'small muted sec-line' }, 'Their first message goes straight to the agent. Nothing is sent to them.'),
  h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px' },
    h('div', {}, h('label', {}, 'Phone number'), phone, who, status),
    h('div', {}, h('label', {}, 'From contacts'), search, hits),
    numbers.length > 1 ? field('WhatsApp number', number, 'The number this person will write to.') : null,
    field('Agent', agent)),
  h('div', { class: 'row spread', style: 'margin-top:10px' },
    h('div', { class: 'row', style: 'gap:6px 16px' }, h('label', { class: 'tick' }, on, ' On — the agent may answer'), h('label', { class: 'tick', title: 'Hidden from the owner assistant and the Ask box' }, priv, ' Private to members')),
    save));
  if (pre?.phone) setTimeout(check, 0);
  return form;
}
/** 049: the agent's first message to a direct chat — preview, edit, then "Send intro now" (the explicit confirm). */
async function introCard(c, { onClose, onSent } = {}) {
  const enc = encodeURIComponent(c.id);
  const head = h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, `Intro message · ${c.name || c.id}`), h('button', { class: 'btn small mut', onclick: () => onClose?.() }, 'Close'));
  let p;
  try { p = await api('POST', `/api/chats/${enc}/intro/preview`, {}); } catch (e) {
    return h('div', { class: 'card', style: 'margin-top:14px' }, head, h('div', { class: 'note warn' }, e.message));
  }
  const text = h('textarea', { maxlength: 1000, style: 'min-height:84px', 'aria-label': 'Intro text' }); text.value = p.text;
  const send = h('button', { class: 'btn primary', onclick: async () => {
    send.disabled = true;
    const r = await tryApi(async () => { const q = await api('POST', `/api/chats/${enc}/intro/preview`, { text: text.value }); return api('POST', `/api/chats/${enc}/intro`, { token: q.token }); }, 'Intro sent');
    send.disabled = false;
    if (r) onSent?.(r);
  } }, 'Send intro now');
  return h('div', { class: 'card', style: 'margin-top:14px' }, head,
    h('p', { class: 'small muted' }, `${p.agentName} sends this to ${p.to} on WhatsApp when you press Send. Edit it first if you like.`),
    text,
    p.notice ? h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Added once, because it is the first message to this person: ', h('i', {}, p.notice)) : null,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, send));
}
/** The one muted line of a chat's row (068): "Captain Raju · 7 members", "Off · 12 members". */
const chatLine = (c, agentName) => [c.waiting ? 'Waiting for the first message' : c.enabled ? agentName || 'No agent' : 'Off',
  c.offline ? 'not a member, or WhatsApp is offline' : c.isGroup ? plural(c.size || 0, 'member') : c.phone ? `+${c.phone}` : ''].filter(Boolean).join(' · ');
export async function renderChats() {
  const [list, agents, models, us, quiet] = await Promise.all([api('GET', '/api/chats'), api('GET', '/api/agents'), loadModels().catch(() => ({ models: [] })), usageSummary(), api('GET', '/api/silences?days=7').catch(() => ({ silences: [] }))]);
  // 070: the list leaves out settings at their default
  const chats = list.map((c) => ({ model: 'inherit', logging: 'inherit', welcome: 'inherit', fallback: { mode: 'inherit', chain: [] }, ...c }));
  const quietBy = new Map(); // #34: why agents stayed quiet, per chat (most frequent first)
  for (const q of quiet.silences) { if (!quietBy.has(q.chat)) quietBy.set(q.chat, []); quietBy.get(q.chat).push(q); }
  const agentName = (c) => agents.find((x) => x.id === c.agent)?.name;
  const multi = new Set(chats.map((c) => c.number)).size > 1;
  const sub = (c) => { const q = (quietBy.get(c.id) || [])[0];
    return h('span', {}, chatLine(c, agentName(c)), q ? h('span', { class: q.reason === 'not_addressed' ? 'q' : 'q warn' }, ` · ${quietLine(q).toLowerCase()}`) : null, multi ? ` · ${c.numberLabel}` : ''); };
  const rowOf = (c) => document.querySelector(`.ld-list a[href="#chats/${CSS.escape(encodeURIComponent(c.id))}"]`);
  const refresh = (c) => { const a = rowOf(c); if (!a) return; a.querySelector('.lrow-sub').replaceChildren(sub(c)); a.querySelector('.av')?.classList.toggle('off', !c.enabled);
    const sw = a.parentElement.querySelector('input[role=switch]'); if (sw) sw.checked = !!c.enabled; const ps = document.querySelector(`.chat-page[data-chat="${CSS.escape(c.id)}"] .ap-head input[role=switch]`); if (ps) ps.checked = !!c.enabled; };
  const setOn = (c, v) => tryApi(async () => {
    const r = await api('PUT', `/api/chats/${encodeURIComponent(c.id)}/prefs`, { enabled: v }); c.enabled = v; c.ignored = 0; if (r.history) c.history = r.history; refresh(c);
    toast(v ? `${c.name || 'Chat'} on — agents may answer here` : `${c.name || 'Chat'} off — agents ignore it`, { undo: () => setOn(c, !v) });
  });
  const item = (c) => ({ id: c.id, name: c.name || c.id, sub: sub(c), mark: avatar(c.name || c.phone || c.id, c.id, c.enabled ? '' : 'off'),
    end: toggle(c.enabled, (v) => setOn(c, v), !can('admin'), `${c.name || c.id} on`) });
  const groups = [{ title: 'On', items: chats.filter((c) => c.enabled).map(item) }, { title: 'Off', items: chats.filter((c) => !c.enabled).map(item) }];
  if (can('admin')) groups.push({ items: [{ id: 'add', name: 'Add a direct chat', sub: 'Set it up before the person writes', mark: h('span', { class: 'lmark add', 'aria-hidden': 'true' }, '+') }] });
  if (!chats.length && !can('admin')) return $('#main').replaceChildren(h('div', { class: 'card' }, emptyChats()));
  const ld = listDetail({ screen: 'chats', title: 'Chats', groups, first: chats[0]?.id || 'add',
    page: (id) => (id === 'add' ? addDirectChatCard(agents, { pre: takePrefill(), onDone: (r) => { location.hash = `chats/${encodeURIComponent(r.id || '')}`; } })
      : chatPage(chats.find((c) => c.id === id), { agents, models, us, quiet: quietBy.get(id) || [], refresh, setOn })) });
  // 068: filters and search on one line above the list; rows are hidden in place (the open page stays)
  const apply = () => {
    const q = chatsQuery.trim().toLowerCase();
    for (const c of chats) { const a = rowOf(c); if (!a) continue;
      a.parentElement.hidden = !((chatsFilter === 'all' || (chatsFilter === 'groups' ? c.isGroup : !c.isGroup)) && (!q || `${c.name} ${c.phone || ''} ${agentName(c) || ''}`.toLowerCase().includes(q))); }
    for (const g of ld.querySelectorAll('.lgroup')) g.hidden = ![...g.querySelectorAll('li')].some((li) => !li.hidden);
  };
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, [['all', 'All'], ['groups', 'Groups'], ['people', 'People']].map(([v, l]) => h('button', { type: 'button', class: chatsFilter === v ? 'on' : '', 'aria-pressed': String(chatsFilter === v), onclick: (e) => {
    chatsFilter = v; seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b === e.target); b.setAttribute('aria-pressed', String(b === e.target)); }); apply();
  } }, l)));
  const find = chats.length > 6 ? h('input', { type: 'search', value: chatsQuery, placeholder: 'Find', 'aria-label': 'Find a chat, person or agent', oninput: (e) => { chatsQuery = e.target.value; apply(); } }) : null;
  ld.querySelector('.ld-list').prepend(...[h('div', { class: 'ld-tools' }, seg, find), chats.length ? null : emptyChats()].filter(Boolean));
  $('#main').replaceChildren(ld);
  apply();
}
const takePrefill = () => { const p = S.dmPrefill; S.dmPrefill = null; return p; };
const emptyChats = () => (!(S.status?.channel?.numbers || []).some((n) => n.status === 'open')
  ? emptyState('chats', 'WhatsApp is not linked yet', 'Your groups and people show up here once your number is linked.', h('a', { class: 'btn small primary', href: '#overview/whatsapp' }, 'Link WhatsApp on Overview'))
  : emptyState('chats', 'No chats yet', 'Groups appear once the linked number is in them.'));
/** The sections of a chat's page (072): rows on the page, each its own page (#chats/<id>/<section>) with a back link. */
const CHAT_SECTIONS = [
  { id: 'messages', icon: 'chats', c: 'c3', title: 'Messages', admin: true, help: 'chats.md#messages-and-memory', line: 'Who said what, with the 👍 / 👎 of each answer. Each look is recorded in Activity.' },
  { id: 'memory', icon: 'notes', c: 'c2', title: 'Memory', help: 'chats.md#messages-and-memory', line: 'What the agent remembers here: a running summary and notes.' },
  { id: 'group', icon: 'contacts', c: 'c4', title: 'WhatsApp group', admin: true, group: true, help: 'chats.md#whatsapp-group-tools', line: 'Changes happen in WhatsApp at once. Most need the agents’ number to be a group admin.' },
];
const hasSection = (s, c) => (!s.admin || can('admin')) && (!s.group || c.isGroup);
/** One chat's page (068, 072): a header (avatar, name, state, switch), why it stayed quiet, its agent, section rows
 *  (Messages, Memory, WhatsApp group, Activity), then the settings that save at once and the spending cap. */
function chatPage(c, { agents, models, us, quiet, refresh, setOn }) {
  if (!c) return h('div', { class: 'card' }, h('p', { class: 'small muted' }, 'This chat is gone.'));
  const enc = encodeURIComponent(c.id); const admin = can('admin');
  const root = h('div', {});
  const name = c.name || c.id;
  const go = (sid, at = 0) => { history.pushState(null, '', `#chats/${enc}${sid ? `/${sid}` : ''}`); draw(sid, at, true); };
  function draw(sid, at = 0, push = false) {
    const s = CHAT_SECTIONS.find((x) => x.id === sid && hasSection(x, c));
    root.replaceChildren(s ? h('div', { class: 'card ap-sec' },
      h('a', { class: 'sub-back', href: `#chats/${enc}`, onclick: (e) => { e.preventDefault(); go(''); } }, icon('back'), name),
      h('div', { class: 'sec-head' }, h('h2', { tabindex: '-1' }, s.title), helpLink(s.help)),
      h('p', { class: 'small muted sec-line' }, s.line),
      s.id === 'messages' ? messagesView(c, agents, takeSearch(c), at) : s.id === 'memory' ? memoryView(c) : groupView(c)) : home());
    document.title = `${s ? `${s.title} · ` : ''}${name} · Duniya`;
    if (push) { if (matchMedia('(max-width: 640px)').matches) window.scrollTo({ top: 0 }); root.querySelector('h2')?.focus({ preventScroll: true }); }
  }
  function home() {
    const savePrefs = (patch) => tryApi(async () => { Object.assign(c, await api('PUT', `/api/chats/${enc}/prefs`, patch)); refresh(c); return true; }, 'Saved');
    const agentLink = h('span', {});
    const drawLink = () => agentLink.replaceChildren(c.agent ? h('a', { href: `#agents/${encodeURIComponent(c.agent)}` }, `Open ${agents.find((x) => x.id === c.agent)?.name || 'agent'} ›`) : null);
    drawLink();
    const agentSel = h('select', { disabled: !admin, onchange: (e) => tryApi(async () => {
      // 062: choosing an agent for a chat that is Off switches it on too (one step instead of two)
      const agent = e.target.value; const r = await api('POST', '/api/chats/bind', { chat: c.id, agent: agent || null, enable: true }); c.agent = agent; drawLink();
      if (agent && !c.enabled && r.enabled) { c.enabled = true; c.ignored = 0; if (r.history) c.history = r.history; refreshStatus(); refresh(c); return toast(`${c.name || 'Chat'} is on: ${agents.find((x) => x.id === agent)?.name} answers there`); }
      refresh(c); toast(agent ? `${agents.find((x) => x.id === agent)?.name} answers in ${c.name || 'this chat'}` : 'No agent here now');
    }) }, h('option', { value: '' }, c.isGroup ? 'No agent' : 'Default for direct messages'), agents.filter((b) => !b.builtin).map((b) => h('option', { value: b.id, selected: c.agent === b.id }, b.name)));
    const extra = h('div', {}); // fallback editor, intro open here
    const open = async (el) => { extra.replaceChildren(await el); extra.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const sel = (label, opts, value, key) => field(label, h('select', { disabled: !admin, onchange: (e) => savePrefs({ [key]: e.target.value }) }, opts.map(([v, l]) => h('option', { value: v, selected: value === v }, l))));
    const tickPref = (label, on, patch) => h('label', { class: 'tick' }, h('input', { type: 'checkbox', checked: on, disabled: !admin, onchange: (e) => savePrefs(patch(e.target.checked)) }), ` ${label}`);
    const fbLine = h('span', { class: 'small muted' }, chatFallbackLine(c.fallback, models));
    const openFallback = (ch) => open(chatFallbackEditor(ch, models, { onClose: () => extra.replaceChildren(),
      onSaved: async (fallback) => { if (await savePrefs({ fallback })) { fbLine.textContent = chatFallbackLine(c.fallback, models); extra.replaceChildren(); } } }));
    const meta = [c.isGroup ? `Group · ${plural(c.size || 0, 'member')}` : c.phone ? `+${c.phone}` : 'Person', c.lastAt ? `last message ${ago(c.lastAt)} ago` : '', us?.chat?.[c.id] ? usageLine(us.chat[c.id]) : ''].filter(Boolean).join(' · ');
    const intro = !c.isGroup && admin && c.enabled && c.agent ? h('button', { class: 'btn small', type: 'button', onclick: () => open(introCard(c, { onClose: () => extra.replaceChildren(), onSent: () => extra.replaceChildren() })) }, c.introAt ? 'Send another intro…' : 'Send intro…') : null;
    // 072: section rows, their current value filled in when the chat's memory arrives
    const subs = {};
    const row = (id, title, ic, col, href, sub, onclick) => h('li', {}, h('a', { class: 'lrow', href, onclick },
      h('span', { class: `lmark ${col}`, 'aria-hidden': 'true' }, icon(ic)),
      h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, title), (subs[id] = h('span', { class: 'lrow-sub' }, sub))), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
    const firstSub = { messages: c.history?.state === 'loading' ? 'Loading recent messages from your phone…' : c.lastAt ? `Last message ${ago(c.lastAt)} ago` : 'Stored while the chat is on',
      memory: 'Summary and notes', group: 'Name, settings, invite link, members' };
    const rows = CHAT_SECTIONS.filter((s) => hasSection(s, c)).map((s) => row(s.id, s.title, s.icon, s.c, `#chats/${enc}/${s.id}`, firstSub[s.id], (e) => { e.preventDefault(); go(s.id); }));
    rows.push(row('activity', 'Activity', 'activity', 'c0', `#activity/chat=${enc}`, 'Everything that happened here, newest first'));
    api('GET', `/api/chats/${enc}/memory`).then((m) => {
      if (subs.messages && c.history?.state !== 'loading') subs.messages.textContent = [plural(m.messageCount, 'stored message'), c.lastAt ? `last ${ago(c.lastAt)} ago` : ''].filter(Boolean).join(' · ');
      subs.memory.textContent = [m.summary ? 'Summary' : 'No summary yet', plural(m.notes.length, 'note')].join(' · ');
    }).catch(() => {});
    return h('div', { class: 'card chat-page', 'data-chat': c.id },
      h('div', { class: 'ap-head' }, avatar(c.name || c.phone || c.id, c.id, `l${c.enabled ? '' : ' off'}`),
        h('div', { class: 'ap-title' }, h('h2', {}, name), h('div', { class: 'small muted' }, meta)),
        toggle(c.enabled, (v) => setOn(c, v), !admin, `${name} on`),
        intro ? menu(`More actions for ${name}`, intro) : null),
      c.waiting ? h('p', { class: 'small', style: 'color:var(--warn)' }, 'Waiting for the first message: it goes to the agent chosen here.') : null,
      !c.enabled ? h('p', { class: 'small muted' }, `Off: ignored, nothing stored${c.ignored ? ` (${plural(c.ignored, 'message')} since restart)` : ''}. Choosing an agent switches it on.`) : null,
      quiet.length ? h('div', { class: 'sblock' }, h('h3', {}, 'Why it stayed quiet'), quiet.slice(0, 3).map((q) => h('div', { class: 'quiet row spread' },
        h('span', { class: `small${q.reason === 'not_addressed' ? ' muted' : ''}`, style: q.reason === 'not_addressed' ? '' : 'color:var(--warn)', title: q.explain }, `${quietLine(q)} · ${q.explain}`), silenceFix(q, () => renderChats(), { onChats: true })))) : null,
      h('div', { class: 'sblock' }, field('Agent', agentSel), agentLink),
      h('div', { class: 'lgroup' }, h('ul', {}, rows)),
      h('div', { class: 'sblock' }, h('h3', {}, 'Settings'), h('div', { class: 'grid2' },
        field('Model', modelSelect(models, c.model, { withInherit: true, autoLabel: 'Auto (any provider)', disabled: !admin, onchange: (e) => savePrefs({ model: e.target.value }) }),
          h('div', { class: 'row', style: 'gap:6px;margin-top:6px' }, fbLine, h('button', { class: 'btn small', type: 'button', 'aria-label': `Model fallback for ${name}`, onclick: () => openFallback(c) }, admin ? 'Fallback…' : 'Fallback'))),
        sel('Activity log', [['inherit', 'Default'], ['off', 'Off'], ['minimal', 'Minimal'], ['normal', 'Normal'], ['verbose', 'Verbose']], c.logging || 'inherit', 'logging'),
        // 054: "Welcome new members" for this group: the agent setting, or always on / off here
        c.isGroup ? sel('Welcome new members', [['inherit', `As the agent (${agents.find((x) => x.id === c.agent)?.config?.welcome?.enabled ? 'on' : 'off'})`], ['on', 'On'], ['off', 'Off']], c.welcome || 'inherit', 'welcome') : null),
      // 044: hidden from the owner assistant / Ask box; per-group opt-out of the privacy notice (recorded)
      tickPref('Private to members (hidden from Ask and the owner assistant)', !!c.private, (v) => ({ private: v })),
      c.isGroup ? tickPref(`Privacy notice${c.noticePostedAt ? ` (posted ${ago(c.noticePostedAt)} ago)` : ''}`, !c.noticeOff, (v) => ({ noticeOff: !v })) : null),
      h('details', { class: 'sblock', ontoggle: async (e) => { const d = e.currentTarget; if (d.open && !d.dataset.loaded) { d.dataset.loaded = '1'; d.append(await capEditor('chat', c.id, models)); } } }, h('summary', {}, 'Spending cap')),
      extra);
  }
  const [, , sid, at] = location.hash.split('/');
  draw(S.msgSearch?.chat === c.id ? 'messages' : decodeURIComponent(sid || ''), Number(at) || 0);
  return root;
}
/** 070: arriving from Search messages (Find anything): the chat's Messages, filtered by the same words. */
const takeSearch = (c) => { const q = S.msgSearch?.chat === c.id ? S.msgSearch.q : ''; if (q) S.msgSearch = null; return q; };
/** #91: status of loading earlier messages from the phone for one chat row (no message content). */
function historyLine(c) {
  const hs = c.history;
  if (!hs) return null;
  if (hs.state === 'loading') return h('div', { class: 'small muted', role: 'status' }, h('span', { class: 'spinner' }), ' Loading recent messages from your phone…');
  if (hs.state === 'loaded') return h('div', { class: 'small muted', role: 'status' }, hs.loaded ? `Loaded ${hs.loaded} earlier message${hs.loaded === 1 ? '' : 's'}${hs.doneAt ? ` · ${ago(hs.doneAt)} ago` : ''}` : 'Your phone had no earlier messages for this chat');
  // 057: nothing to click — the server retries by itself (sooner when the phone comes online); the button is optional.
  const retry = hs.retryAt ? ` Will retry automatically${hs.retryAt > Date.now() + 60000 ? ` in about ${ago(Date.now() - (hs.retryAt - Date.now()))}` : ' shortly'}, sooner when your phone is online.` : '';
  if (hs.state === 'no_response') return h('div', { class: 'small muted', role: 'status' }, `Waiting for your phone to send recent messages.${retry || ' It did not answer after several tries.'}`);
  if (hs.state === 'no_anchor') return h('div', { class: 'small muted', role: 'status' }, 'No message from this chat has reached the server yet. Recent messages load by themselves after the next message.');
  return h('div', { class: 'small', role: 'status', style: 'color:var(--warn)' }, `Couldn’t ask your phone: ${hs.error || 'unknown error'}.${retry}`);
}
/** WhatsApp group tools for admins (026), the chat's *WhatsApp group* section (072): name, description, settings,
 *  invite link, members with admin badges. */
function groupView(c) {
  const enc = encodeURIComponent(c.id);
  const body = h('div', { class: 'wa-card' }, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Asking WhatsApp…'));
  const put = (patch, ok) => tryApi(() => api('PUT', `/api/chats/${enc}/whatsapp`, patch), ok);
  async function load() {
    let g;
    try { g = await api('GET', `/api/chats/${enc}/whatsapp`); } catch (e) {
      body.replaceChildren(h('div', { class: 'note warn' }, `Could not read this group from WhatsApp: ${e.message}. Check that the number is connected (Overview) and still in the group.`));
      return;
    }
    const meAdmin = g.participants.some((p) => p.admin) ? null : h('div', { class: 'note warn' }, 'No admins found for this group.');
    const subject = h('input', { value: g.subject, maxlength: 100, 'aria-label': 'Group name' });
    const desc = h('textarea', { value: g.description, maxlength: 2048, style: 'min-height:60px', 'aria-label': 'Group description' });
    const linkBox = h('div', {});
    const showLink = async () => {
      const r = await tryApi(() => api('GET', `/api/chats/${enc}/whatsapp/invite`));
      if (!r) return;
      linkBox.replaceChildren(r.link ? copyRow(r.link) : h('p', { class: 'small muted' }, 'WhatsApp did not return a link.'),
        h('button', { class: 'btn small danger', onclick: async () => {
          if (!await ask({ title: 'Reset the invite link?', text: 'Anyone with the old link can no longer join with it. A new link is created.', ok: 'Reset link', danger: true })) return;
          const n = await tryApi(() => api('POST', `/api/chats/${enc}/whatsapp/invite/revoke`), 'New invite link created');
          if (n) { linkBox.firstChild.replaceWith(copyRow(n.link)); }
        } }, 'Reset link'));
    };
    const setting = (key, label, hint) => h('div', { class: 'wa-setting' },
      toggle(!!g[key], async (on) => { if (await put({ [key]: on }, `${label}: ${on ? 'on' : 'off'}`)) g[key] = on; else load(); }, false, label),
      h('span', {}, h('b', {}, label), h('span', { class: 'small muted', style: 'display:block' }, hint)));
    const admins = g.participants.filter((p) => p.admin).length;
    body.replaceChildren(
      h('div', { class: 'row', style: 'gap:6px;margin:6px 0 10px' }, h('span', { class: 'pill' }, `${g.size} members`), h('span', { class: 'pill info' }, `${admins} admin${admins === 1 ? '' : 's'}`)),
      meAdmin,
      field('Group name', h('div', { class: 'row nowrap' }, subject, h('button', { class: 'btn small', onclick: async () => { if (await put({ subject: subject.value }, 'Group renamed')) g.subject = subject.value; } }, 'Save'))),
      field('Description', desc),
      h('div', { class: 'row', style: 'margin:6px 0 12px' }, h('button', { class: 'btn small', onclick: () => put({ description: desc.value }, 'Description saved') }, 'Save description')),
      h('div', { class: 'eyebrow', style: 'margin:8px 0 6px' }, 'Settings'),
      h('div', { class: 'wa-settings' },
        setting('announcement', 'Only admins send', 'Everyone else can read but not write.'),
        setting('locked', 'Only admins edit info', 'Name, picture and description.'),
        setting('joinApproval', 'Approve new members', 'People joining by link wait for an admin.')),
      h('div', { class: 'eyebrow', style: 'margin:14px 0 6px' }, 'Invite link'),
      linkBox, h('button', { class: 'btn small', onclick: (e) => { e.currentTarget.remove(); showLink(); } }, 'Show invite link'),
      h('details', { style: 'margin-top:14px' }, h('summary', { class: 'small', style: 'cursor:pointer' }, `Members (${g.participants.length})`),
        h('ul', { class: 'wa-members' }, g.participants.map((p) => h('li', {},
          h('span', {}, h('b', {}, whoLabel(p)), tagPill(p.tag), p.name && p.phone ? h('span', { class: 'small muted num' }, ` +${p.phone}`) : null),
          p.admin ? h('span', { class: 'pill ok' }, p.admin === 'superadmin' ? 'owner' : 'admin') : null)))));
  }
  load();
  return body;
}


/** The answer an agent message replies to: the nearest earlier message to the agent (else the nearest earlier one). */
function questionOf(rows, i) {
  const before = rows.slice(0, i).reverse().filter((m) => !m.fromAgent && rows[i].ts - m.ts < 30 * 60000);
  return before.find((m) => m.addressed) || before[0] || null;
}
/**
 * A chat's *Messages* (024, 072): newest at the bottom; each answer with its agent's avatar and colour and the same
 * 👍 / 👎 · Teach row as Review; search; older pages; the phone's earlier messages (#91). Opened at one answer
 * (`at`, from Review or Activity) it shows the messages around it, marked. Each look is recorded.
 */
function messagesView(c, agents, q0 = '', at = 0) {
  const enc = encodeURIComponent(c.id); const admin = can('admin');
  const log = h('div', { class: 'chatlog msgs' });
  const q = h('input', { type: 'search', value: q0, placeholder: 'Search the stored messages', 'aria-label': 'Search the stored messages of this chat' });
  let rows = []; let shown = '';
  const more = h('button', { class: 'btn small', type: 'button', onclick: () => load('older') }, 'Load older');
  const latest = h('button', { class: 'btn small hide', type: 'button', onclick: () => { at = 0; load(); } }, 'Show the latest');
  const agentOf = (id) => agents.find((b) => b.id === id)?.name || (id === 'owner-assistant' ? 'Owner assistant' : 'Agent');
  function bubble(m, i) {
    const text = highlight(m.text, searchWords(shown));
    if (!m.fromAgent) {
      return h('div', { class: `bubble agent${m.id === at ? ' hit' : ''}`, 'data-msg': m.id },
        h('div', { class: 'small msg-who' }, m.name || (m.sender ? `+${m.sender}` : 'someone'), m.tag ? ` (${m.tag})` : '', ` · ${time(m.ts)}`, m.addressed ? ' · to the agent' : ''),
        m.quoted ? h('div', { class: 'small msg-quote' }, m.quoted) : null, h('span', {}, text));
    }
    const name = agentOf(m.agent); const av = avatar(name, m.agent || 'agent', 's');
    return h('div', { class: `msg-ans ${[...av.classList].find((k) => /^c\d$/.test(k)) || ''}${m.id === at ? ' hit' : ''}`, 'data-msg': m.id },
      h('div', { class: 'small msg-who' }, av, m.agent && !m.agent.startsWith('owner') ? h('a', { href: `#agents/${encodeURIComponent(m.agent)}` }, name) : name, ` · ${time(m.ts)}`),
      h('div', { class: 'bubble ans' }, text),
      admin && m.rateable ? answerActions({ id: m.id, agent: m.agent, rating: m.rating, text: m.text, question: questionOf(rows, i) }) : null);
  }
  async function load(older) {
    const term = q.value.trim();
    const page = await tryApi(() => api('GET', `/api/chats/${enc}/messages?limit=50${older && rows[0] ? `&before=${rows[0].id}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}${at && !older && !term ? `&around=${at}` : ''}`));
    if (!page) return;
    shown = term;
    rows = older ? [...page.reverse(), ...rows] : page.reverse();
    log.replaceChildren(...(rows.length ? rows.map(bubble) : [h('p', { class: 'small muted' }, term ? 'No stored message matches.' : 'No stored messages for this chat yet.')]));
    more.classList.toggle('hide', page.length < (at && !older && !term ? 26 : 50));
    latest.classList.toggle('hide', !at || !!term);
    const hit = at && log.querySelector('.hit');
    if (hit) log.scrollTop = hit.offsetTop - log.clientHeight / 3; else if (!older) log.scrollTop = log.scrollHeight; // only the list scrolls
  }
  // #91: earlier messages from the phone; while it sends them the line follows (only on this page, only while loading)
  const hist = h('div', {}, historyLine(c));
  const histBtn = admin && c.enabled ? h('button', { class: 'btn small', type: 'button', disabled: c.history?.state === 'loading', onclick: () => tryApi(async () => { c.history = (await api('POST', `/api/chats/${enc}/history`, {})).status; showHist(); watch(); }) }, 'Load earlier from your phone') : null;
  const showHist = () => { hist.replaceChildren(historyLine(c) || ''); if (histBtn) histBtn.disabled = c.history?.state === 'loading'; };
  let watching = false;
  const watch = async () => {
    if (c.history?.state !== 'loading' || watching) return;
    watching = true;
    try {
      while (document.body.contains(hist)) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await api('GET', `/api/chats/${enc}/history`).catch(() => null);
        if (!r) break;
        c.history = r.status; showHist();
        if (r.status?.state !== 'loading') { load(); break; }
      }
    } finally { watching = false; }
  };
  setTimeout(watch, 0);
  load();
  return h('div', {},
    h('form', { class: 'row nowrap msg-find', onsubmit: (e) => { e.preventDefault(); at = 0; load(); } }, q, h('button', { class: 'btn small' }, 'Search')),
    h('div', { style: 'text-align:center' }, more), log, h('div', { style: 'text-align:center' }, latest),
    histBtn || c.history ? h('div', { class: 'sblock' }, hist, histBtn) : null);
}
/** A chat's *Memory* (072): the running summary and the notes the agent keeps here; rebuild or erase. */
function memoryView(c, box = h('div', {})) {
  const enc = encodeURIComponent(c.id); const admin = can('admin');
  box.replaceChildren(h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading…'));
  tryApi(() => api('GET', `/api/chats/${enc}/memory`)).then((m) => m && box.replaceChildren(
    h('div', { class: 'sblock' }, h('h3', {}, 'Running summary'), h('p', { class: 'small muted' }, m.updatedAt ? `Updated ${time(m.updatedAt)} · from ${plural(m.messageCount, 'stored message')}` : plural(m.messageCount, 'stored message')),
      m.summary ? h('pre', {}, m.summary) : h('p', { class: 'small muted' }, 'No summary yet. It starts once older messages pile up.')),
    h('div', { class: 'sblock' }, h('h3', {}, `Notes (${m.notes.length})`),
      m.notes.length ? h('ul', { class: 'notes' }, m.notes.map((n) => h('li', { style: 'flex-wrap:nowrap' }, h('span', { style: 'flex:1;min-width:0' }, n.text, h('span', { class: 'small muted', style: 'display:block' }, `${n.author || '?'} (${n.role || 'note'}) · ${time(n.ts)}`)),
        admin ? h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Delete note: ${n.text.slice(0, 40)}`, onclick: () => tryApi(async () => { await api('DELETE', `/api/notes/${n.id}`); memoryView(c, box); }, 'Note deleted') }, 'Delete') : null)))
        : h('p', { class: 'small muted' }, 'No notes. People add them in WhatsApp: “remember that …”.')),
    admin ? h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn', type: 'button', onclick: () => tryApi(async () => { await api('POST', `/api/chats/${enc}/memory/summarize`); memoryView(c, box); }, 'Summary rebuilt') }, 'Rebuild summary'),
      h('button', { class: 'btn danger', type: 'button', onclick: async () => (await ask({ title: `Erase the memory of “${c.name}”?`, text: 'All stored messages, the running summary and the notes of this chat are deleted. This cannot be undone.', ok: 'Erase memory', danger: true })) && tryApi(async () => { await api('DELETE', `/api/chats/${enc}/memory`); memoryView(c, box); }, 'Memory erased') }, 'Erase memory')) : null));
  return box;
}
