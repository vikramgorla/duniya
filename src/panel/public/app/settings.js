// Settings screen: every section (tool services, owner assistant, users, sign-in, web access, logging, …). Module of the panel (063).
// ---------- secrets ----------
import { $, S, ago, api, can, copyBtn, copyRow, extLink, field, gLogo, h, jumpToSub, splitLines, toast, toggle, tryApi } from './core.js';
import { browseButton, registrySettingsBox } from './registry.js';
import { SETTINGS_SECTIONS, SIZE_LABEL, SMALL_MODE_LINK, loadModels, modelSelect, openAgent } from './shared.js';
import { globRe, markSaved, serverConfig, serverState, toolServiceEditor } from './tool-editor.js';
/** Settings → Secrets (062: was its own tab). Redraws itself after a change. */
async function secretsCard() {
  const rows = await api('GET', '/api/secrets');
  const redraw = async () => card.replaceWith(await secretsCard());
  const name = h('input', { placeholder: 'NAME_LIKE_THIS', 'aria-label': 'Secret name' }); const val = h('input', { type: 'password', placeholder: 'value', 'aria-label': 'Secret value' });
  const card = h('div', { class: 'card', style: 'grid-column:1/-1' }, h('h2', {}, 'Secrets'),
    h('p', { class: 'small muted' }, 'API keys and tokens, stored encrypted on the server and never shown again. Agents reference them as ${NAME}. Save an empty value to remove.'),
    rows.length ? h('table', { class: 'stack' }, h('tbody', {}, rows.map((n) => { const v = h('input', { type: 'password', placeholder: 'new value', 'aria-label': `New value for ${n.name}` });
      return h('tr', {}, h('td', { 'data-label': '' }, h('code', {}, n.name), n.usedByAgents ? h('div', { class: 'small muted' }, 'used by an agent') : null),
        h('td', { 'data-label': 'Status' }, h('span', { class: `pill ${n.set ? 'ok' : 'bad'}` }, n.set ? 'set' : 'missing')),
        h('td', { 'data-label': '' }, h('form', { class: 'row nowrap mut', onsubmit: async (e) => { e.preventDefault(); if (await tryApi(() => api('PUT', '/api/secrets', { name: n.name, value: v.value }), v.value ? 'Saved' : 'Removed')) redraw(); } }, v, h('button', { class: 'btn' }, 'Save')))); })))
      : h('p', { class: 'small muted' }, 'No secrets yet. Model keys are added under Models; tool services ask for theirs when you add them.'),
    h('div', { class: 'mut' }, h('label', {}, 'Add a secret'), h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); if (await tryApi(() => api('PUT', '/api/secrets', { name: name.value.trim(), value: val.value }), 'Saved')) redraw(); } }, name, val, h('button', { class: 'btn primary' }, 'Add'))));
  return card;
}

