// Agents → one agent: the editor (instructions, chats, people, tools, schedules, quick answers, test console). Module of the panel (063).
import { aiHelper } from './ai-helper.js';
import { $, S, api, can, field, fieldError, h, lines, plural, splitLines, tagPill, time, toast, tryApi, whoLabel } from './core.js';
import { fallbackLine, fallbackPicker } from './fallback.js';
import { browseButton } from './registry.js';
import { loadModels, modelLabel, modelSelect, openAgent } from './shared.js';
import { ROLE_LABEL, globRe, markSaved, serverConfig, serverState, toolGrid, toolServiceEditor } from './tool-editor.js';
import { capEditor } from './usage.js';
export async function renderAgentEditor(id) {
  const [b, models, conns, locals, waTools] = await Promise.all([api('GET', `/api/agents/${encodeURIComponent(id)}`), loadModels().catch(() => ({ models: [] })), api('GET', `/api/agents/${encodeURIComponent(id)}/connections`).catch(() => []), api('GET', `/api/agents/${encodeURIComponent(id)}/local`).catch(() => []), api('GET', '/api/whatsapp/tools').catch(() => [])]);
  const mediaCaps = await api('GET', '/api/media').catch(() => null);
  const registry = can('admin') ? await api('GET', '/api/tool-services/registry/settings').catch(() => null) : null; // 052: Browse
  const c = structuredClone(b.config);
  const bi = !!b.builtin; // 059: the built-in owner assistant — fields about chats and people don't apply
  if (bi) waTools.splice(0, waTools.length, ...waTools.filter((t) => t.owner));
  const F = {};
  const inp = (key, attrs = {}) => (F[key] = h('input', { value: c[key] ?? '', ...attrs }));
  // General
  const modelSel = (F.model = modelSelect(models, c.model, { autoLabel: `Auto${models.resolvedDefault ? ` (now ${models.resolvedDefault})` : ''}` }));
  const fbPick = fallbackPicker(models, c.fallback, { what: 'agent' });
  F.dm = h('select', {}, [['members', 'Members of its groups + listed participants'], ['organizers', 'Organizers only'], ['anyone', 'Anyone — even people whose chat is off'], ['none', 'Nobody']].map(([v, l]) => h('option', { value: v, selected: c.dm === v }, l)));
  F.enabled = h('input', { type: 'checkbox', checked: c.enabled }); F.respondToMentions = h('input', { type: 'checkbox', checked: c.respondToMentions });
  F.memory = h('input', { type: 'checkbox', checked: c.memory?.enabled !== false });
  F.prompt = h('textarea', { class: 'prose', value: c.prompt });
  F.triggers = h('input', { value: (c.triggers || []).join(', ') });
  F.organizers = h('textarea', { value: lines(c.organizers), style: 'min-height:60px' });
  F.participants = h('textarea', { value: lines(c.participants), style: 'min-height:50px' });
  // People & roles (015): members of the agent's groups, tap a role. Organizers not in these groups stay in the text box.
  const orgSet = new Set(c.organizers || []);
  const peopleBox = h('div', {}, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading group members…'));
  const groupPhones = new Set();
  const syncOthers = () => { F.organizers.value = [...orgSet].filter((p) => !groupPhones.has(p)).join('\n'); };
  F.organizers.addEventListener('input', () => {
    for (const p of [...orgSet]) if (!groupPhones.has(p)) orgSet.delete(p);
    for (const l of splitLines(F.organizers.value)) { const d = l.replace(/\D/g, ''); if (d) orgSet.add(d); }
  });
  api('GET', `/api/agents/${encodeURIComponent(id)}/people`).then((pp) => {
    if (pp.suggested) for (const g of pp.groups) for (const m of g.members) if (m.suggested) orgSet.add(m.phone);
    for (const g of pp.groups) for (const m of g.members) if (m.phone) groupPhones.add(m.phone);
    syncOthers();
    const roleSeg = (m) => {
      if (!m.phone) return h('span', { class: 'small muted' }, 'number hidden by WhatsApp (roles need a number)');
      const seg = h('div', { class: 'seg' }, [['participant', 'Participant'], ['organizer', 'Organizer']].map(([v, l]) => h('button', {
        class: (orgSet.has(m.phone) ? 'organizer' : 'participant') === v ? 'on' : '', disabled: !can('admin'),
        onclick: (e) => { if (v === 'organizer') orgSet.add(m.phone); else orgSet.delete(m.phone); seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.target)); syncOthers(); dirty.classList.remove('hide'); } }, l)));
      return seg;
    };
    const dirty = h('div', { class: 'note warn hide' }, 'Roles changed — click Save at the bottom to apply.');
    peopleBox.replaceChildren(
      pp.suggested && pp.groups.some((g) => g.members.some((m) => m.suggested)) ? h('div', { class: 'note' }, 'No roles saved yet, so the group admins (ticked) are this agent’s organizers. Change anyone you like and Save to set roles yourself.') : null,
      dirty,
      pp.groups.length ? pp.groups.map((g) => h('div', { class: 'number-card' },
        h('div', { class: 'row spread' }, h('b', {}, g.name), h('span', { class: 'pill' }, `${g.members.length} members`)),
        g.error ? h('div', { class: 'small', style: 'color:var(--bad)' }, g.error) : null,
        h('table', { class: 'stack flat' }, h('tbody', {}, g.members.map((m) => h('tr', {},
          h('td', { 'data-label': '' }, h('b', {}, whoLabel(m)), tagPill(m.tag), m.admin ? h('span', { class: 'pill info', style: 'margin-left:6px' }, 'group admin') : null,
            h('div', { class: 'small muted' }, m.phone && m.name ? `+${m.phone}` : '')),
          h('td', { 'data-label': '', style: 'text-align:right' }, roleSeg(m)))))))) : h('p', { class: 'small muted' }, 'Bind this agent to a group on the Chats page to pick people from its members.'));
  }).catch((e) => peopleBox.replaceChildren(h('p', { class: 'small muted' }, `Could not load members: ${e.message}`)));
  // Tool services: the agent's own, and the global ones (035) it uses unless switched off here.
  const servers = Object.entries(c.mcpServers || {}).map(([key, sv]) => serverState(key, sv));
  const isOwner = S.user?.role === 'owner';
  const rules = { participant: [...(c.tools?.participant || [])], organizer: [...(c.tools?.organizer || [])], deny: [...(c.tools?.deny || [])] };
  const rulesBox = { participant: h('textarea', { value: lines(rules.participant), style: 'min-height:60px' }), organizer: h('textarea', { value: lines(rules.organizer), style: 'min-height:60px' }), deny: h('textarea', { value: lines(rules.deny), style: 'min-height:40px' }) };
  const glob = globRe;
  const allowed = (role, fq) => splitLines(rulesBox[role].value).some((r) => glob(r).test(fq));
  // WhatsApp actions (026): a tick per role. No whatsapp: rule for a role = the defaults; ticking writes explicit rules
  // (whatsapp:- = none). Organizer-only actions cannot be given to participants (enforced on the server too).
  const waBox = h('div', {});
  const waOn = (role, t) => {
    const mine = splitLines(rulesBox[role].value).filter((r) => r.startsWith('whatsapp:'));
    if (!mine.length) return role === 'organizer' || t.participantDefault;
    return mine.some((r) => glob(r).test(`whatsapp:${t.name}`));
  };
  function setWa(role, name, on) {
    const can = waTools.filter((t) => role === 'organizer' || !t.organizerOnly);
    const next = can.filter((t) => (t.name === name ? on : waOn(role, t))).map((t) => t.name);
    const rest = splitLines(rulesBox[role].value).filter((r) => !r.startsWith('whatsapp:'));
    const out = !next.length ? ['whatsapp:-'] : role === 'organizer' && next.length === can.length ? ['whatsapp:*'] : next.map((n) => `whatsapp:${n}`);
    rulesBox[role].value = [...rest, ...out].join('\n');
  }
  function drawWa() {
    if (!waTools.length) return waBox.replaceChildren();
    const tick = (role, t) => h('label', { class: 'inline wa-tick' }, h('input', { type: 'checkbox', checked: (role === 'organizer' || !t.organizerOnly) && waOn(role, t),
      disabled: role === 'participant' && t.organizerOnly, onchange: (e) => setWa(role, t.name, e.target.checked) }), ROLE_LABEL[role]);
    waBox.replaceChildren(h('ul', { class: 'wa-tools' }, waTools.map((t) => h('li', {},
      h('div', {}, h('b', {}, t.name.replace(/_/g, ' ')), t.organizerOnly ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'organizers only') : null),
      h('div', { class: 'small muted' }, t.description),
      h('div', { class: 'row', style: 'gap:4px;margin-top:4px' }, tick('participant', t), tick('organizer', t))))));
  }
  drawWa();
  const agentBase = `/api/agents/${encodeURIComponent(id)}`;
  /** Ticks in "Discover tools" write this agent's rules: key:* or key:tool lines. */
  const writeRules = (key, role, names, tools, explicitNone = false) => {
    const keep = splitLines(rulesBox[role].value).filter((r) => !r.startsWith(`${key}:`));
    const mine = names.length === tools.length ? [`${key}:*`] : !names.length && explicitNone ? [`${key}:-`] : names.map((n) => `${key}:${n}`);
    rulesBox[role].value = [...keep, ...mine].join('\n');
  };
  const agentRules = (s) => ({ has: (role, name) => allowed(role, `${s.key}:${name}`), write: (role, names, tools) => writeRules(s.key, role, names, tools) });
  const srvList = h('div', {});
  function drawServers() {
    srvList.replaceChildren(...servers.map((s, i) => toolServiceEditor(s, {
      base: agentBase, conns, locals, isOwner, save, saveHint: 'Save the agent to connect', rules: agentRules(s), redraw: drawServers,
      remove: () => { servers.splice(i, 1); drawServers(); },
    })));
  }
  drawServers();
  // Global tool services (035): on/off per agent; explicit rules of this agent win over the service's defaults.
  const globalOff = new Set(c.globalMcp?.disabled || []);
  const globalBox = h('div', {});
  const explicitFor = (key, role) => splitLines(rulesBox[role].value).filter((r) => r.startsWith(`${key}:`));
  function drawGlobals() {
    if (!b.globalTools?.length) return globalBox.replaceChildren(h('p', { class: 'small muted', style: 'margin:0' }, 'No global tool services yet. Add services every agent can use under ', h('a', { href: '#settings' }, 'Settings → Tool services'), '.'));
    globalBox.replaceChildren(...b.globalTools.map((g) => {
      const grid = h('div', {});
      const replaced = servers.some((sv) => sv.key === g.name);
      const custom = ['organizer', 'participant'].some((role) => explicitFor(g.name, role).length);
      const rules = {
        has: (role, name) => { const ex = explicitFor(g.name, role); return ex.length ? ex.some((r) => glob(r).test(`${g.name}:${name}`)) : (g.defaults?.[role] || []).some((x) => glob(x).test(name)); },
        write: (role, names, tools) => writeRules(g.name, role, names, tools, true), // none = "<name>:-", so the defaults no longer apply
      };
      const sum = (role) => { const d = g.defaults?.[role] || []; return !d.length ? 'none' : d.includes('*') ? 'all tools' : d.join(', '); };
      return h('div', { class: 'number-card' },
        h('div', { class: 'row spread nowrap' }, h('div', {}, h('b', {}, g.name), h('span', { class: 'pill', style: 'margin-left:6px' }, g.type === 'local' ? 'local' : 'remote')),
          replaced ? h('span', { class: 'pill warn' }, 'replaced by this agent’s own service')
            : h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !globalOff.has(g.name), disabled: !can('admin'), onchange: (e) => { if (e.target.checked) globalOff.delete(g.name); else globalOff.add(g.name); drawGlobals(); } }), 'Use in this agent')),
        h('div', { class: 'small muted', style: 'margin-top:4px' }, custom ? 'This agent has its own tool choices for this service (Advanced: tool rules).' : `Global defaults: organizers ${sum('organizer')}; participants ${sum('participant')}.`),
        !replaced && !globalOff.has(g.name) ? h('div', { class: 'row', style: 'margin-top:6px' },
          h('button', { class: 'btn small', onclick: async () => {
            const tools = await tryApi(() => api('POST', '/api/tool-services/discover', { server: g.name }));
            if (tools) toolGrid(grid, tools, rules);
          } }, 'Choose tools for this agent'),
          custom ? h('button', { class: 'btn small mut', onclick: () => { for (const role of ['organizer', 'participant']) rulesBox[role].value = splitLines(rulesBox[role].value).filter((r) => !r.startsWith(`${g.name}:`)).join('\n'); drawGlobals(); } }, 'Use the global defaults') : null) : null,
        grid);
    }));
  }
  drawGlobals();
  // Confirmation
  F.confirmOn = h('input', { type: 'checkbox', checked: !!c.confirm });
  F.cPreview = h('input', { value: c.confirm?.preview || '', placeholder: 'panduga:*_preview' });
  F.cTool = h('input', { value: c.confirm?.tool || '', placeholder: 'panduga:confirm' });
  F.cId = h('input', { value: c.confirm?.idField || 'confirm_id' });
  F.cTtl = h('input', { type: 'number', value: c.confirm?.ttlMinutes || 9, style: 'max-width:90px' });
  // Schedules
  const scheds = structuredClone(c.schedules || []);
  const schedBox = h('div', {});
  function drawScheds() {
    schedBox.replaceChildren(...scheds.map((s, i) => h('fieldset', {},
      h('legend', {}, s.id || `schedule ${i + 1}`),
      h('div', { class: 'row' }, h('input', { value: s.id || '', placeholder: 'id', style: 'max-width:140px', oninput: (e) => (s.id = e.target.value) }),
        h('input', { value: s.at || '08:00', placeholder: 'HH:MM', style: 'max-width:90px', oninput: (e) => (s.at = e.target.value) }),
        h('input', { value: s.days || 'daily', placeholder: 'daily or mon,wed', style: 'max-width:160px', oninput: (e) => (s.days = e.target.value) }),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: s.enabled !== false, onchange: (e) => (s.enabled = e.target.checked) }), 'on')),
      s.kind === 'weekly-summary' ? h('div', { class: 'small muted', style: 'margin-top:6px' }, 'The weekly summary: messages, replies and costs per agent, ignored chats, caps and what needs you. Counts only, never message contents.')
        : h('textarea', { class: 'prose', style: 'min-height:60px;margin-top:6px', 'aria-label': bi ? 'What to send you' : 'What to post', value: s.prompt || '', placeholder: bi ? 'What to send you, e.g. a morning brief: what happened overnight in my groups' : 'What to post, e.g. a short summary of today’s agenda', oninput: (e) => (s.prompt = e.target.value) }),
      h('div', { class: 'row', style: 'margin-top:6px' },
        h('button', { class: 'btn small', onclick: () => tryApi(async () => { const r = await api('POST', `/api/agents/${encodeURIComponent(id)}/schedules/${encodeURIComponent(s.id)}/run`); toast(r.length ? `Ran for ${plural(r.length, 'chat')}` : bi ? 'Nobody to send it to: link your WhatsApp under Settings → Owner assistant' : 'No chats bound'); }) }, 'Run now'),
        s.kind === 'weekly-summary' ? h('button', { class: 'btn small', onclick: () => tryApi(async () => { const r = await api('GET', '/api/owner-assistant/weekly-preview'); schedOut.replaceChildren(h('pre', { class: 'small' }, r.text)); }) }, 'Preview') : null,
        h('button', { class: 'btn small danger mut', onclick: () => { scheds.splice(i, 1); drawScheds(); } }, 'Remove')))));
  }
  const schedOut = h('div', {});
  drawScheds();
  F.alertsTo = h('input', { type: 'tel', inputmode: 'tel', value: c.alerts?.to ? `+${c.alerts.to}` : '', placeholder: '+41 79 123 45 67', 'aria-label': 'Alerts go to', disabled: S.user?.role !== 'owner' });
  F.timezone = h('input', { value: c.timezone || '', placeholder: 'Europe/Zurich (default)' });
  // Photos & voice (043)
  const md = { photos: true, documents: true, stickers: false, voiceNotes: true, voiceReply: 'never', ...(c.media || {}), createImages: { organizer: true, participant: false, ...(c.media?.createImages || {}) } };
  const mtick = (key, label, obj = md) => h('div', {}, h('label', { class: 'inline', style: 'min-height:40px' }, h('input', { type: 'checkbox', checked: !!obj[key], disabled: !can('admin'), onchange: (e) => { obj[key] = e.target.checked; } }), label));
  const vr = h('div', { class: 'seg', role: 'group', 'aria-label': 'Reply with voice' }, [['never', 'Never'], ['voice', 'To voice notes'], ['always', 'Always']].map(([v, l]) => h('button', {
    type: 'button', class: md.voiceReply === v ? 'on' : '', disabled: !can('admin'), onclick: (e) => { md.voiceReply = v; vr.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } }, l)));
  const ms = mediaCaps?.summary || {};
  const capHint = (ok, text) => (ok ? null : h('div', { class: 'small muted', style: 'margin:-2px 0 6px 2px' }, text, ' ', h('a', { href: '#models' }, 'Models')));
  const mediaBox = h('fieldset', {}, h('legend', {}, 'Photos & voice'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'What the agent does with photos and voice notes people send it (only in chats that are on and when it is addressed), and whether it answers with voice. Photos and voice notes go to the AI provider; only a short placeholder or the transcript stays in the chat history.'),
    mtick('photos', 'Look at photos'), capHint(ms.sees !== false, 'No connected model can see photos.'),
    mtick('documents', 'Read PDF files'), mtick('stickers', 'Look at stickers too'),
    mtick('voiceNotes', 'Listen to voice notes (turned into text)'), capHint(ms.hears, 'Nothing connected can listen yet: add an OpenAI key or OpenRouter, or switch on on-server listening in Settings.'),
    field('Reply with voice', vr, ms.speaks ? '“To voice notes”: only when they sent one. Voice replies are WhatsApp voice notes; the text is kept in the history. Replies with a confirm code or a link stay text.' : 'Nothing connected can speak yet (OpenAI key, OpenRouter, or on-server speaking in Settings).'),
    h('div', { style: 'margin-top:8px' }, h('label', {}, 'Who may ask for pictures'),
      mtick('organizer', 'Organizers', md.createImages), mtick('participant', 'Participants', md.createImages),
      capHint(ms.creates, 'No connected provider can create pictures yet (OpenAI key with image models, or OpenRouter).')));
  F.historySize = h('input', { type: 'number', value: c.historySize, style: 'max-width:110px' });
  F.maxTokens = h('input', { type: 'number', value: c.maxTokens, style: 'max-width:110px' });

  async function save() {
    const config = {
      name: F.name.value, description: F.description.value, enabled: F.enabled.checked, model: F.model.value, fallback: fbPick.value(), prompt: F.prompt.value,
      triggers: splitLines(F.triggers.value), respondToMentions: F.respondToMentions.checked, dm: F.dm.value,
      organizers: [...orgSet], participants: splitLines(F.participants.value), timezone: F.timezone.value.trim(),
      historySize: Number(F.historySize.value), maxTokens: Number(F.maxTokens.value), memory: { enabled: F.memory.checked },
      mcpServers: Object.fromEntries(servers.filter((s) => s.key).map((s) => [s.key, serverConfig(s)])), globalMcp: { disabled: [...globalOff] },
      tools: { participant: splitLines(rulesBox.participant.value), organizer: splitLines(rulesBox.organizer.value), deny: splitLines(rulesBox.deny.value) },
      confirm: F.confirmOn.checked ? { preview: F.cPreview.value.trim(), tool: F.cTool.value.trim(), idField: F.cId.value.trim(), ttlMinutes: Number(F.cTtl.value) } : null,
      schedules: scheds,
      media: md, ...quickBox.value(), ...(bi ? { alerts: { to: F.alertsTo.value } } : {}),
    };
    try {
      const r = await api('PUT', `/api/agents/${encodeURIComponent(id)}`, config);
      toast(r.warnings?.length ? `Saved — ${r.warnings.join('; ')}` : 'Saved');
      for (const sv of servers) markSaved(sv);
      return true;
    } catch (e) { return fieldError(e, F); }
  }

  // Test console — "Test as…" (#37): a role and a chat; shows the tools that role gets. Never sends to WhatsApp.
  const log = h('div', { class: 'chatlog' });
  const role = h('select', { 'aria-label': 'Test as role', onchange: () => { loadTools(); } }, h('option', { value: 'participant' }, 'a participant'), h('option', { value: 'organizer' }, 'an organizer'));
  const testChat = h('select', { 'aria-label': 'Test in chat', onchange: () => chatHint() }, h('option', { value: 'new' }, 'a new direct chat'));
  const chatInfo = new Map();
  const hintBox = h('div', {});
  const chatHint = () => {
    const ci = chatInfo.get(testChat.value);
    hintBox.replaceChildren(ci && !ci.enabled ? h('div', { class: 'note warn' }, `“${ci.name}” is Off in Chats, so in WhatsApp the agent stays silent there. The test still answers, using that chat’s memory.`) : null);
  };
  api('GET', '/api/chats').then((all) => {
    for (const ch of all.filter((x) => (b.config.chats || []).includes(x.id))) {
      chatInfo.set(ch.id, ch);
      testChat.append(h('option', { value: ch.id }, `${ch.isGroup ? 'group' : 'chat'}: ${ch.name || ch.id}`));
    }
  }).catch(() => {});
  const toolsBox = h('details', { class: 'small' }, h('summary', { style: 'cursor:pointer' }, 'Tools for this role…'));
  async function loadTools() {
    const r0 = role.value;
    toolsBox.replaceChildren(h('summary', { style: 'cursor:pointer' }, h('span', { class: 'spinner' }), ' Loading tools…'));
    const r = await api('GET', `/api/agents/${encodeURIComponent(id)}/test-tools?role=${r0}`).catch((x) => ({ error: x.message }));
    if (role.value !== r0) return; // changed meanwhile
    const who = r0 === 'organizer' ? 'organizers' : 'participants';
    toolsBox.replaceChildren(h('summary', { style: 'cursor:pointer' }, r.error ? `Tools for ${who}: could not load` : `Tools ${who} get (${r.count})`),
      r.error ? h('div', { class: 'note bad' }, r.error) : null,
      (r.errors || []).map((x) => h('div', { class: 'note warn' }, `A tool service did not answer: ${x}`)),
      r.services?.length ? r.services.map((sv) => h('div', { style: 'margin-top:8px' }, h('b', {}, sv.name), sv.global ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'global') : null,
        h('ul', { class: 'toolset' }, sv.tools.map((t) => h('li', {}, h('code', {}, t.name), t.description && t.description !== t.name ? h('span', { class: 'muted' }, ` — ${t.description}`) : null)))))
        : r.error ? null : h('p', { class: 'muted' }, `No tools: ${who} only get answers from the instructions and memory.`),
      h('p', { class: 'muted', style: 'margin-bottom:0' }, 'WhatsApp actions are not carried out here: the test shows what the agent would do.'));
  }
  if (!bi) loadTools();
  const input = h('input', { placeholder: 'Ask the agent something…' });
  const testForm = h('form', { class: 'row mut', onsubmit: async (e) => {
    e.preventDefault(); const text = input.value.trim(); if (!text) return;
    const as = role.value === 'organizer' ? 'organizer' : 'participant'; const where = testChat.value;
    log.append(h('div', { class: 'bubble me', title: `as ${as}` }, text)); input.value = '';
    const wait = h('div', { class: 'bubble agent muted' }, '…'); log.append(wait); log.scrollTop = 1e9;
    try {
      const r = await api('POST', `/api/agents/${encodeURIComponent(id)}/test`, { text, role: as, chat: where });
      wait.textContent = r.reply || '(no reply)'; wait.classList.remove('muted'); if (r.model) wait.title = `${r.answeredBy || r.model} · as ${as}`;
      // 054: which path answered — a quick reply, the FAQ (no AI, no tokens) or the model
      const path = r.path === 'quick' ? `${r.answeredBy || 'Quick reply'} · no AI` : r.path === 'faq' ? 'FAQ answer · no AI' : r.path === 'model' ? `Model${r.model ? ` · ${modelLabel(r.answeredBy && r.answeredBy.includes(':') ? r.answeredBy : r.model, models)}` : ''}` : '';
      if (path) wait.after(h('div', { class: 'small muted test-path', style: 'align-self:flex-start;margin:-2px 0 4px 4px' }, path.charAt(0).toUpperCase() + path.slice(1)));
      const fbl = fallbackLine(r.fallback); // 042: which model really answered, and why it switched
      if (fbl) wait.after(h('div', { class: 'small muted', style: 'align-self:flex-start;margin:-2px 0 4px 4px' }, `${fbl}.`));
    } catch (x) { wait.textContent = `Error: ${x.message}`; }
    log.scrollTop = 1e9;
  } }, input, h('button', { class: 'btn' }, 'Send'));
  const testAs = h('div', { class: 'row mut' }, h('label', { class: 'small', style: 'flex:0 0 auto;margin:0' }, 'Test as'), role, h('label', { class: 'small', style: 'flex:0 0 auto;margin:0' }, 'in'), testChat);

  const quickBox = quickAnswersEditor(c, b);
  // Shared memory (#8): notes the agent keeps across all its chats; organizers save them from WhatsApp.
  const sharedMemBox = h('fieldset', {}, h('legend', {}, 'Shared memory'));
  const loadSharedMem = async () => {
    const { notes } = await api('GET', `/api/agents/${encodeURIComponent(id)}/memory`).catch(() => ({ notes: [] }));
    sharedMemBox.replaceChildren(h('legend', {}, `Shared memory (${notes.length})`),
      h('p', { class: 'small muted', style: 'margin-top:0' }, 'Notes this agent knows in every chat. Organizers add them in WhatsApp, e.g. “remember for all groups: the pickup point is the north gate”. Notes of a single chat are under Chats.'),
      notes.length ? h('ul', { class: 'small' }, notes.map((n) => h('li', { style: 'margin:6px 0' }, n.text, h('span', { class: 'muted' }, ` — ${n.author || '?'}, ${time(n.ts)} `),
        can('admin') ? h('button', { class: 'btn small mut', onclick: () => tryApi(async () => { await api('DELETE', `/api/notes/${n.id}`); loadSharedMem(); }, 'Note deleted') }, 'Delete') : null))) : h('p', { class: 'small muted' }, 'No shared notes yet.'));
  };
  if (!bi) loadSharedMem(); // 059: the owner assistant's notes are per user (private), not shared notes
  $('#main').replaceChildren(
    h('div', { class: 'row spread editor-bar', style: 'margin-bottom:12px' }, h('button', { class: 'btn', onclick: () => { location.hash = 'agents'; } }, '← All agents'),
      h('div', { class: 'row actions' },
        h('a', { class: 'btn phone-only', href: '#test-console', onclick: (e) => { e.preventDefault(); $('#test-console')?.scrollIntoView({ behavior: 'smooth' }); } }, 'Test ↓'),
        h('a', { class: 'btn', href: `/api/agents/${encodeURIComponent(id)}/export`, download: `${id}.agent.json` }, 'Export'),
        bi ? null : h('button', { class: 'btn mut', onclick: async () => { const r = await tryApi(() => api('POST', `/api/agents/${encodeURIComponent(id)}/duplicate`), 'Duplicated'); if (r) openAgent(r.id); } }, 'Duplicate'),
        bi ? null : h('button', { class: 'btn danger mut', onclick: async () => { if (confirm(`Delete “${c.name}”? Its group bindings are removed; chat memory stays until erased.`) && await tryApi(() => api('DELETE', `/api/agents/${encodeURIComponent(id)}`), 'Deleted')) { location.hash = 'agents'; } } }, 'Delete'),
        h('button', { class: 'btn primary mut', onclick: save }, 'Save'))),
    can('admin') ? await aiHelper({ agentId: id, title: [h('span', { class: 'ai-chip' }, 'AI'), 'Change this agent with AI'], applyLabel: 'Apply & save',
      placeholder: 'What should change? e.g. “Make the replies shorter and friendlier”, “Let participants also see the shopping list”, “Make Anu and Ravi organizers”, “Post a menu reminder every Saturday at 9”.',
      onApply: async (r) => { const patch = Object.fromEntries(r.changes.map((ch) => [ch.field, ch.after])); if (await tryApi(() => api('PUT', `/api/agents/${encodeURIComponent(id)}`, patch), 'Saved')) renderAgentEditor(id); } }) : null,
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));align-items:start' },
      h('div', { class: 'card' },
        b.needs.length ? h('div', { class: 'note warn' }, `Set these in Settings → Secrets: ${b.needs.join(', ')}`) : null,
        h('fieldset', {}, h('legend', {}, 'General'),
          field('Name', inp('name')), field('Description', inp('description')),
          bi ? h('div', { class: 'note', style: 'margin-top:8px' }, 'Built in: it answers linked panel users in their own WhatsApp chat and in the Ask box on Overview (link your number under ', h('a', { href: '#settings' }, 'Settings → Owner assistant'), '). Owners and admins get the organizer tools, viewers the participant tools. Its built-in instructions, permissions and confirm codes stay in code; what you set here is added.') : null,
          h('div', { class: 'row', style: 'margin-top:8px' }, bi ? null : h('label', { class: 'inline' }, F.enabled, 'Enabled'), h('label', { class: 'inline' }, F.memory, bi ? 'Memory (notes it saves when asked)' : 'Group memory'), bi ? null : h('label', { class: 'inline' }, F.respondToMentions, 'Reply when @mentioned')),
          field('Model', modelSel, models.problem || 'Auto uses the default model set under Models.'),
          field('When the model is unavailable', fbPick.el, 'Usage limit, outage or expired sign-in: answer with another model instead of failing. Refused requests never switch, and tools never run twice.'),
          bi ? null : field('Triggers', F.triggers, 'A message containing one of these words (anywhere, as a whole word) wakes the agent, e.g. mochi or !panduga'),
          bi ? null : field('Who may message it directly', F.dm)),
        h('fieldset', {}, h('legend', {}, bi ? 'Character' : 'Instructions'), bi ? h('p', { class: 'small muted', style: 'margin-top:0' }, 'Tone, language and habits, e.g. “Answer in English, short; call me Vik; start mornings with the weather in Aigle.” Added to the built-in instructions; it never widens what it may do.') : null, F.prompt),
        bi ? null : quickBox.el,
        bi ? null : sharedMemBox,
        bi ? null : h('fieldset', {}, h('legend', {}, 'People & roles'),
          h('p', { class: 'small muted', style: 'margin-top:0' }, 'Organizers can use organizer tools and confirm changes. Everyone else in the agent’s groups is a participant.'),
          peopleBox,
          h('details', { style: 'margin-top:8px' }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'People outside these groups'),
            field('More organizers (phone numbers with country code, one per line)', F.organizers),
            field('Extra participants allowed to message the agent directly', F.participants))),
        h('fieldset', {}, h('legend', {}, 'Tool services (MCP)'),
          h('p', { class: 'small muted', style: 'margin-top:0' }, 'Enter the service URL and click Check: services that support sign-in (OAuth) get a Connect button; others use a token stored under Secrets, like ${MY_TOKEN}. Then discover tools and tick what each role may use.'),
          srvList, h('div', { class: 'row' }, browseButton({ target: id, targetName: c.name || id, onAdded: () => renderAgentEditor(id) }, registry),
            h('button', { class: 'btn small mut', onclick: () => { servers.push(serverState('', {})); drawServers(); } }, '+ Add tool service')),
          registry?.enabled !== false && can('admin') ? h('p', { class: 'small muted', style: 'margin:4px 0 0' }, 'Adding from Browse saves to this agent right away: save other changes on this page first.') : null,
          h('h3', { style: 'margin:14px 0 6px' }, 'Global tool services'), globalBox,
          h('details', { style: 'margin-top:10px' }, h('summary', { class: 'small muted' }, 'Advanced: tool rules'),
            field('Participant rules', rulesBox.participant), field('Organizer rules', rulesBox.organizer), field('Never allowed', rulesBox.deny))),
        waTools.length ? h('fieldset', {}, h('legend', {}, 'WhatsApp actions'),
          bi ? h('p', { class: 'small muted', style: 'margin-top:0' }, 'What it may do in WhatsApp besides answering (owners & admins = organizer, viewers = participant). In your own chat it acts right away; anything sent into another chat waits for your “confirm CODE”. Group administration stays with the admin tools.') : h('p', { class: 'small muted', style: 'margin-top:0' }, 'What the agent may do in WhatsApp besides answering: send pictures and files, react, post polls, manage the group. Actions marked “organizers only” happen right away when an organizer asks — no confirm code — so give the agent’s number group-admin rights only where you want that. Every action is recorded in Activity.'),
          h('details', {}, h('summary', { class: 'small', style: 'cursor:pointer;min-height:36px' }, `Choose actions per role (${waTools.length})`), waBox)) : null,
        mediaBox,
        bi ? null : h('fieldset', {}, h('legend', {}, 'Changes need confirmation'),
          h('label', { class: 'inline' }, F.confirmOn, 'Hold changes until an organizer replies “confirm CODE”'),
          h('div', { class: 'row' }, field('Preview tools', F.cPreview), field('Confirm tool', F.cTool)),
          h('div', { class: 'row' }, field('Confirmation id field', F.cId), field('Valid for (minutes)', F.cTtl))),
        bi ? h('fieldset', { id: 'alerts' }, h('legend', {}, 'Alerts'),
          h('p', { class: 'small muted', style: 'margin-top:0' }, 'Spending-cap, model-provider and update alerts are sent as they happen to this WhatsApp number. Without a number they are only written to Activity.'),
          field('Alerts go to', F.alertsTo, S.user?.role === 'owner' ? 'With country code. Save to apply.' : 'Only the owner can change this.')) : null,
        h('fieldset', {}, h('legend', {}, 'Monthly spending cap'), await capEditor('agent', id, models)),
        h('fieldset', {}, h('legend', {}, bi ? 'Scheduled messages to you' : 'Scheduled posts'), bi ? h('p', { class: 'small muted', style: 'margin-top:0' }, 'Sent to every linked owner and admin in their own chat (with nobody linked, the weekly summary goes to the Alerts number). They run even while agents are paused.') : null, schedBox, schedOut, h('button', { class: 'btn small mut', onclick: () => { scheds.push({ id: `s${scheds.length + 1}`, at: '08:00', days: 'daily', prompt: '', chats: 'all', enabled: true }); drawScheds(); } }, '+ Add schedule')),
        h('fieldset', {}, h('legend', {}, 'Advanced'),
          field('Timezone', F.timezone), h('div', { class: 'row' }, field('Recent messages in context', F.historySize), field('Max reply tokens', F.maxTokens))),
        h('div', { class: 'row mut' }, h('button', { class: 'btn primary', onclick: save }, 'Save'))),
      bi ? h('div', { class: 'card', id: 'test-console' }, h('h2', {}, 'Try it'), h('p', { class: 'small muted' }, 'Ask it in the Ask box on ', h('a', { href: '#overview' }, 'Overview'), ' or in your WhatsApp chat with an agent number; it uses what you saved here.'))
        : h('div', { class: 'card', id: 'test-console', style: 'position:sticky;top:110px;scroll-margin-top:110px' }, h('h2', {}, 'Test console'),
          h('p', { class: 'small muted' }, 'Uses real tools and the saved settings; nothing is posted to WhatsApp. Pick a role and a chat to see what each person would get.'),
          testAs, hintBox, toolsBox, log, testForm)));
  // Deep links: #agents/<id>/test, /triggers, /dm (first-run checklist, quiet reasons)
  const sub = location.hash.split('/')[2];
  const target = { test: $('#test-console'), triggers: F.triggers, dm: F.dm }[sub];
  if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (sub !== 'test') target.focus({ preventScroll: true }); else input.focus({ preventScroll: true }); }
}

