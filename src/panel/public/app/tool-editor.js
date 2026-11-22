// Tool service editor shared by an agent and Settings → Tool services (035). Module of the panel (063).
// ---------- tool service editor: an agent's own services and Settings → Tool services (035) share it ----------
import { api, can, field, h, splitLines, time, toast, tryApi } from './core.js';
import { helpLink, smallServer } from './shared.js';
export const globRe = (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
const kvLines = (o, sep) => Object.entries(o || {}).map(([k, v]) => `${k}${sep}${v}`).join('\n');
const parseKv = (text, sep) => Object.fromEntries(splitLines(text).map((l) => { const i = l.indexOf(sep); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l.trim(), '']; }));
export const ROLE_LABEL = { organizer: 'Organizers', participant: 'Participants' };
/** Editable state of one tool service (saved* remember what the server has, for Connect / Install). */
export const serverState = (key, sv) => markSaved({ key, type: sv.type || 'remote', url: sv.url || '', auth: sv.auth || (key ? 'token' : 'oauth'),
  org: sv.tokens?.organizer || '', part: sv.tokens?.participant || '', headers: kvLines(sv.headers, ': '), oauthId: sv.oauthClient?.id || '', oauthSecret: sv.oauthClient?.secret || '',
  pkg: sv.package || '', args: (sv.args || []).join('\n'), env: kvLines(sv.env, '='), allowScripts: !!sv.allowScripts,
  defaults: { organizer: [...(sv.defaults?.organizer || ['*'])], participant: [...(sv.defaults?.participant || [])] }, behaviour: structuredClone(sv.behaviour || {}) });
export function markSaved(s) { s.savedUrl = s.url; s.savedAuth = s.auth; s.savedType = s.type; s.savedPkg = s.pkg; s.isNew = !s.key; return s; }
export const serverConfig = (s) => (s.type === 'local'
  ? { type: 'local', package: s.pkg, args: splitLines(s.args), env: parseKv(s.env, '='), allowScripts: s.allowScripts, behaviour: s.behaviour }
  : { type: 'remote', url: s.url, auth: s.auth, tokens: s.auth === 'token' ? { organizer: s.org, participant: s.part } : {}, headers: parseKv(s.headers, ':'), behaviour: s.behaviour,
    ...(s.auth === 'oauth' && s.oauthId ? { oauthClient: { id: s.oauthId, secret: s.oauthSecret } } : {}) });
/** A segmented choice (one of a few values), pressed state kept in place. */
export const seg = (label, options, value, onPick) => {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([v, l]) => h('button', {
    type: 'button', class: value === v ? 'on' : '', 'aria-pressed': String(value === v), disabled: !can('admin'),
    onclick: (e) => { onPick(v); el.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === e.currentTarget); x.setAttribute('aria-pressed', String(x === e.currentTarget)); }); } }, l)));
  return el;
};
// 094: how a service is used — the same editor for a service's default (Settings) and an agent's override (its Tools page)
const WHEN = [['asked', 'Only when asked'], ['useful', 'When useful'], ['proactive', 'Proactively']];
const CHANGES = [['ask', 'Ask first'], ['clear', 'Clear requests'], ['act', 'Act and report']];
const SHARE = [['off', 'Off'], ['sometimes', 'Sometimes'], ['often', 'Often']];
const WHERE = [['all', 'Groups and direct'], ['dm', 'Direct only']];
const KIND_WORD = { gif: 'GIFs', sticker: 'stickers', image: 'pictures' };
const label = (opts, v) => (opts.find((o) => o[0] === v) || [])[1] || v;
/** One line for a service's settings (the row's summary). */
const behaviourLine = (b, media) => [label(WHEN, b.when || 'useful'), b.changes ? `changes: ${label(CHANGES, b.changes).toLowerCase()}` : '',
  media && b.share && b.share !== 'off' ? `shares ${KIND_WORD[media]} ${b.share}` : '', b.perReply || b.perDay ? 'limits' : '', b.where === 'dm' ? 'direct only' : ''].filter(Boolean).join(' · ');
