// Chats screen: on/off per chat, direct chats, history, WhatsApp settings and memory. Module of the panel (063).
import { $, S, ago, api, avatar, can, copyRow, emptyState, field, h, plural, refreshStatus, tagPill, time, toast, toggle, tryApi, whoLabel } from './core.js';
import { chatFallbackEditor, chatFallbackLine } from './fallback.js';
import { silenceFix } from './quiet.js';
import { loadModels, modelSelect, quietLine, usageLine } from './shared.js';
import { capAmount, capEditor, usageSummary } from './usage.js';
let chatsFilter = 'all';
let chatsQuery = ''; // 062: Find a chat
/** 049 (#92): set up a direct chat by phone number (or a contact) before the person writes. */
function addDirectChatCard(agents, { pre = null, onDone, onClose } = {}) {
  const numbers = (S.status?.channel?.numbers || []).length ? S.status.channel.numbers : [{ id: 'main', label: 'Main' }];
  const phone = h('input', { placeholder: '+41 79 123 45 67', inputmode: 'tel', autocomplete: 'off', value: pre?.phone ? `+${pre.phone}` : '', 'aria-label': 'Phone number with country code' });
  const who = h('div', { class: 'small muted', style: 'margin-top:4px;min-height:1.2em' }, pre?.name ? `Contact: ${pre.name}` : '');
  const search = h('input', { type: 'search', placeholder: 'Or search your contacts', 'aria-label': 'Search contacts' });
  const hits = h('div', { class: 'row', style: 'gap:6px;margin-top:6px' });
  let timer;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => {
    const q = search.value.trim(); if (!q) { hits.replaceChildren(); return; }
    const list = await api('GET', `/api/contacts?q=${encodeURIComponent(q)}`).catch(() => []);
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
  const form = h('form', { class: 'card', style: 'margin-top:14px', onsubmit: async (e) => {
    e.preventDefault();
    const r = await tryApi(() => api('POST', '/api/direct-chats', { phone: phone.value, number: number.value, agent: agent.value || undefined, enabled: on.checked, private: priv.checked }));
    if (!r) return;
    toast(r.warning ? `Chat ready. ${r.warning}` : `Chat with ${r.name} ready — waiting for the first message`);
    onDone?.(r);
  } },
  h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'Add a direct chat'), h('button', { type: 'button', class: 'btn small mut', onclick: () => onClose?.() }, 'Close')),
  h('p', { class: 'small muted' }, 'Set up a 1:1 chat before the person has written: choose the agent and settings now; their first message goes straight to it. Nothing is sent to them unless you send an intro.'),
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
export async function renderChats() {
  const [chats, agents, models, us, bud, quiet] = await Promise.all([api('GET', '/api/chats'), api('GET', '/api/agents'), loadModels().catch(() => ({ models: [] })), usageSummary(), api('GET', '/api/budget').catch(() => null), api('GET', '/api/silences?days=7').catch(() => ({ silences: [] }))]);
  const capOf = new Map((bud?.caps || []).filter((x) => x.scope === 'chat').map((x) => [x.id, x]));
  const openCap = async (c) => { memBox.replaceChildren(h('div', { class: 'card', style: 'margin-top:14px' }, h('h2', {}, `Spending cap · ${c.name || c.id}`), await capEditor('chat', c.id, models))); memBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const quietBy = new Map(); // #34: why agents stayed quiet, per chat (most frequent first)
  for (const q of quiet.silences) { if (!quietBy.has(q.chat)) quietBy.set(q.chat, []); quietBy.get(q.chat).push(q); }
  const memBox = h('div', {});
  const openFallback = (c) => {
    memBox.replaceChildren(chatFallbackEditor(c, models, {
      onClose: () => memBox.replaceChildren(),
      onSaved: async (fallback) => { const ok = await savePrefs(c, { fallback }); if (ok !== undefined) { memBox.replaceChildren(); draw(); } },
    }));
    memBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const multi = new Set(chats.map((c) => c.number)).size > 1;
  const openAdd = (pre = null) => { memBox.replaceChildren(addDirectChatCard(agents, { pre, onClose: () => memBox.replaceChildren(), onDone: () => { chatsFilter = 'people'; renderChats(); } })); memBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const openIntro = async (c) => { memBox.replaceChildren(await introCard(c, { onClose: () => memBox.replaceChildren(), onSent: () => { memBox.replaceChildren(); renderChats(); } })); memBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const savePrefs = (c, patch) => tryApi(async () => { Object.assign(c, await api('PUT', `/api/chats/${encodeURIComponent(c.id)}/prefs`, patch)); return true; }, 'Saved');
  const list = h('div', {});
  const draw = () => {
    const q = chatsQuery.trim().toLowerCase();
    const shown = chats.filter((c) => (chatsFilter === 'all' || (chatsFilter === 'groups' ? c.isGroup : !c.isGroup)) && (!q || `${c.name} ${c.phone || ''} ${agents.find((b) => b.id === c.agent)?.name || ''}`.toLowerCase().includes(q)));
    // 064: one row per chat — on/off, who, its agent and Messages & memory; everything else under "More settings", in place
    const agentName = (c) => agents.find((x) => x.id === c.agent)?.name;
    const setOn = (c, v) => tryApi(async () => {
      const r = await api('PUT', `/api/chats/${encodeURIComponent(c.id)}/prefs`, { enabled: v }); c.enabled = v; c.ignored = 0; if (r.history) c.history = r.history; draw(); watchHistory(c);
      toast(v ? `${c.name || 'Chat'} on — agents may answer here` : `${c.name || 'Chat'} off — agents ignore it`, { undo: () => setOn(c, !v) });
    });
    list.replaceChildren(shown.length ? h('div', { class: 'chat-list', role: 'list' }, shown.map((c) => h('div', { class: `chat-row${c.enabled ? '' : ' off'}`, role: 'listitem', 'data-jump': c.id },
      h('div', { class: 'chat-main' },
        toggle(c.enabled, (v) => setOn(c, v), !can('admin'), `${c.name || c.id} on`),
        h('div', { class: 'who-line' }, avatar(c.name || c.phone || c.id, c.id, c.enabled ? '' : 'off'), h('div', {},
          h('div', { class: 'chat-name' }, h('span', {}, c.name || c.id), h('span', { class: `pill ${c.isGroup ? 'info' : ''}` }, c.isGroup ? 'Group' : 'Person'), multi ? h('span', { class: 'pill raw' }, c.numberLabel) : null,
            c.waiting ? h('span', { class: 'pill warn', title: 'Set up before this person wrote; their first message goes to the agent chosen here' }, 'Waiting for the first message') : null),
          h('div', { class: 'small muted num' }, c.isGroup ? plural(c.size || 0, 'member') : c.phone ? `+${c.phone}` : '', c.lastAt ? ` · last message ${ago(c.lastAt)} ago` : '', us?.chat?.[c.id] ? ` · 30 days: ${usageLine(us.chat[c.id])}` : ''),
          !c.enabled ? h('div', { class: 'small', style: 'color:var(--warn)' }, `Off — ignored${c.ignored ? ` (${plural(c.ignored, 'message')} since restart)` : ''}`) : null,
          capOf.get(c.id) ? h('div', { class: 'small num', style: `color:var(--${capOf.get(c.id).state === 'ok' ? 'muted' : 'warn'})` }, `Cap: ${Math.round(capOf.get(c.id).used * 100)}% used · ${capAmount(capOf.get(c.id))}`) : null,
          (quietBy.get(c.id) || []).slice(0, 2).map((q) => h('div', { class: 'quiet' }, h('span', { class: `small${q.reason === 'not_addressed' ? ' muted' : ''}`, style: q.reason === 'not_addressed' ? '' : 'color:var(--warn)', title: `${q.explain} Last ${ago(q.lastTs)} ago.` }, quietLine(q)),
            silenceFix(q, () => renderChats(), { onChats: true }))),
          c.enabled ? histBox(c) : null)),
        h('div', { class: 'chat-agent btns' }, h('select', { style: 'flex:1;min-width:0', 'aria-label': `Agent for ${c.name || c.id}`, disabled: !can('admin'), onchange: (e) => tryApi(async () => {
          // 062: choosing an agent for a chat that is Off switches it on too (one step instead of two)
          const agent = e.target.value; const r = await api('POST', '/api/chats/bind', { chat: c.id, agent: agent || null, enable: true }); c.agent = agent;
          if (agent && !c.enabled && r.enabled) { c.enabled = true; c.ignored = 0; if (r.history) c.history = r.history; refreshStatus(); draw(); watchHistory(c); return toast(`${c.name || 'Chat'} is on: ${agentName(c)} answers there`); }
          toast(agent ? `${agentName(c)} answers in ${c.name || 'this chat'}` : 'No agent here now');
        }) },
          h('option', { value: '' }, c.isGroup ? '— no agent —' : '— default for direct messages —'), agents.filter((b) => !b.builtin).map((b) => h('option', { value: b.id, selected: c.agent === b.id }, b.name))),
        h('button', { class: 'btn small', onclick: () => renderMemory(c, memBox) }, can('admin') ? 'Messages & memory' : 'Memory'))),
      h('details', { class: 'chat-more' }, h('summary', {}, 'More settings', h('span', { class: 'muted' }, [c.model && c.model !== 'inherit' ? 'own model' : '', c.fallback && (c.fallback.mode !== 'inherit' || c.fallback.chain?.length) ? 'own fallback' : '', c.logging && c.logging !== 'inherit' ? `log: ${c.logging}` : '',
        c.private ? 'private' : '', c.isGroup && c.noticeOff ? 'no privacy notice' : ''].filter(Boolean).map((x) => ` · ${x}`).join(''))),
        h('div', { class: 'chat-set' },
          field('Model', modelSelect(models, c.model, { withInherit: true, autoLabel: 'Auto (any provider)', disabled: !can('admin'), onchange: (e) => savePrefs(c, { model: e.target.value }) }),
            // 042 / #65: per-chat fallback, edited in a card below (same picker and chain editor as agents)
            h('div', { class: 'btns', style: 'margin-top:6px' }, h('span', { class: 'small muted', style: 'flex:1;overflow-wrap:anywhere' }, chatFallbackLine(c.fallback, models)),
              h('button', { class: 'btn small', 'aria-label': `Model fallback for ${c.name || c.id}`, onclick: () => openFallback(c) }, can('admin') ? 'Fallback…' : 'Fallback'))),
          field('Activity log', h('select', { disabled: !can('admin'), onchange: (e) => savePrefs(c, { logging: e.target.value }) },
            [['inherit', 'Default'], ['off', 'Off'], ['minimal', 'Minimal'], ['normal', 'Normal'], ['verbose', 'Verbose']].map(([v, l]) => h('option', { value: v, selected: c.logging === v }, l)))),
          // 054: "Welcome new members" for this group: the agent setting, or always on / off here
          c.isGroup ? field('Welcome new members', h('select', { disabled: !can('admin'), title: 'Greet people who join this group (once per person), with the agent’s welcome text', onchange: (e) => savePrefs(c, { welcome: e.target.value }) },
            [['inherit', `As the agent (${agents.find((x) => x.id === c.agent)?.config?.welcome?.enabled ? 'on' : 'off'})`], ['on', 'On'], ['off', 'Off']].map(([v, l]) => h('option', { value: v, selected: (c.welcome || 'inherit') === v }, l)))) : null,
          // 044: hidden from the owner assistant / Ask box; per-group opt-out of the privacy notice (recorded)
          h('div', {}, h('label', { class: 'check', title: 'The agent keeps working here, but the owner assistant and the Ask box never see this chat.' },
            h('input', { type: 'checkbox', checked: !!c.private, disabled: !can('admin'), onchange: (e) => savePrefs(c, { private: e.target.checked }) }), 'Private to members'),
          c.isGroup ? h('label', { class: 'check', title: c.noticePostedAt ? `Privacy notice posted ${ago(c.noticePostedAt)} ago` : 'Posted once when this group is switched on' },
            h('input', { type: 'checkbox', checked: !c.noticeOff, disabled: !can('admin'), onchange: (e) => savePrefs(c, { noticeOff: !e.target.checked }) }), 'Privacy notice') : null),
          h('div', { class: 'btns', style: 'grid-column:1/-1' },
            h('button', { class: 'btn small', onclick: () => openCap(c) }, 'Spending cap'),
            c.enabled && can('admin') ? histBtn(c) : null,
            !c.isGroup && can('admin') && c.enabled && c.agent ? h('button', { class: 'btn small', onclick: () => openIntro(c) }, c.introAt ? 'Send another intro…' : 'Send intro…') : null)))))) : q ? emptyState('chats', `No chat matches “${chatsQuery}”`, 'Try part of the name, a phone number or an agent.')
      : !(S.status?.channel?.numbers || []).some((n) => n.status === 'open') ? emptyState('chats', 'WhatsApp is not linked yet', 'Your groups and people show up here once your number is linked.', h('a', { class: 'btn small primary', href: '#overview/whatsapp' }, 'Link WhatsApp on Overview'))
        : emptyState('chats', chatsFilter === 'people' ? 'No direct chats yet' : 'No chats yet', chatsFilter === 'people' ? 'People appear here after they message an agent number, or add one with “Add a direct chat”.' : 'Groups appear here once the linked number is in them.'));
  };
  // #91: what the phone sent when a chat was switched on / "Load recent messages" (polled while loading; only the
  // status line and the button are redrawn, so a select someone is using is left alone)
  const hist = new Map(); // chat id -> { box, btn }
  const histBox = (c) => { const box = h('div', {}, historyLine(c)); hist.set(c.id, { ...hist.get(c.id), box }); return box; };
  const histBtn = (c) => {
    const btn = h('button', { class: 'btn small', disabled: c.history?.state === 'loading', title: 'Optional: ask your phone now for the messages before the oldest stored one (the server also retries by itself)',
      onclick: () => tryApi(async () => { c.history = (await api('POST', `/api/chats/${encodeURIComponent(c.id)}/history`, {})).status; showHist(c); watchHistory(c); }) }, 'Load recent messages');
    hist.set(c.id, { ...hist.get(c.id), btn });
    return btn;
  };
  const showHist = (c) => { const x = hist.get(c.id); x?.box?.replaceChildren(historyLine(c) || ''); if (x?.btn) x.btn.disabled = c.history?.state === 'loading'; };
  const watching = new Set();
  const watchHistory = async (c) => {
    if (c.history?.state !== 'loading' || watching.has(c.id)) return;
    watching.add(c.id);
    try {
      while (S.tab === 'chats' && document.body.contains(list)) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await api('GET', `/api/chats/${encodeURIComponent(c.id)}/history`).catch(() => null);
        if (!r) break;
        c.history = r.status; showHist(c);
        if (r.status?.state !== 'loading') break;
      }
    } finally { watching.delete(c.id); }
  };
  for (const c of chats) watchHistory(c);
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, [['all', 'All'], ['groups', 'Groups'], ['people', 'People']].map(([v, l]) => h('button', { class: chatsFilter === v ? 'on' : '', 'aria-pressed': String(chatsFilter === v), onclick: (e) => {
    chatsFilter = v; seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b === e.target); b.setAttribute('aria-pressed', String(b === e.target)); }); draw();
  } }, l)));
  draw();
  const addBtn = can('admin') ? h('button', { class: 'btn small primary', onclick: () => openAdd() }, '+ Add a direct chat') : null;
  const find = chats.length > 6 ? h('input', { type: 'search', class: 'chat-find', value: chatsQuery, placeholder: 'Find a chat, person or agent', 'aria-label': 'Find a chat', oninput: (e) => { chatsQuery = e.target.value; draw(); } }) : null;
  $('#main').replaceChildren(h('div', { class: 'card' }, h('div', { class: 'chat-head' }, h('h2', {}, 'Chats'), seg, addBtn),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Agents only answer in chats that are On. A chat that is Off is ignored completely: nothing is stored (only the time of its newest message) and no model is called. Choosing an agent for a chat switches it on. (An agent set to answer “Anyone” also answers people whose chat is off.)'),
    find,
    chats.length ? h('label', { class: 'small muted row', style: 'gap:6px;margin:-4px 0 10px;flex-wrap:wrap' }, 'When a chat is switched on, load its last',
      h('select', { style: 'width:auto;flex:0 0 auto;min-width:96px', disabled: !can('admin'), 'aria-label': 'Messages to load when a chat is switched on', onchange: (e) => tryApi(async () => { await api('POST', '/api/settings', { historyLoadCount: Number(e.target.value) }); refreshStatus(); }, 'Saved') },
        [0, 25, 50, 100, 200].map((n) => h('option', { value: n, selected: Number(S.status?.settings?.historyLoadCount ?? 50) === n }, n ? String(n) : 'no'))),
      'messages from your phone') : null,
    list), memBox);
  if (S.dmPrefill && can('admin')) { const pre = S.dmPrefill; S.dmPrefill = null; openAdd(pre); }
}
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
/** WhatsApp group tools for admins (026): members with admin badges, invite link, name/description, settings. */
function whatsappCard(c) {
  const enc = encodeURIComponent(c.id);
  const body = h('div', {}, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Asking WhatsApp…'));
  const card = h('div', { class: 'card wa-card', style: 'margin-top:16px' }, h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'WhatsApp'), h('span', { class: 'eyebrow' }, 'Group')), body);
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
          if (!confirm('Reset the invite link? Anyone with the old link can no longer join with it.')) return;
          const n = await tryApi(() => api('POST', `/api/chats/${enc}/whatsapp/invite/revoke`), 'New invite link created');
          if (n) { linkBox.firstChild.replaceWith(copyRow(n.link)); }
        } }, 'Reset link'));
    };
    const setting = (key, label, hint) => h('div', { class: 'wa-setting' },
      toggle(!!g[key], async (on) => { if (await put({ [key]: on }, `${label}: ${on ? 'on' : 'off'}`)) g[key] = on; else load(); }),
      h('span', {}, h('b', {}, label), h('span', { class: 'small muted', style: 'display:block' }, hint)));
    const admins = g.participants.filter((p) => p.admin).length;
    body.replaceChildren(
      h('div', { class: 'row', style: 'gap:6px;margin:6px 0 10px' }, h('span', { class: 'pill' }, `${g.size} members`), h('span', { class: 'pill info' }, `${admins} admin${admins === 1 ? '' : 's'}`)),
      meAdmin,
      h('p', { class: 'small muted', style: 'margin-top:0' }, 'Changes here happen in WhatsApp right away and are recorded in Activity. The agent’s number must be a group admin for most of them.'),
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
  return card;
}