export async function renderSettings() {
  const [agents, lg, ai, sess] = await Promise.all([api('GET', '/api/agents'), api('GET', '/api/logging').catch(() => null), api('GET', '/api/assistants').catch(() => null), api('GET', '/api/session').catch(() => null)]);
  const [oa, notice] = await Promise.all([api('GET', '/api/owner-assistant').catch(() => null), api('GET', '/api/privacy-notice').catch(() => null)]);
  if (sess?.user) { S.user = sess.user; S.google = !!sess.google; }
  const me = S.user;
  const cur = h('input', { type: 'password', placeholder: 'current', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', placeholder: 'new (12+ characters)', autocomplete: 'new-password' });
  const loadErr = (title) => (e) => h('div', { class: 'card' }, h('h2', {}, title), h('p', { class: 'small muted' }, `Could not load: ${e.message}`));
  const owner = can('owner') ? await Promise.all([api('GET', '/api/users'), api('GET', '/api/invites'), api('GET', '/api/auth/google'), api('GET', '/api/auth/signin').catch(() => null), api('GET', '/api/web').catch(() => null)]) : null;
  const [users, inv, gcfg, signin, web] = owner || [];
  const checklist = S.checklist || await api('GET', '/api/checklist').catch(() => null);
  const by = {
    'tool-services': await toolServicesCard().catch(loadErr('Tool services for all agents')),
    'owner-assistant': oa ? ownerAssistantCard(oa) : null,
    'direct-messages': h('div', { class: 'card' }, h('h2', {}, 'Direct messages'), h('label', {}, 'Default agent for direct messages without a trigger'),
      h('select', { disabled: !can('admin'), onchange: (e) => tryApi(() => api('POST', '/api/settings', { defaultDmAgent: e.target.value }), 'Saved') },
        h('option', { value: '' }, '— first agent that accepts the sender —'), agents.filter((b) => !b.builtin).map((b) => h('option', { value: b.id, selected: S.status?.settings?.defaultDmAgent === b.id }, b.name)))),
    'privacy-notice': notice ? privacyNoticeCard(notice) : null,
    'photos-voice': await photosVoiceCard().catch(loadErr('Photos & voice')),
    secrets: can('admin') ? await secretsCard().catch(loadErr('Secrets')) : null,
    users: owner ? usersCard(users, inv, signin) : null,
    'sign-in': owner && signin ? signinCard(signin) : null,
    google: owner ? googleSetupCard(gcfg) : null,
    'web-access': owner && web ? webAccessCard(web) : null,
    assistants: ai ? assistantsCard(ai) : null,
    password: h('div', { class: 'card' }, h('h2', {}, me.hasPassword ? 'Your password' : 'Add a password'),
      me.hasPassword ? [cur, h('div', { style: 'height:8px' })] : h('p', { class: 'small muted', style: 'margin-top:0' }, 'You sign in with Google. A password is a fallback for when Google sign-in is off.'), next,
      h('button', { class: 'btn primary', style: 'margin-top:10px', onclick: () => tryApi(async () => { await api('POST', '/api/password', { current: cur.value, next: next.value }); cur.value = next.value = ''; renderSettings(); }, me.hasPassword ? 'Password changed' : 'Password added') }, me.hasPassword ? 'Change password' : 'Add password')),
    'my-google': S.google || me.google ? myGoogleCard(me) : null,
    logging: lg ? loggingCard(lg) : null,
    'small-mode': smallModeCard(S.status?.server),
    'getting-started': can('admin') && checklist ? h('div', { class: 'card' }, h('h2', {}, 'Getting started'),
      h('p', { class: 'small muted', style: 'margin-top:0' }, checklist.complete ? `All ${checklist.total} steps are done.` : checklist.dismissed ? `Hidden from Overview, ${checklist.done} of ${checklist.total} steps done.` : `On Overview, ${checklist.done} of ${checklist.total} steps done.`),
      checklist.dismissed && !checklist.complete ? h('button', { class: 'btn', onclick: () => tryApi(async () => { S.checklist = await api('PUT', '/api/checklist', { dismissed: false }); location.hash = 'overview'; }) }, 'Show on Overview again') : null) : null,
    'whatsapp-helpers': h('div', { class: 'card' }, h('h2', {}, 'WhatsApp helpers'), h('p', { class: 'small' }, 'Organizers of any agent can send:'),
      h('ul', { class: 'small' }, h('li', {}, h('code', {}, '!groupid'), ' in a group → replies with its id'), h('li', {}, h('code', {}, '!groups'), ' in a DM → lists all groups'))),
  };
  const shown = SETTINGS_SECTIONS.filter(([id]) => by[id]);
  for (const [id] of shown) by[id].dataset.jump = id;
  const index = h('nav', { class: 'jumpbar card', 'aria-label': 'Settings sections' }, shown.map(([id, title]) => h('a', { class: 'btn small', href: `#settings/${id}`, onclick: (e) => {
    e.preventDefault(); history.replaceState(null, '', `#settings/${id}`); jumpToSub();
  } }, title)));
  $('#main').replaceChildren(index, h('div', { class: 'grid', style: 'align-items:start' }, shown.map(([id]) => by[id])));
}

// ---------- Settings → Server: Small server mode (055), one switch for heavier features on a small server ----------
function smallModeCard(sv) {
  if (!sv) return null;
  const on = !!sv.smallMode;
  const small = sv.size === 'small';
  const ram = sv.effectiveMb >= 1024 ? `${(sv.effectiveMb / 1024).toFixed(1)} GB` : `${sv.effectiveMb} MB`;
  const flip = (v) => tryApi(async () => { await api('PUT', '/api/server/small-mode', { enabled: v }); S.status = await api('GET', '/api/status'); renderSettings(); }, v ? 'Small server mode on' : 'Small server mode off');
  return h('div', { class: 'card', id: 'small-mode' }, h('h2', {}, 'Server size'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, `${SIZE_LABEL[sv.size]}: ${ram} memory, ${sv.cpus} CPU${sv.cpus > 1 ? 's' : ''}.`),
    h('label', { class: 'inline' }, toggle(on, flip, !can('owner')), h('b', {}, 'Small server mode: allow heavier features on this server')),
    h('div', { class: 'small', style: 'margin-top:6px' }, 'On a small server (under 2 GB or 1 CPU), allows on-server speech and local tool services anyway. Caveats: slower; one job at a time and at most 2 local tool services; they start only when enough memory is free and are stopped when memory gets tight (the agent then answers without them). GitHub Copilot sign-in is not covered: it needs 2 GB.'),
    !small ? h('div', { class: 'small muted', style: 'margin-top:6px' }, 'This server is not small: everything is available, the switch changes nothing here.') : null,
    !can('owner') ? h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Only the owner can change this.') : null);
}

// ---------- Settings → Owner assistant (044): link your WhatsApp number; 059: the rest is its agent editor ----------
function ownerAssistantCard(o) {
  const l = o.link;
  const box = h('div', {});
  const reload = () => renderSettings();
  const sendTo = o.sendTo.length ? o.sendTo.map((n) => `+${n.phone}`).join(' or ') : 'an agent number';
  let state;
  if (l.status === 'linked') {
    state = [h('div', { class: 'note ok' }, `✓ Linked +${l.phone}. Message ${sendTo} from this phone to ask about your chats.`),
      h('button', { class: 'btn small danger', onclick: () => confirm(`Unlink +${l.phone}? The owner assistant stops answering this number.`) && tryApi(async () => { await api('DELETE', '/api/owner-assistant/link'); reload(); }, 'Unlinked') }, 'Unlink')];
  } else if (l.status === 'pending') {
    state = [h('div', { class: 'note warn' }, `Linked +${l.phone}? Confirm only if this is your phone.`),
      h('div', { class: 'row', style: 'gap:8px' },
        h('button', { class: 'btn primary', onclick: () => tryApi(async () => { await api('POST', '/api/owner-assistant/link/confirm'); reload(); }, 'Linked') }, `Yes, link +${l.phone}`),
        h('button', { class: 'btn danger', onclick: () => tryApi(async () => { await api('DELETE', '/api/owner-assistant/link'); reload(); }, 'Cancelled') }, 'Not me'))];
  } else if (l.status === 'code') {
    state = [h('div', { class: 'note' }, `A code is waiting (valid until ${new Date(l.expiresAt).toLocaleTimeString()}). Send it from WhatsApp, then press Check.`),
      h('div', { class: 'row', style: 'gap:8px' }, h('button', { class: 'btn', onclick: reload }, 'Check'), h('button', { class: 'btn', onclick: () => newCode() }, 'New code'))];
  } else {
    state = [h('p', { class: 'small' }, 'Not linked yet.'), h('button', { class: 'btn primary', onclick: () => newCode() }, 'Link my WhatsApp')];
  }
  async function newCode() {
    const r = await tryApi(() => api('POST', '/api/owner-assistant/link'));
    if (!r) return;
    box.replaceChildren(h('div', { class: 'note' }, h('div', {}, `From your own phone, send this message to ${sendTo} on WhatsApp (valid 10 minutes):`), copyRow(r.message)),
      h('button', { class: 'btn', onclick: reload }, 'I sent it — check'));
  }
  return h('div', { class: 'card' }, h('h2', {}, 'Owner assistant'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Your own agent in your private WhatsApp chat with an agent number (and the Ask box on Overview): recaps, who said what, usage and changes, plus GIFs, pictures, voice, polls and tools — and it can send into chats that are on after you confirm. It only answers linked panel users, never in groups, and sees only chats that are on and not private to members. Changes always need “confirm CODE”. Start a message with an agent’s trigger (e.g. “!family …”) to talk to that agent instead.'),
    h('p', { class: 'small muted' }, o.role === 'viewer' ? 'Your account is read-only: the assistant can look things up for you but not change anything or read messages.' : o.role === 'admin' ? 'As an admin, the assistant can do what you can do in the panel, except owner-only settings.' : 'As an owner, the assistant can do everything you can do here; tools that need keys or passwords stay in the panel.'),
    state, box,
    h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => openAgent(o.agent) }, 'Character, tools, voice, schedules & alerts →')),
    o.links?.length ? h('details', { style: 'margin-top:10px' }, h('summary', { class: 'small', style: 'cursor:pointer' }, `Linked people (${o.links.length})`),
      h('ul', { class: 'small' }, o.links.map((x) => h('li', {}, `${x.username} · +${x.phone} `, h('button', { class: 'btn small danger', onclick: () => confirm(`Unlink ${x.username} (+${x.phone})?`) && tryApi(async () => { await api('DELETE', `/api/owner-assistant/links/${x.userId}`); reload(); }, 'Unlinked') }, 'Unlink'))))) : null);
}
// ---------- Settings → Privacy notice (044) ----------
function privacyNoticeCard(n) {
  const text = h('textarea', { value: n.text, maxlength: 500, style: 'min-height:70px', 'aria-label': 'Group notice', disabled: !can('admin') });
  const dmText = h('textarea', { value: n.dmText, maxlength: 500, style: 'min-height:56px', 'aria-label': 'Direct message notice', disabled: !can('admin') });
  const save = (body, msg) => tryApi(async () => { await api('PUT', '/api/privacy-notice', body); renderSettings(); }, msg);
  return h('div', { class: 'card' }, h('h2', {}, 'Privacy notice'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'When you switch a group On, the agents’ number posts this once, so members know messages are stored. It is posted again only if you change the text or after 90 days. Groups can opt out on the Chats page (recorded in Activity). Chats that are off never get anything.'),
    h('div', { class: 'row', style: 'gap:10px' }, h('label', { class: 'inline' }, toggle(n.enabled, (v) => save({ enabled: v }, v ? 'Notice on' : 'Notice off')), 'Post in groups when switched on')),
    field('Group notice', text),
    h('div', { class: 'row', style: 'gap:10px;margin-top:10px' }, h('label', { class: 'inline' }, toggle(n.dmFirstReply, (v) => save({ dmFirstReply: v }, 'Saved')), 'Direct messages: add a line to the agent’s first reply, once per person')),
    field('Direct-message line', dmText),
    can('admin') ? h('button', { class: 'btn primary', style: 'margin-top:10px', onclick: () => save({ text: text.value, dmText: dmText.value }, 'Notice saved') }, 'Save texts') : null);
}

// ---------- Settings → Photos & voice (043): fallback model, pictures, voice, on-server speech engines ----------
let mediaTimer = null;
async function photosVoiceCard() {
  const [m, models] = await Promise.all([api('GET', '/api/media'), loadModels().catch(() => ({ models: [] }))]);
  const card = h('div', { class: 'card', id: 'photos-voice' });
  const st = m.settings;
  const save = (patch, ok = 'Saved') => tryApi(async () => { await api('PUT', '/api/media/settings', patch); redraw(); }, ok);
  async function redraw() { const next = await photosVoiceCard().catch(() => null); if (next && card.isConnected) card.replaceWith(next); }
  const fb = modelSelect(models, st.visionFallback || '', { autoLabel: 'None — say “I can’t see photos”', disabled: !can('admin') });
  fb.querySelector('option[value="auto"]').value = '';
  const imgChoices = m.providers.filter((r) => r.creates && r.imageModel).map((r) => [`${r.id}:${r.imageModel}`, `${r.name} · ${r.imageModel}`]);
  const img = h('select', { disabled: !can('admin') }, h('option', { value: '' }, 'Automatic'), imgChoices.map(([v, l]) => h('option', { value: v, selected: st.imageModel === v }, l)),
    st.imageModel && !imgChoices.some(([v]) => v === st.imageModel) ? h('option', { value: st.imageModel, selected: true }, `${st.imageModel} (not available)`) : null);
  const priceRef = st.imageModel || imgChoices[0]?.[0] || '';
  const price = h('input', { type: 'number', min: '0', step: '0.001', placeholder: 'USD per picture', value: priceRef && st.imagePrices[priceRef] != null ? st.imagePrices[priceRef] : '', style: 'max-width:160px', disabled: !can('admin') || !priceRef });
  const voice = h('select', { disabled: !can('admin') }, m.voices.map((v) => h('option', { value: v, selected: st.voice === v }, v)));
  const maxMin = h('input', { type: 'number', min: '1', max: '30', value: Math.round(st.maxVoiceSeconds / 60), style: 'max-width:90px', disabled: !can('admin') });
  // On-server engines
  const allowed = m.localAllowed?.ok;
  const engines = Object.entries(m.local.engines);
  const installing = engines.some(([, e]) => e.installing);
  clearTimeout(mediaTimer);
  if (installing) mediaTimer = setTimeout(() => { if (S.tab === 'settings') redraw(); }, 3000);
  const useKey = { stt: 'listen', tts: 'speak' };
  const engineRow = ([kind, e]) => {
    const on = !!st.local[useKey[kind]];
    const state = e.installing ? h('span', { class: 'small' }, h('span', { class: 'spinner' }), ` ${e.installing.step}… started ${ago(e.installing.startedAt)} ago`)
      : e.error ? h('span', { class: 'pill bad' }, 'Install failed') : e.installed ? h('span', { class: `pill ${on ? 'ok' : ''}` }, on ? '✓ In use' : 'Installed, not in use') : h('span', { class: 'pill' }, 'Not installed');
    return h('div', { class: 'number-card' },
      h('div', { class: 'row spread' }, h('b', {}, e.label), state),
      h('div', { class: 'small muted', style: 'margin-top:4px' }, `Download about ${e.downloadMb} MB · ${e.diskMb} MB of disk · about ${e.ramMb} MB of memory while it works (only then).`),
      e.error ? h('div', { class: 'note bad' }, e.error) : null,
      kind === 'tts' && !m.local.ffmpeg ? h('div', { class: 'note warn' }, 'Needs ffmpeg on the server to make WhatsApp voice notes. Update the app with the installer (it adds ffmpeg), or run: sudo apt install ffmpeg') : null,
      can('owner') ? h('div', { class: 'row', style: 'margin-top:8px' },
        !e.installed && !e.installing ? h('button', { class: 'btn small', disabled: !allowed || !m.local.supported, onclick: () => tryApi(async () => { await api('POST', `/api/media/local/${kind}/install`); redraw(); }, 'Download started') }, e.error ? 'Try again' : 'Download') : null,
        e.installed ? h('label', { class: 'inline' }, toggle(on, (v) => save({ local: { [useKey[kind]]: v } }, v ? 'On' : 'Off'), !allowed), 'Use it') : null,
        e.installed ? h('button', { class: 'btn small danger mut', onclick: () => confirm(`Remove ${e.label}? Agents stop using it; you can download it again later.`) && tryApi(async () => { await api('DELETE', `/api/media/local/${kind}`); redraw(); }, 'Removed') }, 'Remove') : null) : null);
  };
  card.append(h('h2', {}, 'Photos & voice'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Server-wide choices for photos, pictures and voice. Each agent switches what it uses on its own page; what each provider can do is on ', h('a', { href: '#models' }, 'Models'), '.'),
    field('When an agent’s model can’t see photos, use', fb, 'A model that sees images (Claude, GPT, many OpenRouter models). Without one, the agent says kindly that it can’t look at photos.'),
    imgChoices.length ? [field('Pictures are made with', img), field(`Price per picture${priceRef ? ` (${priceRef})` : ''}`, price, 'Optional, for Usage and spending caps when the provider does not report a cost (OpenRouter does).')] : h('p', { class: 'small muted' }, 'No connected provider can create pictures (an OpenAI key with image models, or OpenRouter).'),
    h('div', { class: 'row' }, field('Voice for spoken replies (OpenAI)', voice), field('Longest voice note (minutes)', maxMin)),
    can('admin') ? h('button', { class: 'btn primary', style: 'margin-top:10px', onclick: () => {
      const patch = { visionFallback: fb.value, imageModel: img.value, voice: voice.value, maxVoiceSeconds: Math.max(10, Math.round(Number(maxMin.value || 5) * 60)) };
      if (priceRef) patch.imagePrices = { ...st.imagePrices, [img.value || priceRef]: price.value };
      save(patch);
    } }, 'Save') : null,
    h('h3', { style: 'margin:18px 0 6px' }, 'On-server speech'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Listen to voice notes and answer with voice on this server, without a provider — free, private, slower. Used after the providers, or alone. Open-source engines (Whisper, Piper via sherpa-onnx), downloaded only if you choose to.'),
    !m.local.supported ? h('div', { class: 'note warn' }, `On-server speech runs on Linux (x64 or arm64); this server is ${m.local.platform}.`) : null,
    m.server?.effectiveMb < 2048 && m.local.supported ? h('div', { class: 'note' },
      h('b', {}, `Small server mode is ${S.status?.server?.smallMode ? 'on' : 'off'}. `), 'On a server with about 1 GB of memory, on-server speech runs only with ', SMALL_MODE_LINK(),
      ': one voice note at a time, slow, only the smallest models. A provider (OpenAI or OpenRouter) is faster and safer on small servers.') : null,
    !allowed ? h('div', { class: 'note warn' }, m.localAllowed.reason) : m.server?.size !== 'large' ? h('div', { class: 'note' }, `Each engine needs about 300–400 MB of free memory while it works; this server has ${m.server.availableMb} MB free now. If memory is short at that moment, the provider is used or the agent asks for text.`) : null,
    engines.map(engineRow));
  return card;
}

// ---------- Settings → Tool services (035): MCP servers every agent can use ----------
async function toolServicesCard() {
  const [list, conns, locals, reg] = await Promise.all([api('GET', '/api/tool-services'), api('GET', '/api/tool-services/connections').catch(() => []), api('GET', '/api/tool-services/local').catch(() => []),
    api('GET', '/api/tool-services/registry/settings').catch(() => null)]);
  const isOwner = S.user?.role === 'owner';
  const items = list.map((g) => ({ s: serverState(g.name, g.config), g }));
  const box = h('div', {});
  const card = h('div', { class: 'card', style: 'grid-column:1/-1' }, h('h2', {}, 'Tool services for all agents'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Connect a tool service once and every agent can use it. Each agent can switch a service off (Agents → the agent → Tool services), and its role rules decide which tools organizers and participants get. The ticks below are the defaults for agents without their own choice.'),
    box);
  const defaultsRules = (s) => ({
    has: (role, name) => (s.defaults[role] || []).some((x) => globRe(x).test(name)),
    write: (role, names, tools) => { s.defaults[role] = names.length === tools.length ? ['*'] : names; },
  });
  const sum = (s, role) => { const d = s.defaults[role] || []; return !d.length ? 'none' : d.includes('*') ? 'all tools' : d.join(', '); };
  async function saveOne(it) {
    if (!it.s.key) { toast('Give the tool service a name first'); return false; }
    try {
      const r = await api('PUT', `/api/tool-services/${encodeURIComponent(it.s.key)}`, { ...serverConfig(it.s), defaults: it.s.defaults });
      it.g = r; markSaved(it.s); toast(`Saved ${it.s.key}`); draw(); return true;
    } catch (e) { toast(e.field ? `${e.field}: ${e.message.replace(/^[^:]+: /, '')}` : e.message); return false; }
  }
  async function removeOne(it) {
    if (it.s.isNew) { items.splice(items.indexOf(it), 1); return draw(); }
    const n = it.g?.agents?.using?.length || 0;
    if (!confirm(`Remove ${it.s.key} from all agents? ${n} agent${n === 1 ? '' : 's'} lose its tools right away and its sign-ins are deleted.`)) return;
    if (await tryApi(() => api('DELETE', `/api/tool-services/${encodeURIComponent(it.s.key)}`), 'Removed')) { items.splice(items.indexOf(it), 1); draw(); }
  }
  function draw() {
    box.replaceChildren(
      items.length ? null : h('p', { class: 'small muted' }, 'No tool services for all agents yet.'),
      ...items.map((it) => {
        const g = it.g;
        const status = g ? h('div', { class: 'row small', style: 'margin:6px 0' },
          h('span', { class: 'pill ok' }, `used by ${g.agents.using.length} agent${g.agents.using.length === 1 ? '' : 's'}`),
          g.agents.optedOut.length ? h('span', { class: 'pill' }, `switched off in ${g.agents.optedOut.join(', ')}`) : null,
          g.agents.replacedBy.length ? h('span', { class: 'pill warn' }, `replaced by own service in ${g.agents.replacedBy.join(', ')}`) : null,
          g.needs?.length ? h('span', { class: 'pill warn' }, `set in Settings → Secrets: ${g.needs.join(', ')}`) : null) : null;
        const canEdit = can('admin') && (isOwner || it.s.savedType !== 'local');
        const extra = h('div', {}, status,
          h('div', { class: 'small muted' }, `Defaults: organizers ${sum(it.s, 'organizer')}; participants ${sum(it.s, 'participant')}. Discover tools to change them.`),
          canEdit ? h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small primary', onclick: () => saveOne(it) }, it.s.isNew ? 'Add for all agents' : 'Save')) : null);
        return toolServiceEditor(it.s, { base: '/api/tool-services', conns, locals, isOwner, save: () => saveOne(it), saveHint: 'Save to connect', rules: defaultsRules(it.s),
          redraw: draw, remove: () => removeOne(it), keyLocked: !it.s.isNew, extra });
      }),
      can('admin') ? h('div', { class: 'row', style: 'margin-top:8px' }, browseButton({ target: 'all', targetName: 'all agents', onAdded: () => renderSettings() }, reg),
        h('button', { class: 'btn small mut', onclick: () => { items.push({ s: serverState('', {}), g: null }); draw(); } }, '+ Add tool service for all agents')) : null,
      reg ? registrySettingsBox(reg) : null);
  }
  draw();
  return card;
}

// ---------- Connected AI assistants (017) ----------
function copyButton(text) {
  return h('button', { class: 'btn', type: 'button', onclick: async (e) => {
    try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied ✓'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1500); } catch { toast('Select the address and copy it'); }
  } }, 'Copy');
}
function assistantsCard(a) {
  const url = h('input', { value: a.mcpUrl, readonly: true, 'aria-label': 'Address for AI assistants', onfocus: (e) => e.target.select() });
  const steps = (title, items) => h('details', {}, h('summary', { style: 'cursor:pointer;font-weight:600;margin:10px 0 4px' }, title), h('ol', { class: 'small', style: 'margin:6px 0 0;padding-left:20px' }, items.map((x) => h('li', { style: 'margin:3px 0' }, x))));
  const others = a.grants.some((g) => g.userId !== a.you);
  const revoke = (g) => confirm(`Disconnect ${g.clientName}${g.userId !== a.you ? ` (${g.username})` : ''}? It stops working right away. You can connect it again later.`)
    && tryApi(async () => { await api('DELETE', `/api/assistants/${g.userId}/${encodeURIComponent(g.clientId)}`); renderSettings(); }, 'Disconnected');
  return h('div', { class: 'card', style: 'grid-column:1/-1' }, h('h2', {}, 'Connected AI assistants'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Manage this app by chatting with ChatGPT or Claude: “which agents are on?”, “turn off the carpool agent”, “what happened in the Panduga group today?”. The assistant signs in as you and can do what your account can do.'),
    a.https ? null : h('div', { class: 'note warn' }, 'This address only works on this network. ChatGPT and Claude need the public https address of this app: set up internet access first (Caddy or Cloudflare, see the install guide), then open the panel at that address and come back here.'),
    h('label', {}, 'Address to paste in your assistant'), h('div', { class: 'row nowrap' }, url, copyButton(a.mcpUrl)),
    steps('ChatGPT', ['In ChatGPT open Settings → Apps & Connectors → Advanced settings and turn on Developer mode.', 'Go back to Apps & Connectors and click Create. Name it “Duniya”, paste the address above as the MCP server URL, choose OAuth, and click Create.', 'A Duniya page opens: sign in if asked, check what it may do, and click Approve.', 'In a new chat, turn on the Duniya connector (+ → Developer mode) and ask away.']),
    steps('Claude', ['In Claude open Settings → Connectors and click Add custom connector.', 'Name it “Duniya”, paste the address above as the remote MCP server URL, and click Add.', 'Click Connect. A Duniya page opens: sign in if asked, check what it may do, and click Approve.']),
    h('div', { class: 'note' }, h('b', {}, `With your ${S.user.role} account an assistant can: `), a.abilities.join('. '), '. ',
      S.user.role === 'viewer' ? '' : 'Risky actions (deleting an agent, erasing memory, changing secrets or users, restoring a backup, updates, restarts) always ask for a second confirmation.'),
    h('h3', {}, 'Connected'),
    a.grants.length ? h('table', { class: 'stack' }, h('tbody', {}, a.grants.map((g) => h('tr', {},
      h('td', { 'data-label': '' }, h('b', {}, g.clientName), g.redirectHost ? h('div', { class: 'small muted' }, g.redirectHost) : null),
      others ? h('td', { 'data-label': 'User' }, g.username, ' ', h('span', { class: 'pill' }, g.role)) : null,
      h('td', { class: 'small muted', 'data-label': '' }, `connected ${ago(g.connectedAt)} ago`, h('br'), g.lastUsedAt ? `last used ${ago(g.lastUsedAt)} ago` : 'not used yet'),
      h('td', { style: 'text-align:right', 'data-label': '' }, h('button', { class: 'btn small danger', onclick: () => revoke(g) }, 'Disconnect'))))))
      : h('p', { class: 'small muted' }, 'No AI assistants connected yet. Follow the steps above; it takes about a minute.'));
}

function myGoogleCard(me) {
  return h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('h2', {}, 'Your Google account'), h('span', { class: `pill ${me.google ? 'ok' : ''}` }, me.google ? 'linked' : 'not linked')),
    me.google
      ? [h('p', { class: 'small muted', style: 'margin-top:0' }, 'You can use “Sign in with Google” on the sign-in page.'),
        me.hasPassword ? h('button', { class: 'btn small danger', onclick: () => confirm('Unlink your Google account? You then sign in with your password only.') && tryApi(async () => { await api('DELETE', '/api/me/google'); renderSettings(); }, 'Unlinked') }, 'Unlink')
          : h('p', { class: 'small muted' }, 'To unlink Google, add a password first.')]
      : [h('p', { class: 'small muted', style: 'margin-top:0' }, 'Link your Google account to sign in with one click instead of your password.'),
        h('a', { class: 'btn google', href: '/auth/google/start?mode=link' }, gLogo(), 'Link my Google account')]);
}

function inviteMessage(i, panelUrl) {
  const until = new Date(i.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'long' });
  return `Hi! You're invited to the Duniya admin panel as ${i.role}.\n\nOpen ${panelUrl} and choose “Sign in with Google” with ${i.email}.\nThe invite is valid until ${until}.`;
}

/** 028: owner switch "Only allow Sign in with Google". */
function signinCard(st) {
  const busy = h('span', { class: 'small muted' });
  const set = async (v) => {
    if (v && !confirm(`Switch off password sign-in? Everyone must use Sign in with Google from now on.${st.withoutGoogle.length ? `\n\nThese accounts have no Google link and can no longer sign in: ${st.withoutGoogle.join(', ')}.` : ''}\n\nIf Google ever stops working, run “sudo duniya enable-password-login” on the server.`)) return renderSettings();
    await tryApi(() => api('PUT', '/api/auth/signin', { googleOnly: v }), v ? 'Only Google sign-in from now on' : 'Password sign-in is back on');
    renderSettings();
  };
  const sw = toggle(st.on, set, !st.on && !st.canEnable);
  return h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'Sign-in'),
    h('span', { class: `pill ${st.active ? 'ok' : ''}` }, st.active ? 'Google only' : 'Google and password')),
    h('p', { class: 'small muted' }, 'Turn off passwords so the panel can only be opened with a Google account you approved. Invites keep working.'),
    h('label', { class: 'inline' }, sw, 'Only allow Sign in with Google'), busy,
    !st.on && !st.canEnable ? h('div', { class: 'note', style: 'margin-top:8px' }, st.reason) : null,
    st.on && !st.active ? h('div', { class: 'note warn', style: 'margin-top:8px' }, 'Sign in with Google is not working right now, so passwords are allowed until it is set up again.') : null,
    st.withoutGoogle.length ? h('p', { class: 'small muted', style: 'margin-bottom:0' }, `${st.active ? 'Cannot sign in now' : 'Would lose access'} (no Google link): ${st.withoutGoogle.join(', ')}.`) : null,
    h('p', { class: 'small muted', style: 'margin-bottom:0' }, 'Locked out? On the server: ', h('code', {}, 'sudo duniya enable-password-login')));
}