/**
 * How it uses a service: when, changes, share on its own (only `media`: a read-only tool that returns media), limits.
 * state: the fields this level sets (a service's default, or an agent's override); `dflt`: what applies without one
 * (an agent: the service's default) — then every choice starts with "Default (…)". onChange after each edit.
 */
export function behaviourEditor(state, { dflt = null, media = '', onChange = () => {} } = {}) {
  const set = (k, v) => { if (v === 'inherit' || v === '') delete state[k]; else state[k] = v; onChange(); };
  const choice = (k, title, opts, fallback) => {
    const first = dflt ? [['inherit', `Default (${label(opts, dflt[k] || fallback) || 'agent'})`]] : k === 'changes' ? [['', 'Agent’s setting']] : [];
    return field(title, seg(title, [...first, ...opts], state[k] ?? (dflt ? 'inherit' : k === 'changes' ? '' : fallback), (v) => set(k, v)));
  };
  const text = (k, title, ph, max) => field(title, h('input', { value: state[k] || '', maxlength: max, disabled: !can('admin'), placeholder: dflt?.[k] || ph, oninput: (e) => set(k, e.target.value.trim()) }));
  const num = (k, title) => field(title, h('input', { type: 'number', min: 0, max: 1000, value: state[k] ?? '', disabled: !can('admin'), placeholder: dflt ? String(dflt[k] || 'no limit') : 'no limit',
    oninput: (e) => set(k, e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0)) }));
  return h('details', { class: 'behaviour' }, h('summary', {}, h('b', {}, 'How it uses it'), h('span', { class: 'small muted' }, ` · ${behaviourLine({ ...(dflt || {}), ...state }, media) || 'When useful'}`)),
    h('div', { class: 'row spread' }, h('span', { class: 'small muted' }, 'Read-only tools never ask; tools that declare themselves destructive always ask.'), helpLink('tool-services.md#how-agents-use-a-service')),
    choice('when', 'When to use it', WHEN, 'useful'), text('note', 'Note (optional)', 'e.g. only for this year’s event', 200),
    choice('changes', 'Changes it makes', CHANGES, ''),
    media ? h('div', {}, choice('share', `Share ${KIND_WORD[media]} on its own`, SHARE, 'off'), text('style', 'Style words (optional)', 'e.g. Telugu movie reactions', 120),
      h('p', { class: 'small muted' }, 'Sometimes: celebrations, thanks to it, when asked. Often: also thanks, welcomes, jokes, praise. Never on serious topics; only mood and style words are searched.')) : null,
    h('div', { class: 'grid2' }, num('perReply', 'Most uses per reply'), num('perDay', 'Most uses per day')),
    choice('where', 'Where results may be posted', WHERE, 'all'));
}
const RISK_WORD = { read: 'Read', change: 'Change', destructive: 'Destructive' };
/** The per-tool risk override (a select: what the tool declares, or read / change / destructive). risk: { get, set }. */
const riskSelect = (t, risk) => h('select', { 'aria-label': `${t.name}: risk`, disabled: !can('admin'), onchange: (e) => risk.set(t.name, e.target.value) },
  [['auto', `${RISK_WORD[t.risk] || 'Change'}${t.annotated ? '' : ' (not declared)'}`], ...Object.entries(RISK_WORD).map(([v, l]) => [v, `${l} (override)`])].map(([v, l]) => h('option', { value: v, selected: (risk.get(t.name) || 'auto') === v }, l)));
/** Tools of a service with a tick per role, an all/none tick per role and "Everyone: all tools" (#165).
 * rules: { has(role, tool), write(role, tools ticked, all tools) }. */