/** Stored messages of a chat (admins): newest at the bottom, search, load older. Viewing is logged. */
function messagesCard(c) {
  const enc = encodeURIComponent(c.id);
  const log = h('div', { class: 'chatlog', style: 'max-height:520px' });
  const q = h('input', { placeholder: 'Search the stored messages', style: 'max-width:320px' });
  let oldest = 0; let rows = [];
  const more = h('button', { class: 'btn small', onclick: () => load(true) }, 'Load older');
  const bubble = (m) => h('div', { class: `bubble ${m.fromAgent ? 'me' : 'agent'}` },
    h('div', { class: 'small', style: 'opacity:.75;margin-bottom:2px' }, m.fromAgent ? 'Agent' : (m.name || (m.sender ? `+${m.sender}` : 'someone')), m.tag ? ` (${m.tag})` : '', ` · ${time(m.ts)}`, m.addressed ? ' · to the agent' : ''),
    m.quoted ? h('div', { class: 'small', style: 'opacity:.75;border-left:2px solid currentColor;padding-left:6px;margin:2px 0 4px' }, m.quoted) : null, m.text);
  async function load(older) {
    const page = await tryApi(() => api('GET', `/api/chats/${enc}/messages?limit=50${older && oldest ? `&before=${oldest}` : ''}${q.value.trim() ? `&q=${encodeURIComponent(q.value.trim())}` : ''}`));
    if (!page) return;
    rows = older ? [...page.reverse(), ...rows] : page.reverse();
    oldest = rows[0]?.id || 0;
    log.replaceChildren(...(rows.length ? rows.map(bubble) : [h('p', { class: 'small muted' }, q.value.trim() ? 'No stored message matches.' : 'No stored messages for this chat.')]));
    more.classList.toggle('hide', page.length < 50);
    if (!older) log.scrollTop = log.scrollHeight;
  }
  const card = h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, `Messages · ${c.name}`), h('form', { class: 'row nowrap', style: 'flex:0 1 420px', onsubmit: (e) => { e.preventDefault(); load(false); } }, q, h('button', { class: 'btn small' }, 'Search'))),
    h('p', { class: 'small muted' }, 'Messages the agents have stored for context (groups always; direct chats only when an agent answered). Only admins and owners can read them, and each look is recorded in the activity log.'),
    h('div', { style: 'text-align:center' }, more), log);
  load(false);
  return card;
}