function usersCard(users, inv, signin) {
  const un = h('input', { placeholder: 'username' }); const ue = h('input', { placeholder: 'email (optional, lets them use Google)' });
  const roleSel = (val) => h('select', {}, h('option', { value: 'admin', selected: val === 'admin' }, 'Admin'), h('option', { value: 'viewer', selected: val === 'viewer' }, 'Viewer (read-only)'), h('option', { value: 'owner', selected: val === 'owner' }, 'Owner'));
  const ur = roleSel('admin'); const up = h('input', { type: 'password', placeholder: 'password (12+), or empty for a sign-up link', autocomplete: 'new-password' });
  const signup = (r) => { S.signupLink = r; renderSettings(); };
  const ie = h('input', { type: 'email', placeholder: 'their.name@gmail.com', autocomplete: 'off' }); const ir = roleSel('admin');
  const mail = (i) => `mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent('Your invite to the Duniya admin panel')}&body=${encodeURIComponent(inviteMessage(i, inv.panelUrl))}`;
  const days = (ts) => Math.max(0, Math.ceil((ts - Date.now()) / 86400000));
  const sl = S.signupLink;
  return h('div', { class: 'card', style: 'grid-column:1/-1' }, h('h2', {}, 'Users'),
    h('p', { class: 'small muted' }, 'Owners manage everything incl. users, backups and updates. Admins manage agents, chats, models and memory. Viewers can only look.'),
    sl ? h('div', { class: 'note' }, `Send this to ${sl.username} only: they set their own password (works once, 48 hours). `, h('code', { class: 'small', style: 'word-break:break-all' }, sl.link), ' ', copyBtn(sl.link), ' ', h('button', { class: 'btn small', onclick: () => { S.signupLink = null; renderSettings(); } }, 'Done')) : null,
    h('div', { class: 'tscroll' }, h('table', { class: 'stack' }, h('tbody', {}, users.map((u) => h('tr', {},
      h('td', { 'data-label': '' }, h('b', {}, u.username), ' ', u.google ? h('span', { class: 'pill info', title: 'Signs in with Google' }, gLogo(), 'Google') : null,
        h('div', { class: 'small muted' }, [u.email, !u.hasPassword ? (u.google ? 'no password' : 'waiting for sign-up') : ''].filter(Boolean).join(' · '))),
      h('td', { 'data-label': 'Role' }, h('select', { style: 'min-width:110px', 'aria-label': `Role of ${u.username}`, onchange: (e) => tryApi(() => api('PUT', `/api/users/${u.id}`, { role: e.target.value }), 'Role changed').then((r) => r || renderSettings()) },
        ['owner', 'admin', 'viewer'].map((r) => h('option', { value: r, selected: u.role === r }, r)))),
      h('td', { style: 'white-space:nowrap;text-align:right', 'data-label': '' }, u.id === S.user.id ? h('span', { class: 'small muted' }, 'you') : [
        u.google && u.hasPassword ? h('button', { class: 'btn small', onclick: () => confirm(`Unlink Google from ${u.username}? They then sign in with their password.`) && tryApi(async () => { await api('DELETE', `/api/users/${u.id}/google`); renderSettings(); }, 'Unlinked') }, 'Unlink Google') : null, ' ',
        signin?.active ? null : h('button', { class: 'btn small', title: 'A one-time link (48 h) where they set their own password', onclick: () => (u.hasPassword ? confirm(`Make a link where ${u.username} sets a new password? Send it to them only.`) : true) && tryApi(() => api('POST', `/api/users/${u.id}/signup-link`)).then((r) => r && signup(r)) }, u.hasPassword ? 'Password link' : 'Sign-up link'), ' ',
        h('button', { class: 'btn small danger', onclick: () => confirm(`Remove ${u.username}? They can no longer sign in.`) && tryApi(async () => { await api('DELETE', `/api/users/${u.id}`); renderSettings(); }, 'Removed') }, 'Remove')])))))),
    h('h3', {}, 'Invite someone with Google'),
    inv.googleReady
      ? h('p', { class: 'small muted', style: 'margin-top:0' }, 'They sign in with their Google account the first time — no password to share. Send them the invite by email or copy it into WhatsApp.')
      : h('div', { class: 'note' }, 'Set up “Sign in with Google” (the card below) first. Invites only work once Google sign-in is ready.'),
    h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); const i = await tryApi(() => api('POST', '/api/invites', { email: ie.value, role: ir.value }), 'Invite created — now send it'); if (i) renderSettings(); } },
      ie, ir, h('button', { class: 'btn primary', disabled: !inv.googleReady }, 'Invite')),
    inv.invites.length ? h('div', { style: 'margin-top:6px' }, inv.invites.map((i) => h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('b', {}, i.email), h('div', { class: 'small muted' }, `${i.role} · invited by ${i.invitedBy || '?'}`)),
      h('span', { class: `pill ${i.expired ? 'bad' : 'warn'}` }, i.expired ? 'invite expired' : `invite pending · ${days(i.expiresAt)} days left`),
      h('div', { class: 'row', style: 'flex:0 0 auto' },
        h('a', { class: 'btn small', href: mail(i), onclick: () => api('POST', `/api/invites/${i.id}/renew`).then(() => setTimeout(renderSettings, 500)).catch(() => {}) }, i.expired ? 'Renew & email' : 'Email'),
        copyBtn(() => inviteMessage(i, inv.panelUrl), 'Copy message'),
        h('button', { class: 'btn small', title: 'Give them 14 more days', onclick: () => tryApi(async () => { await api('POST', `/api/invites/${i.id}/renew`); renderSettings(); }, 'Invite renewed for 14 days') }, 'Resend'),
        h('button', { class: 'btn small danger', onclick: () => confirm(`Revoke the invite for ${i.email}? They can no longer sign in with it.`) && tryApi(async () => { await api('DELETE', `/api/invites/${i.id}`); renderSettings(); }, 'Invite revoked') }, 'Revoke'))))) : null,
    signin?.active ? null : h('details', { style: 'margin-top:12px' }, h('summary', { class: 'small muted' }, 'Add a user with a password or a sign-up link instead'),
      h('form', { class: 'row', style: 'margin-top:10px', onsubmit: async (e) => { e.preventDefault(); const r = await tryApi(() => api('POST', '/api/users', { username: un.value, email: ue.value, role: ur.value, password: up.value }), 'User added'); if (r) signup(r.signup || null); } },
        un, ue, ur, up, h('button', { class: 'btn primary' }, 'Add user'))));
}