export function toolGrid(box, tools, rules, risk = null) {
  const ROLES = ['participant', 'organizer'];
  const on = Object.fromEntries(ROLES.map((r) => [r, new Set(tools.filter((t) => rules.has(r, t.name)).map((t) => t.name))]));
  const save = (role) => rules.write(role, tools.filter((t) => on[role].has(t.name)).map((t) => t.name), tools);
  const all = (role, v) => { on[role] = new Set(v ? tools.map((t) => t.name) : []); save(role); draw(); };
  const tick = (checked, label, onchange, mixed, text) => h('label', { class: 'tick' }, h('input', { type: 'checkbox', checked, indeterminate: !!mixed, disabled: !can('admin'), 'aria-label': label, onchange }), text);
  const draw = () => box.replaceChildren(
    h('div', { class: 'row', style: 'gap:6px;margin-top:8px' }, h('span', { class: 'small muted' }, `${tools.length} tools`),
      ...ROLES.map((r) => tick(on[r].size === tools.length, `All tools: ${ROLE_LABEL[r]}`, (e) => all(r, e.target.checked), on[r].size && on[r].size < tools.length, ` All: ${ROLE_LABEL[r]}`)),
      can('admin') ? h('button', { class: 'btn small', type: 'button', disabled: ROLES.every((r) => on[r].size === tools.length), onclick: () => { for (const r of ROLES) { on[r] = new Set(tools.map((t) => t.name)); save(r); } draw(); } }, 'Everyone: all tools') : null),
    h('table', { class: 'stack flat' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tool'), ...ROLES.map((r) => h('th', { class: 'c' }, ROLE_LABEL[r])), risk ? h('th', {}, 'Risk') : null)),
      h('tbody', {}, tools.map((t) => h('tr', {}, h('td', { 'data-label': '' }, h('b', {}, t.name), h('div', { class: 'small muted' }, t.description)),
        ...ROLES.map((r) => h('td', { class: 'c', 'data-label': ROLE_LABEL[r] },
          tick(on[r].has(t.name), `${t.name}: ${ROLE_LABEL[r]}`, (e) => { if (e.target.checked) on[r].add(t.name); else on[r].delete(t.name); save(r); draw(); }))),
        risk ? h('td', { 'data-label': 'Risk' }, riskSelect(t, risk)) : null)))));
  draw();
}
/**
 * One tool service as a fieldset. o: { base (API prefix with /probe, /discover, /connections, /local), conns, locals,
 * isOwner, save() → saved?, saveHint, rules and risk (see toolGrid), redraw(), remove(), keyLocked, extra (elements after the form) }.
 */
export function toolServiceEditor(s, o) {
  const enc = encodeURIComponent;
  const key = h('input', { value: s.key, placeholder: 'name (e.g. panduga)', disabled: !!o.keyLocked, oninput: (e) => (s.key = e.target.value.trim()) });
  const url = h('input', { value: s.url, placeholder: 'https://…/mcp or ${SECRET_NAME}', oninput: (e) => (s.url = e.target.value.trim()) });
  const org = h('input', { value: s.org, placeholder: '${ORGANIZER_TOKEN_SECRET}', oninput: (e) => (s.org = e.target.value.trim()) });
  const part = h('input', { value: s.part, placeholder: '${PARTICIPANT_TOKEN_SECRET} (optional)', oninput: (e) => (s.part = e.target.value.trim()) });
  const grid = h('div', {});
  const authSel = h('select', { onchange: (e) => { s.auth = e.target.value; o.redraw(); } },
    [['oauth', 'Sign in (OAuth)'], ['token', 'Token (secret)'], ['none', 'No credentials']].map(([v, l]) => h('option', { value: v, selected: s.auth === v }, l)));
  const savedSame = s.savedAuth === 'oauth' && s.auth === 'oauth' && s.savedUrl === s.url && s.key && !s.isNew;
  const connRow = (role) => {
    const cn = o.conns.find((x) => x.server === s.key && x.role === role && x.url === s.url);
    const status = !savedSame ? h('span', { class: 'small muted' }, o.saveHint)
      : !cn ? h('span', { class: 'pill', style: 'white-space:normal' }, role === 'participant' ? 'Not connected (uses the organizer sign-in, participant tools only)' : 'Not connected')
        : cn.status === 'connected' ? h('span', { class: 'pill ok' }, `Connected${cn.connectedBy ? ` by ${cn.connectedBy}` : ''} · ${time(cn.connectedAt)}`)
          : h('span', { class: 'pill warn' }, 'Reconnect needed');
    const connect = async () => {
      if (!savedSame && !(await o.save())) return;
      const r = await tryApi(() => api('POST', `${o.base}/connections/${enc(s.key)}/${role}`));
      if (r?.authorizeUrl) location.href = r.authorizeUrl;
    };
    return h('div', { class: 'row', style: 'align-items:center;margin-top:6px' }, h('b', { style: 'min-width:110px' }, ROLE_LABEL[role]), status,
      can('admin') ? h('button', { class: 'btn small', onclick: connect }, cn ? 'Reconnect' : 'Connect') : null,
      cn && can('admin') ? h('button', { class: 'btn small danger mut', onclick: async () => { if (await tryApi(() => api('DELETE', `${o.base}/connections/${enc(s.key)}/${role}`), 'Signed out')) { o.conns.splice(o.conns.indexOf(cn), 1); o.redraw(); } } }, 'Disconnect') : null);
  };
  const check = h('button', { class: 'btn small', onclick: async () => {
    const r = await tryApi(() => api('POST', `${o.base}/probe`, { url: s.url }));
    if (!r) return;
    const moved = r.url !== s.url && !s.url.startsWith('${');
    if (moved) s.url = r.url;
    s.auth = r.auth;
    o.redraw();
    toast(`${r.auth === 'oauth' ? `Uses sign-in (OAuth)${r.name ? `: ${r.name}` : ''}` : r.auth === 'none' ? 'Open, no credentials needed' : 'Needs a token'}${moved ? ' · URL updated to the final address' : ''}`);
  } }, 'Check');
  const creds = s.auth === 'oauth'
    ? h('div', { style: 'margin-top:8px' }, h('div', { class: 'small muted' }, 'Sign in on the service for each role. You will come back here when done.'), connRow('organizer'), connRow('participant'))
    : s.auth === 'token' ? h('div', {}, field('Organizer credential (secret reference)', org), field('Participant credential (optional; least privilege)', part)) : null;
  const typeSel = h('select', { style: 'max-width:230px;min-width:180px', 'aria-label': 'Kind of tool service', disabled: !o.isOwner && s.type === 'local', onchange: (e) => { s.type = e.target.value; o.redraw(); } },
    [['remote', 'Remote (URL)'], ['local', smallServer() ? 'Local (not on small servers)' : 'Local (npm or GitHub package)']].map(([v, l]) => h('option', { value: v, selected: s.type === v, disabled: v === 'local' && smallServer() && s.type !== 'local' }, l)));
  const ta = (prop, ph, rows = 2) => h('textarea', { value: s[prop], placeholder: ph, style: `min-height:${rows * 22 + 16}px`, oninput: (e) => (s[prop] = e.target.value) });
  const redirectUri = `${location.origin}/oauth/mcp/callback`;
  const advanced = h('details', { style: 'margin-top:8px' }, h('summary', { class: 'small muted' }, 'Advanced'),
    field('Extra headers (one per line, Name: value; values may use ${SECRET})', ta('headers', 'X-API-Key: ${MY_API_KEY}')),
    s.auth === 'oauth' ? h('div', {},
      h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Own OAuth app: only if the service does not let apps register themselves. Register this redirect URL with the service:'),
      h('div', { class: 'row', style: 'align-items:center' }, h('code', { class: 'small' }, redirectUri), h('button', { class: 'btn small', onclick: () => { navigator.clipboard?.writeText(redirectUri); toast('Copied'); } }, 'Copy')),
      h('div', { class: 'row' }, h('input', { value: s.oauthId, placeholder: 'Client ID', oninput: (e) => (s.oauthId = e.target.value.trim()) }),
        h('input', { value: s.oauthSecret, placeholder: 'Client secret as ${SECRET} (optional)', oninput: (e) => (s.oauthSecret = e.target.value.trim()) }))) : null);
  const discoverButton = (reqBody) => h('button', { class: 'btn small', onclick: async () => {
    const tools = await tryApi(() => api('POST', `${o.base}/discover`, reqBody));
    if (tools) toolGrid(grid, tools, o.rules, o.risk);
  } }, 'Discover tools');
  const legend = h('legend', {}, s.key || 'new tool service');
  if (s.type === 'local') {
    const st = o.locals.find((x) => x.server === s.key && x.package === s.pkg);
    const savedLocal = s.savedType === 'local' && s.savedPkg === s.pkg && s.key && !s.isNew;
    const install = async (fresh) => {
      if (!savedLocal && !(await o.save())) return;
      toast('Installing… this can take a minute');
      const r = await tryApi(() => api('POST', `${o.base}/local/${enc(s.key)}/install`, { fresh }));
      if (r) { o.locals.splice(0, o.locals.length, ...(await api('GET', `${o.base}/local`))); o.redraw(); toast(`Installed ${r.name}@${r.version}`); }
    };
    const pkg = h('input', { value: s.pkg, placeholder: '@scope/server@1.2.3 or github:owner/repo#tag', disabled: !o.isOwner, oninput: (e) => (s.pkg = e.target.value.trim()) });
    // 055: small servers do not run local tool services; saved ones stay in the config but are not started.
    const blocked = st?.blocked || (smallServer() ? 'This is a small server: local tool services are not run here, because each one is an extra Node.js process. Use a hosted tool service (one with a web address) instead, or switch on Small server mode in Settings → Server.' : '');
    return h('fieldset', {}, legend,
      h('div', { class: 'row' }, key, typeSel),
      blocked ? h('div', { class: 'note warn', id: 'local-blocked', style: 'margin-top:8px' }, h('b', {}, savedLocal ? 'Not started on this server. ' : 'Not available on this server. '), blocked,
        savedLocal ? ' It stays saved and starts again on a bigger server; remove it here if you no longer need it.' : '') : null,
      h('div', { class: 'note warn', style: 'margin-top:8px' }, 'A local tool service runs that package’s code on this server, with the same access as the app (including its data). Only add packages you trust, and pin a version.'),
      field('Package', pkg),
      h('div', { class: 'row' }, field('Arguments (one per line)', ta('args', '--read-only', 2)), field('Environment (NAME=value; values may use ${SECRET})', ta('env', 'API_KEY=${MY_KEY}', 2))),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: s.allowScripts, disabled: !o.isOwner, onchange: (e) => (s.allowScripts = e.target.checked) }), 'Allow install scripts (needed by some GitHub packages that build themselves)'),
      h('div', { class: 'row', style: 'align-items:center;margin-top:8px' },
        st?.installed ? h('span', { class: 'pill ok' }, `Installed ${st.installed.name}@${st.installed.version}`) : h('span', { class: 'pill' }, savedLocal ? 'Not installed yet (installs on first use)' : 'Save to install'),
        o.isOwner ? h('button', { class: 'btn small', disabled: !!blocked, onclick: () => install(false) }, st?.installed ? 'Reinstall' : 'Install') : h('span', { class: 'small muted' }, 'Only the owner can install or change local tool services'),
        o.isOwner && st?.installed && !blocked ? h('button', { class: 'btn small', onclick: () => install(true) }, 'Update (fresh install)') : null),
      h('div', { class: 'row', style: 'margin-top:8px' }, blocked ? null : discoverButton({ type: 'local', server: s.key }),
        h('button', { class: 'btn small danger mut', disabled: !o.isOwner, onclick: o.remove }, 'Remove')),
      o.extra || null, grid);
  }
  return h('fieldset', {}, legend,
    h('div', { class: 'row' }, key, typeSel), h('div', { class: 'row', style: 'margin-top:6px' }, url, check), field('Authentication', authSel), creds, advanced,
    h('div', { class: 'row', style: 'margin-top:8px' },
      discoverButton(s.auth === 'oauth' ? { auth: 'oauth', server: s.key } : { url: s.url, token: s.auth === 'token' ? s.org : '', headers: parseKv(s.headers, ':'), server: s.key }),
      can('admin') ? h('button', { class: 'btn small danger mut', onclick: o.remove }, 'Remove') : null),
    o.extra || null, grid);
}