/**
 * 054: "Quick replies, welcome & FAQ" — built-in answers without AI. Rows to add / edit / remove, a live preview with
 * sample values, phone-friendly (every row stacks). value() returns { quickReplies, help, welcome, faq } for save().
 */
function quickAnswersEditor(c, b) {
  const ro = !can('admin');
  const qr = structuredClone(c.quickReplies || []);
  const faq = { items: [], strictness: 'normal', wholeGroup: false, ...structuredClone(c.faq || {}) };
  const wel = { enabled: false, text: '', rules: '', ...structuredClone(c.welcome || {}) };
  const sample = { name: 'Anu', group: 'your group', date: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '') };
  const fill = (t, v) => String(t || '').replace(/\{(name|group|date|rules)\}/g, (m, k) => (v[k] === undefined ? m : v[k])).trim();
  const preview = (text) => h('div', { class: 'qa-preview small' }, h('span', { class: 'eyebrow' }, 'Preview'), h('div', {}, fill(text, sample) || '—'));
  const help = h('input', { type: 'checkbox', checked: !!c.help, disabled: ro });
  const qrBox = h('div', { class: 'qa-rows' });
  function drawQr() {
    qrBox.replaceChildren(...qr.map((q, i) => {
      const prev = h('div', {}, preview(q.text));
      const who = h('select', { disabled: ro, 'aria-label': 'Who may use it', onchange: (e) => { q.who = e.target.value; } },
        [['everyone', 'Everyone'], ['organizers', 'Organizers only']].map(([v, l]) => h('option', { value: v, selected: (q.who || 'everyone') === v }, l)));
      return h('div', { class: 'qa-row' },
        h('div', { class: 'row' }, h('input', { value: q.command || '', placeholder: '!rides', 'aria-label': 'Command', class: 'mono', style: 'max-width:160px', disabled: ro, oninput: (e) => { q.command = e.target.value.trim(); } }), who,
          ro ? null : h('button', { type: 'button', class: 'btn small danger mut', onclick: () => { qr.splice(i, 1); drawQr(); } }, 'Remove')),
        h('textarea', { class: 'prose', style: 'min-height:60px;margin-top:6px', value: q.text || '', disabled: ro, 'aria-label': 'Answer', placeholder: 'The answer, e.g. Rides this week: Mon Anu, Tue Ravi… Placeholders: {name} {group} {date}',
          oninput: (e) => { q.text = e.target.value; prev.replaceChildren(preview(q.text)); } }), prev);
    }), qr.length ? '' : h('p', { class: 'small muted' }, 'No quick replies yet.'));
  }
  drawQr();
  // Welcome
  const welOn = h('input', { type: 'checkbox', checked: !!wel.enabled, disabled: ro, onchange: (e) => { wel.enabled = e.target.checked; } });
  const welPrev = h('div', {});
  const drawWelPrev = () => { const t = wel.text || 'Welcome {name} to {group}! 👋'; welPrev.replaceChildren(preview(fill(wel.rules && !t.includes('{rules}') ? `${t}\n\n{rules}` : t, { ...sample, name: '@Mia', rules: wel.rules }))); };
  const welText = h('textarea', { class: 'prose', style: 'min-height:56px', 'aria-label': 'Welcome text', value: wel.text, disabled: ro, placeholder: 'Welcome {name} to {group}! 👋', oninput: (e) => { wel.text = e.target.value; drawWelPrev(); } });
  const welRules = h('textarea', { class: 'prose', style: 'min-height:56px', 'aria-label': 'House rules', value: wel.rules, disabled: ro, placeholder: 'Optional, e.g. Be kind. Rides are posted on Sundays.', oninput: (e) => { wel.rules = e.target.value; drawWelPrev(); } });
  drawWelPrev();
  // FAQ
  const faqBox = h('div', { class: 'qa-rows' });
  function drawFaq() {
    faqBox.replaceChildren(...faq.items.map((it, i) => {
      const prev = h('div', {}, preview(it.answer));
      return h('div', { class: 'qa-row' },
        field('Questions (one way of asking per line)', h('textarea', { class: 'prose', style: 'min-height:50px', value: (it.questions || []).join('\n'), disabled: ro, placeholder: 'When does the bus leave?', oninput: (e) => { it.questions = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); } })),
        field('Keywords (optional, comma separated)', h('input', { value: (it.keywords || []).join(', '), disabled: ro, placeholder: 'bus, departure', oninput: (e) => { it.keywords = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); } })),
        field('Answer', h('textarea', { class: 'prose', style: 'min-height:56px', value: it.answer || '', disabled: ro, oninput: (e) => { it.answer = e.target.value; prev.replaceChildren(preview(it.answer)); } })),
        prev, ro ? null : h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { type: 'button', class: 'btn small danger mut', onclick: () => { faq.items.splice(i, 1); drawFaq(); } }, 'Remove')));
    }), faq.items.length ? '' : h('p', { class: 'small muted' }, 'No questions yet.'));
  }
  drawFaq();
  const strict = h('div', { class: 'seg', role: 'group', 'aria-label': 'How closely a message must match' }, [['normal', 'Normal'], ['strict', 'Strict']].map(([v, l]) => h('button', {
    type: 'button', class: faq.strictness === v ? 'on' : '', disabled: ro, onclick: (e) => { faq.strictness = v; strict.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } }, l)));
  const whole = h('input', { type: 'checkbox', checked: !!faq.wholeGroup, disabled: ro, onchange: (e) => { faq.wholeGroup = e.target.checked; } });
  const el = h('fieldset', { id: 'quick-answers' }, h('legend', {}, 'Quick replies, welcome & FAQ'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Answered instantly from text you write: no AI, no tokens. Placeholders: {name} (who asked), {group}, {date}. Test them in the test console.'),
    h('h3', { class: 'qa-h' }, 'Quick replies'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'A command as the whole message or its first word (any case), e.g. !rides — no trigger needed.'),
    qrBox, ro ? null : h('button', { type: 'button', class: 'btn small mut', onclick: () => { qr.push({ command: '', text: '', who: 'everyone' }); drawQr(); } }, '+ Add quick reply'),
    h('div', { style: 'margin-top:8px' }, h('label', { class: 'inline' }, help, '“!help” lists these commands and the triggers')),
    h('h3', { class: 'qa-h' }, 'Welcome new members'),
    h('label', { class: 'inline' }, welOn, 'Greet people who join a group (once per person)'),
    field('Message', welText, '{name} becomes an @mention of the new members (people added together get one message), {rules} the rules below. Chats that are off get nothing; a single chat can override this under Chats.'),
    field('Group rules', welRules), welPrev,
    h('h3', { class: 'qa-h' }, 'FAQ auto-answers'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'When a message to the agent clearly matches a question, it gets your answer. Otherwise the agent answers as usual and knows these answers too.'),
    faqBox, ro ? null : h('button', { type: 'button', class: 'btn small mut', onclick: () => { faq.items.push({ questions: [], keywords: [], answer: '' }); drawFaq(); } }, '+ Add question'),
    field('Match', strict, 'Normal: most of a question\'s words or all keywords. Strict: the whole question or every keyword.'),
    h('div', { style: 'margin-top:8px' }, h('label', { class: 'inline' }, whole, 'Answer FAQ in the whole group (not only when the agent is addressed)')));
  return {
    el,
    value: () => ({ quickReplies: qr.filter((q) => q.command || q.text), help: help.checked, welcome: wel,
      faq: { ...faq, items: faq.items.filter((it) => (it.questions || []).length || (it.keywords || []).length || it.answer) } }),
  };
}