function googleSetupCard(g) {
  const cid = h('input', { value: g.clientId, placeholder: '1234567890-abc….apps.googleusercontent.com', autocomplete: 'off', spellcheck: 'false' });
  const sec = h('input', { type: 'password', placeholder: g.secretSet ? '•••• saved — paste a new one to replace' : 'GOCSPX-…', autocomplete: 'off' });
  const result = h('div', {});
  const showTest = (r) => result.replaceChildren(!r ? null : h('div', { class: `note ${r.ok ? 'ok' : 'bad'}` },
    h('b', {}, r.ok ? '✓ Google accepted the setup. ' : 'Not working yet. '), r.ok ? (S.user.google ? 'Your own account is linked.' : 'Try it: “Link my Google account” under Your Google account.') : null,
    h('ul', { style: 'margin:6px 0 0;padding-left:4px;list-style:none' }, r.checks.map((c) => h('li', {}, `${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)))));
  showTest(g.lastTest);
  const runTest = async (btn) => { btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), ' Testing…'); const r = await tryApi(() => api('POST', '/api/auth/google/test')); btn.disabled = false; btn.textContent = 'Test'; if (r) showTest(r); };
  const step = (cls, title, ...body) => h('li', { class: cls }, h('b', { class: 't' }, title), ...body);
  const addrs = g.addresses?.length ? g.addresses : [{ origin: g.origin, redirectUri: g.redirectUri }];
  const saved = g.clientId && g.secretSet;
  const steps = h('ol', { class: 'steps' },
    step(saved ? 'done' : 'now', 'Create a Google Cloud project',
      h('p', { class: 'small muted', style: 'margin:0 0 6px' }, 'Sign in with the Google account that should own this setup. Name the project e.g. “Duniya” and click Create. Already have a project? Select it at the top of the page instead.'),
      extLink('https://console.cloud.google.com/projectcreate', 'Open Google Cloud')),
    step(saved ? 'done' : '', 'Describe your app',
      h('p', { class: 'small muted', style: 'margin:0 0 6px' }, 'Branding: app name “Duniya”, your email as support and contact email → Save. Audience: choose External. “Testing” is fine — signing in with name and email needs no review by Google.'),
      h('div', { class: 'row', style: 'flex-wrap:wrap' }, extLink('https://console.cloud.google.com/auth/branding', 'Open Branding'), extLink('https://console.cloud.google.com/auth/audience', 'Open Audience'))),
    step(saved ? 'done' : '', 'Create the sign-in client',
      h('p', { class: 'small muted', style: 'margin:0 0 6px' }, addrs.length > 1 ? `Application type: Web application. Name: “Duniya panel”. This panel has ${addrs.length} addresses: add each value exactly, then click Create (or Save):` : 'Application type: Web application. Name: “Duniya panel”. Add these two addresses exactly, then click Create:'),
      g.warnings.map((w) => h('div', { class: 'note warn' }, w.text)),
      h('div', { class: 'small' }, 'Authorized JavaScript origins ', h('span', { class: 'muted' }, '(no slash at the end)')), addrs.map((a) => copyRow(a.origin)),
      h('div', { class: 'small' }, 'Authorized redirect URIs'), addrs.map((a) => copyRow(a.redirectUri)),
      extLink('https://console.cloud.google.com/auth/clients/create', 'Open Create client')),
    step(saved ? 'done' : '', 'Paste the Client ID and secret',
      h('p', { class: 'small muted', style: 'margin:0 0 6px' }, 'Google shows the client secret only once, right after you click Create — copy it now (or download the JSON).'),
      field('Client ID', cid), field('Client secret', sec),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn primary', onclick: async (e) => {
          const r = await tryApi(() => api('PUT', '/api/auth/google', { clientId: cid.value.trim(), ...(sec.value ? { clientSecret: sec.value.trim() } : {}) }), 'Saved');
          if (r?.ready) { const t = await tryApi(() => api('POST', '/api/auth/google/test')); if (t) g.lastTest = t; renderSettings(); }
        } }, 'Save and test'))));
  return h('div', { class: 'card', style: 'grid-column:1/-1' },
    h('div', { class: 'row spread' }, h('h2', {}, 'Sign in with Google'),
      h('span', { class: `pill ${g.ready ? (g.lastTest?.ok === false ? 'bad' : 'ok') : g.clientId && g.secretSet && !g.enabled ? 'warn' : ''}` }, g.ready ? (g.lastTest?.ok === false ? 'test failed' : 'on') : saved && !g.enabled ? 'off' : 'not set up')),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Let people sign in with their Google account, and invite new people by email. Passwords keep working. Google does not let apps create this for you, so it takes four short steps in Google Cloud (about 5 minutes, free).'),
    saved ? [
      h('div', { class: 'row', style: 'margin-bottom:6px' },
        h('button', { class: 'btn', onclick: (e) => runTest(e.currentTarget) }, 'Test'),
        h('label', { class: 'inline', style: 'margin-left:auto' }, toggle(g.enabled, (v) => tryApi(async () => { await api('PUT', '/api/auth/google', { enabled: v }); renderSettings(); }, v ? 'Google sign-in on' : 'Google sign-in off')), 'Show on the sign-in page')),
      result,
      h('details', {}, h('summary', { class: 'small muted' }, 'Setup steps and addresses'), steps,
        h('button', { class: 'btn small danger', onclick: () => confirm('Remove Google sign-in? People who only use Google cannot sign in until you set it up again (accounts and links are kept).') && tryApi(async () => { await api('DELETE', '/api/auth/google'); renderSettings(); }, 'Removed') }, 'Remove Google sign-in'))]
      : [steps, result]);
}

/** 031 + 036: web addresses (safe two-step switch), HTTPS state per address (direct or behind a proxy/CDN), and who may
 *  open the panel (proxy/CDN address list, own list) as a trial that is undone unless confirmed. Root helper applies. */
function webAccessCard(initial) {
  const card = h('div', { class: 'card', style: 'grid-column:1/-1' });
  let timer = null; let tick = null;
  const reload = async () => { if (!card.isConnected) return; try { draw(await api('GET', '/api/web')); } catch {} };
  const draw = (w) => {
    clearTimeout(timer); clearInterval(tick);
    const av = w.availability; const busy = !!w.pending;
    const sw = w.switch; const trial = w.trial;
    const prov = (id) => w.providers.find((p) => p.id === id);
    const accessLabel = !w.applied || !w.restricted ? 'open to everyone'
      : [w.applied.proxy ? `only ${prov(w.applied.proxy)?.name || w.applied.proxy}` : '', w.applied.allow.length ? `${w.applied.allow.length} own addresses` : ''].filter(Boolean).join(' + ');

    // ----- addresses and their HTTPS state -----
    const httpsLine = (x) => {
      const c = x.cert || {};
      if (x.health?.flexible) return h('div', { class: 'note bad', style: 'margin:4px 0 0' }, h('b', {}, 'Unencrypted proxy. '), x.health.error);
      if (c.state === 'valid') return h('span', {}, `✓ ${c.issuer || 'Valid'} certificate`, c.daysLeft != null ? ` · ${c.daysLeft} days left (renews by itself)` : '', x.proxied ? h('span', { class: 'muted' }, ' · behind a proxy: you can set its SSL/TLS mode to “Full (strict)”') : '');
      if (c.state === 'temporary') {
        return h('div', {}, h('span', {}, '🔒 Encrypted to the proxy with a temporary certificate — set the proxy’s SSL/TLS mode to “Full”. A real certificate is requested automatically (retried about every 80 minutes); then “Full (strict)” works.'),
          x.acme ? h('div', { class: 'note warn', style: 'margin:6px 0 0' }, h('b', {}, 'Why the real certificate is not there yet: '), x.acme.fix, h('div', { class: 'small muted', style: 'margin-top:4px;word-break:break-word' }, `Web server: ${x.acme.error}${x.acme.at ? ` (${ago(x.acme.at)} ago)` : ''}`)) : null);
      }
      if (c.state === 'invalid') return h('span', { style: 'color:var(--bad)' }, `✗ Certificate problem${c.error ? `: ${c.error}` : ''}`);
      return h('span', { class: 'muted' }, 'No certificate yet (getting one can take a minute)');
    };
    const role = (x) => (x.main ? 'main' : sw?.newHost === x.host ? 'new' : sw?.oldHost === x.host ? 'old' : 'also');
    const rows = w.hosts.map((x) => h('tr', {}, h('td', { class: 'muted small' }, role(x) === 'main' ? 'Address' : role(x) === 'new' ? 'New address' : 'Also'),
      h('td', {}, h('a', { href: `https://${x.host}`, target: '_blank', rel: 'noopener', style: 'word-break:break-all' }, `https://${x.host}`), x.proxied ? h('span', { class: 'pill info', style: 'margin-left:6px' }, 'behind a proxy') : null,
        h('div', { class: 'small', style: 'margin-top:2px' }, httpsLine(x)))));
    if (!w.hosts.length) rows.push(h('tr', {}, h('td', { class: 'muted small' }, 'Address'), h('td', {}, h('span', { class: 'muted' }, 'none (only on the server)'))));
    if (w.redirectHosts?.length) rows.push(h('tr', {}, h('td', { class: 'muted small' }, 'Forwarding'), h('td', { class: 'small' }, w.redirectHosts.join(', '), h('span', { class: 'muted' }, ' → main address'))));
    rows.push(h('tr', {}, h('td', { class: 'muted small' }, 'Access'), h('td', {}, w.restricted ? `Restricted: ${accessLabel}` : 'Open to everyone')));
    rows.push(h('tr', {}, h('td', { class: 'muted small' }, 'You'), h('td', {}, `${w.you.ip || 'unknown'}${w.you.via ? ` · through ${w.you.via}` : ''}`)));

    const statusBox = busy ? h('div', { class: 'note' }, h('span', { class: 'spinner' }), h('b', {}, w.pending === 'waiting' ? ` ${w.last?.message || 'Starting HTTPS'}…` : ' Applying the new settings…'),
      w.last?.startedAt ? ` started ${ago(w.last.startedAt)} ago. ` : ' ', 'If HTTPS does not come up within 4 minutes, the previous settings come back by themselves.')
      : w.last && ['failed', 'rolled-back'].includes(w.last.state) && Date.now() - (w.last.endedAt || 0) < 86400000 ? h('div', { class: 'note bad' }, h('b', {}, w.last.state === 'rolled-back' ? 'Rolled back. ' : 'Not applied. '), w.last.message, ` (${ago(w.last.endedAt)} ago)`)
        : w.last?.state === 'done' && Date.now() - (w.last.endedAt || 0) < 3600000 ? h('div', { class: 'note ok' }, h('b', {}, '✓ '), w.last.message) : null;

    // ----- #77: Google sign-in must know a new address -----
    const gs = w.google?.on ? w.google : null;
    const gVals = (host) => ({ origin: `https://${host}`, redirectUri: `https://${host}${gs.callbackPath}` });
    const googleBox = (host, phase) => {
      if (!gs || !host) return null;
      const v = gVals(host);
      const old = sw?.oldHost || w.current.host;
      return h('div', { class: 'note warn' }, h('b', {}, 'Google sign-in: add these in Google Cloud Console → APIs & Services → Credentials → your OAuth client'),
        h('div', { class: 'small', style: 'margin-top:6px' }, 'Authorized JavaScript origins (no slash at the end)'), copyRow(v.origin),
        h('div', { class: 'small' }, 'Authorized redirect URIs'), copyRow(v.redirectUri),
        h('p', { class: 'small', style: 'margin:6px 0' }, phase === 'confirmed'
          ? `https://${host} is the main address now: until it is added there, Google sign-in from it shows “redirect_uri_mismatch”${sw?.oldHost ? `; https://${sw.oldHost} keeps working while it is on` : ''}${gs.only ? ' (only Google is allowed: run “sudo duniya enable-password-login” on the server if you are locked out)' : ' (passwords still work)'}.`
          : `Until then, Google sign-in started at https://${host} stops with Google’s “redirect_uri_mismatch” error: sign in from ${old ? `https://${old}` : 'the old address'} meanwhile. Add them before you confirm: after confirming, the new address is the main one.`),
        extLink(gs.consoleUrl, 'Open Google Cloud credentials'));
    };

    // ----- two-step domain switch -----
    const post = (path, okMsg) => tryApi(async () => { const r = await api('POST', path); await reload(); return r; }, okMsg);
    let switchBox = null;
    if (sw?.applying) {
      switchBox = h('div', { class: 'note' }, h('span', { class: 'spinner' }), ` ${{ add: `Adding ${sw.newHost}`, confirm: `Making ${sw.newHost} the main address`, finish: `Turning off ${sw.oldHost}`, cancel: 'Going back to the previous address' }[sw.applying]}…`);
    }
    else if (sw?.phase === 'added') {
      const here = w.you.host === sw.newHost;
      switchBox = h('div', { class: 'note info' }, h('b', {}, `Step 2 of 3 · ${sw.newHost} added. `), `Both addresses work now. ${here ? 'You are using the new address, so it works:' : 'Open the panel at the new address and confirm there (that proves it works):'}`,
        h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' },
          here ? h('button', { class: 'btn primary', onclick: () => (!gs || confirm(`Make ${sw.newHost} the main address?\n\nGoogle sign-in: added https://${sw.newHost} in Google Cloud (origin and redirect URI shown below)? If not, Google sign-in from it fails until you do; turning off ${sw.oldHost} later leaves no working address for Google sign-in${gs.only ? ', and only Google is allowed on this panel' : ''}.`)) && post('/api/web/domain/confirm', 'Confirmed') }, 'Confirm — new address works')
            : h('a', { class: 'btn primary', href: `https://${sw.newHost}`, target: '_blank', rel: 'noopener' }, `Open https://${sw.newHost} ↗`),
          h('button', { class: 'btn', onclick: () => confirm(`Remove ${sw.newHost} again? ${sw.oldHost} stays the address.`) && post('/api/web/domain/cancel', 'Cancelled') }, 'Cancel')));
    } else if (sw?.phase === 'confirmed') {
      switchBox = h('div', { class: 'note ok' }, h('b', {}, `Step 3 of 3 · ${sw.newHost} is the main address. `), `${sw.oldHost} still works too. When nobody needs it any more (bookmarks, Google sign-in, AI assistants updated), turn it off: it then only forwards to the new address.`,
        h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' },
          h('button', { class: 'btn danger', onclick: () => confirm(`Turn off ${sw.oldHost}?\n\nThe panel stops answering there; visits are forwarded to https://${sw.newHost}.`) && post('/api/web/domain/finish', 'Old address turned off') }, `Turn off ${sw.oldHost}`),
          h('button', { class: 'btn', onclick: () => confirm(`Go back to ${sw.oldHost} as the main address and remove ${sw.newHost}?`) && post('/api/web/domain/cancel', 'Back to the previous address') }, 'Go back')));
    }

    // #77: next to the switch (adding, added, confirming, confirmed): what to register for Google sign-in
    const gPhase = sw && !['finish', 'cancel'].includes(sw.applying) ? (sw.phase === 'confirmed' || sw.applying === 'confirm' ? 'confirmed' : 'added') : null;
    const gBox = gPhase ? googleBox(sw.newHost, gPhase) : null;

    // ----- access trial (dead-man switch) -----
    let trialBox = null;
    if (trial) {
      const left = h('b', {});
      const until = trial.secondsLeft != null ? Date.now() + trial.secondsLeft * 1000 : null;
      const upd = () => { if (!until) return; const s = Math.max(0, Math.round((until - Date.now()) / 1000)); left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (!s) { clearInterval(tick); setTimeout(reload, 3000); } };
      trialBox = until ? h('div', { class: 'note warn' }, h('b', {}, 'Trying the new access rules. '), 'If you can read this after reloading the page through the public address, they work. Confirm within ', left, ' or they are undone automatically.',
        h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap' },
          h('button', { class: 'btn primary', disabled: !w.you.throughWebServer, onclick: () => post('/api/web/access/confirm', 'Kept') }, 'Confirm — I can still open the panel'),
          h('button', { class: 'btn', onclick: () => post('/api/web/access/undo', 'Undone') }, 'Undo now')),
        w.you.throughWebServer ? null : h('div', { class: 'small', style: 'margin-top:6px' }, 'Confirm from the public address of the panel, not through an SSH tunnel.'))
        : h('div', { class: 'note' }, h('span', { class: 'spinner' }), ' Applying the new access rules…');
      if (until) { upd(); tick = setInterval(upd, 1000); }
    } else if (w.lastRevert && Date.now() - w.lastRevert.at < 3600000) {
      trialBox = h('div', { class: 'note warn' }, h('b', {}, 'Access rules undone. '), `The last change was not confirmed in time (or was undone), so the previous rules are back (${ago(w.lastRevert.at)} ago).`);
    }

    // ----- add a domain -----
    const dom = h('input', { placeholder: 'agents.example.com', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none' });
    const dnsBox = h('div', {});
    const addBtn = h('button', { class: 'btn primary', disabled: true }, 'Add this domain');
    const showCheck = (r) => {
      addBtn.disabled = !r.ok || !!sw || busy;
      dnsBox.replaceChildren(h('div', { class: `note ${r.ok ? 'ok' : r.state === 'flexible' ? 'bad' : 'warn'}`, style: 'margin-top:8px' }, r.ok ? h('b', {}, '✓ ') : null, r.text),
        r.ok || r.state === 'flexible' ? null : h('div', { class: 'tscroll', style: 'margin-top:6px' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Name'), h('th', {}, 'Value'))),
          h('tbody', {}, h('tr', {}, h('td', {}, h('code', {}, r.record.type)), h('td', {}, h('code', {}, r.record.name), ' ', copyBtn(r.record.name)), h('td', {}, h('code', {}, r.record.value), ' ', r.serverIp ? copyBtn(r.record.value) : null))))),
        r.ok || r.state === 'flexible' ? null : h('p', { class: 'small muted' }, 'At your DNS provider: add the record (or, with a proxy/CDN, point its origin to this server’s address), wait a minute, then check again.'));
    };
    const check = async (btn) => {
      btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), ' Checking…');
      const r = await tryApi(() => api('POST', '/api/web/check', { domain: dom.value }));
      btn.disabled = false; btn.textContent = 'Check';
      if (r) showCheck(r);
    };
    addBtn.onclick = async () => {
      const d = dom.value.trim().toLowerCase();
      if (!confirm(`Add https://${d}?\n\nIt is added next to the current address: both work, nothing is switched off. Then you open the panel at the new address and confirm it there.${gs ? `\n\nGoogle sign-in is set up: add https://${d} (origin) and https://${d}${gs.callbackPath} (redirect URI) to your OAuth client in Google Cloud Console → APIs & Services → Credentials. The panel shows both with copy buttons next.` : ''}`)) return;
      if (await tryApi(() => api('POST', '/api/web/domain', { domain: d }), 'Adding…')) reload();
    };

    // ----- who can open the panel -----
    const st = { mode: w.settings.proxy ? 'proxy' : w.settings.allow.length ? 'list' : 'open' };
    const provSel = h('select', { style: 'max-width:320px' }, w.providers.slice().sort((a, b) => (a.id === 'custom') - (b.id === 'custom') || a.name.localeCompare(b.name))
      .map((p) => h('option', { value: p.id, selected: (w.settings.proxy || '') === p.id }, p.id === 'custom' ? 'Other proxy (my own ranges)' : p.name)));
    const custom = h('textarea', { rows: 3, placeholder: '198.51.100.0/24\n2001:db8::/32', spellcheck: 'false' }); custom.value = (w.settings.customRanges || []).join('\n');
    const provInfo = h('div', { class: 'small muted', style: 'margin-top:6px' });
    const placeProv = () => {
      const p = prov(provSel.value);
      custom.parentNode?.classList.toggle('hide', provSel.value !== 'custom');
      provInfo.replaceChildren(p.published ? `${p.name} publishes its addresses: ${p.ranges ? `${p.ranges} ranges${p.updatedAt ? `, updated ${ago(p.updatedAt)} ago` : ' (built in)'}` : 'not downloaded yet'}; refreshed daily. ` : 'Only your proxy’s addresses may connect. ',
        p.published ? h('button', { class: 'btn small', type: 'button', onclick: () => tryApi(async () => { await api('POST', '/api/web/ranges/refresh', { provider: p.id }); await reload(); }, 'List updated') }, 'Update list') : null);
    };
    provSel.onchange = placeProv;
    const list = h('textarea', { rows: 4, placeholder: '203.0.113.7\n198.51.100.0/24\n2001:db8::/32', spellcheck: 'false' }); list.value = w.settings.allow.join('\n');
    const mine = h('input', { type: 'checkbox', checked: w.settings.alwaysAllowMine !== false });
    const listBox = h('div', {}, field('Allowed addresses (one per line: an IP or a range like 203.0.113.0/24)', list),
      h('label', { class: 'inline', style: 'margin-top:6px' }, mine, `Always allow my current address (${w.you.ip || 'unknown'})`));
    const proxyBox = h('div', {}, field('Proxy / CDN in front of this server', provSel), h('div', {}, field('Its address ranges (one per line)', custom)), provInfo);
    const extra = h('details', {}, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Also limit to my own addresses (advanced)'));
    const modeHint = h('p', { class: 'small muted', style: 'margin:6px 0' });
    const HINT = {
      open: 'Anyone who knows the address can see the sign-in page (passwords and Google sign-in still protect it).',
      proxy: 'Only your proxy/CDN may connect, so nobody can bypass it by using this server’s IP address. Visitors must use the proxied domain.',
      list: 'Only the addresses below may open the panel. Good for a fixed office or home connection.',
    };
    const modeBody = h('div', {});
    const placeMode = () => {
      modeHint.textContent = HINT[st.mode];
      if (st.mode === 'proxy') { extra.replaceChildren(extra.firstChild, listBox); modeBody.replaceChildren(proxyBox, extra); placeProv(); } else if (st.mode === 'list') modeBody.replaceChildren(listBox); else modeBody.replaceChildren();
    };
    const seg = h('div', { class: 'seg' }, [['open', 'Everyone'], ['proxy', 'Only a proxy / CDN'], ['list', 'Only my list']].map(([v, l]) => h('button', { type: 'button', class: st.mode === v ? 'on' : '',
      onclick: (e) => { st.mode = v; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); placeMode(); } }, l)));
    const accessBody = () => ({
      proxy: st.mode === 'proxy' ? provSel.value : null, customRanges: splitLines(custom.value),
      allow: st.mode === 'list' || (st.mode === 'proxy' && extra.open) ? splitLines(list.value) : [], alwaysAllowMine: mine.checked,
    });
    const applyAccess = async (confirmLockout = false) => {
      try {
        const r = await api('PUT', '/api/web/access', { ...accessBody(), confirmLockout });
        toast(r.trial ? 'Trying the new rules: confirm them within 10 minutes' : 'Applying…'); reload();
      } catch (e) {
        if (e.data?.needsConfirm && confirm(`${e.message}\n\nThe change is a trial: if you do not confirm it within 10 minutes it is undone automatically. Locked out for longer? On the server run: sudo duniya open-access\n\nApply anyway?`)) return applyAccess(true);
        if (!e.data?.needsConfirm) toast(e.message);
      }
    };
    const pre = h('pre', { style: 'max-height:320px' });

    card.replaceChildren(
      h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'Web address & access'), h('span', { class: `pill ${w.restricted ? 'info' : ''}` }, accessLabel)),
      h('p', { class: 'small muted' }, 'The address people use to open this panel, its HTTPS certificate, and who may open it at all.'),
      h('div', { class: 'tscroll' }, h('table', {}, h('tbody', {}, ...rows))),
      statusBox, switchBox, gBox, trialBox,
      av.ok ? [
        h('h3', {}, 'Your own domain'),
        h('p', { class: 'small muted', style: 'margin-top:0' }, `Point a name you own to this server${w.serverIp ? ` (${w.serverIp})` : ''} — directly, or through a proxy/CDN — then check it. HTTPS is automatic either way: a free Let’s Encrypt certificate, and behind a proxy a temporary one until then, so the proxy always talks to this server encrypted. Proxies that talk to the server without encryption (“Flexible”) are not supported.`),
        h('div', { class: 'row' }, dom, h('button', { class: 'btn', disabled: busy, onclick: (e) => check(e.currentTarget) }, 'Check'), addBtn), dnsBox,
        h('h3', {}, 'Who can open the panel'),
        h('div', { style: 'overflow-x:auto' }, seg), modeHint, modeBody,
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', disabled: busy || !!trial, onclick: () => applyAccess() }, 'Apply access')),
        h('p', { class: 'small muted' }, 'Stricter rules are tried first: you confirm them from the panel within 10 minutes, otherwise the previous rules come back by themselves.'),
        h('details', { style: 'margin-top:10px' }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Show the web server configuration this creates'),
          h('button', { class: 'btn small', style: 'margin:8px 0', onclick: async () => { const r = await tryApi(() => api('POST', '/api/web/preview', accessBody())); if (r) pre.textContent = r.caddyfile; } }, 'Preview'), pre),
        h('details', { style: 'margin-top:6px' }, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Without open ports'),
          h('p', { class: 'small muted' }, 'Re-run the installer with a tunnel instead of ports 80/443: ', h('code', {}, '--cloudflare-token'), ' (Cloudflare Tunnel) or ', h('code', {}, '--tailscale-authkey'),
            ' (Tailscale: only your devices; Tailscale Funnel can make it public). Other tunnels such as frp, ngrok, Pangolin or zrok work too: install with ', h('code', {}, '--local-only'), ' and point them at http://127.0.0.1:8080.')),
        h('p', { class: 'small muted', style: 'margin-bottom:0' }, 'Locked out? On the server run ', h('code', {}, 'sudo duniya open-access'), ' to allow everyone again.'),
      ] : h('div', { class: 'note', style: 'margin-top:10px' }, av.text));
    if (av.ok) { placeMode(); if (busy) card.querySelectorAll('input,textarea,select,.seg button').forEach((x) => { x.disabled = true; }); }
    if (w.pending || sw?.applying || (trial && !trial.until)) timer = setTimeout(reload, 4000);
  };
  draw(initial);
  return card;
}