async function renderMemory(c, box) {
  const enc = encodeURIComponent(c.id);
  const m = await api('GET', `/api/chats/${enc}/memory`);
  box.replaceChildren(h('div', { class: 'card', style: 'margin-top:14px' },
    h('div', { class: 'row spread' }, h('h2', {}, `Memory · ${c.name}`), h('span', { class: 'pill' }, `${m.messageCount} stored messages`)),
    h('label', {}, m.updatedAt ? `Running summary (updated ${time(m.updatedAt)})` : 'Running summary'),
    h('pre', {}, m.summary || '(no summary yet — it starts once older messages accumulate)'),
    h('label', {}, `Notes (${m.notes.length})`),
    m.notes.length ? h('ul', { class: 'small' }, m.notes.map((n) => h('li', { style: 'margin:6px 0' }, n.text, h('span', { class: 'muted' }, ` — ${n.author || '?'} (${n.role || 'note'}), ${time(n.ts)} `),
      h('button', { class: 'btn small mut', onclick: () => tryApi(async () => { await api('DELETE', `/api/notes/${n.id}`); renderMemory(c, box); }, 'Note deleted') }, 'Delete')))) : h('p', { class: 'small muted' }, 'No notes.'),
    h('div', { class: 'row mut', style: 'margin-top:10px' },
      h('button', { class: 'btn', onclick: () => tryApi(async () => { await api('POST', `/api/chats/${enc}/memory/summarize`); renderMemory(c, box); }, 'Summary rebuilt') }, 'Rebuild summary'),
      h('button', { class: 'btn danger', onclick: () => confirm(`Erase all stored messages, the summary and notes for “${c.name}”?`) && tryApi(async () => { await api('DELETE', `/api/chats/${enc}/memory`); renderMemory(c, box); }, 'Memory erased') }, 'Erase memory'))));
  if (can('admin') && c.isGroup) box.append(whatsappCard(c));
  if (can('admin')) box.append(messagesCard(c));
  box.scrollIntoView({ behavior: 'smooth' });
}