function loggingCard({ settings, categories }) {
  const cfg = structuredClone(settings);
  const levelSeg = h('div', { class: 'seg' }, [['minimal', 'Minimal'], ['normal', 'Normal'], ['verbose', 'Verbose']].map(([v, l]) => h('button', { class: cfg.level === v ? 'on' : '', disabled: !can('admin'),
    onclick: (e) => { cfg.level = v; levelSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.target)); hint.textContent = HINTS[v]; cats.classList.toggle('hide', v === 'minimal'); } }, l)));
  const HINTS = { minimal: 'Only errors, confirmations, configuration changes and connection status.', normal: 'The categories ticked below, with short details.', verbose: 'The categories ticked below, with full details (bigger log).' };
  const hint = h('div', { class: 'small muted', style: 'margin-top:6px' }, HINTS[cfg.level]);
  const cats = h('div', { class: cfg.level === 'minimal' ? 'hide' : '', style: 'margin-top:8px' }, Object.entries(categories).map(([k, label]) => h('label', { class: 'inline' },
    h('input', { type: 'checkbox', checked: cfg.categories[k] !== false, disabled: !can('admin'), onchange: (e) => (cfg.categories[k] = e.target.checked) }), label)));
  const days = h('input', { type: 'number', value: cfg.retentionDays, min: 1, max: 365, style: 'max-width:100px' });
  const max = h('input', { type: 'number', value: cfg.maxEntries, min: 500, step: 500, style: 'max-width:120px' });
  return h('div', { class: 'card' }, h('h2', {}, 'Activity log'),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'Choose what is recorded, to keep the log useful and small. Errors, confirmations and configuration changes are always kept. Each chat can override this on the Chats page.'),
    levelSeg, hint, cats,
    h('div', { class: 'row', style: 'margin-top:10px' }, h('div', {}, h('label', {}, 'Keep for (days)'), days), h('div', {}, h('label', {}, 'At most (entries)'), max)),
    can('admin') ? h('button', { class: 'btn primary', style: 'margin-top:12px', onclick: () => tryApi(() => api('PUT', '/api/logging', { ...cfg, retentionDays: Number(days.value), maxEntries: Number(max.value) }), 'Saved') }, 'Save') : null);
}

