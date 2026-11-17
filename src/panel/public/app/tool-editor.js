// Tool service editor shared by an agent and Settings → Tool services (035). Module of the panel (063).
// ---------- tool service editor: an agent's own services and Settings → Tool services (035) share it ----------
import { api, can, field, h, splitLines, time, toast, tryApi } from './core.js';
import { smallServer } from './shared.js';
export const globRe = (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
const kvLines = (o, sep) => Object.entries(o || {}).map(([k, v]) => `${k}${sep}${v}`).join('\n');
const parseKv = (text, sep) => Object.fromEntries(splitLines(text).map((l) => { const i = l.indexOf(sep); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l.trim(), '']; }));
export const ROLE_LABEL = { organizer: 'Organizers', participant: 'Participants' };
/** Editable state of one tool service (saved* remember what the server has, for Connect / Install). */
export const serverState = (key, sv) => markSaved({ key, type: sv.type || 'remote', url: sv.url || '', auth: sv.auth || (key ? 'token' : 'oauth'),
  org: sv.tokens?.organizer || '', part: sv.tokens?.participant || '', headers: kvLines(sv.headers, ': '), oauthId: sv.oauthClient?.id || '', oauthSecret: sv.oauthClient?.secret || '',
  pkg: sv.package || '', args: (sv.args || []).join('\n'), env: kvLines(sv.env, '='), allowScripts: !!sv.allowScripts,
  defaults: { organizer: [...(sv.defaults?.organizer || ['*'])], participant: [...(sv.defaults?.participant || [])] } });
export function markSaved(s) { s.savedUrl = s.url; s.savedAuth = s.auth; s.savedType = s.type; s.savedPkg = s.pkg; s.isNew = !s.key; return s; }
export const serverConfig = (s) => (s.type === 'local'
  ? { type: 'local', package: s.pkg, args: splitLines(s.args), env: parseKv(s.env, '='), allowScripts: s.allowScripts }
  : { type: 'remote', url: s.url, auth: s.auth, tokens: s.auth === 'token' ? { organizer: s.org, participant: s.part } : {}, headers: parseKv(s.headers, ':'),
    ...(s.auth === 'oauth' && s.oauthId ? { oauthClient: { id: s.oauthId, secret: s.oauthSecret } } : {}) });
/** Tools of a service with a tick per role. rules: { has(role, tool), write(role, tools ticked, all tools) }. */
export function toolGrid(box, tools, rules) {
  const on = { participant: new Set(tools.filter((t) => rules.has('participant', t.name)).map((t) => t.name)), organizer: new Set(tools.filter((t) => rules.has('organizer', t.name)).map((t) => t.name)) };
  const set = (role, name, v) => { if (v) on[role].add(name); else on[role].delete(name); rules.write(role, tools.filter((t) => on[role].has(t.name)).map((t) => t.name), tools); };
  box.replaceChildren(h('div', { class: 'small muted phone-only', style: 'margin-top:8px' }, `${tools.length} tools`),
    h('table', { class: 'stack flat' }, h('thead', {}, h('tr', {}, h('th', {}, `${tools.length} tools`), h('th', { class: 'c' }, 'Participants'), h('th', { class: 'c' }, 'Organizers'))),
      h('tbody', {}, tools.map((t) => h('tr', {}, h('td', { 'data-label': '' }, h('b', {}, t.name), h('div', { class: 'small muted' }, t.description)),
        ...['participant', 'organizer'].map((role) => h('td', { class: 'c', 'data-label': role === 'participant' ? 'Participants' : 'Organizers' },
          h('label', { class: 'tick' }, h('input', { type: 'checkbox', checked: on[role].has(t.name), disabled: !can('admin'), 'aria-label': `${t.name}: ${role}s`, onchange: (e) => set(role, t.name, e.target.checked) })))))))));
}
/**
 * One tool service as a fieldset. o: { base (API prefix with /probe, /discover, /connections, /local), conns, locals,
 * isOwner, save() → saved?, saveHint, rules (see toolGrid), redraw(), remove(), keyLocked, extra (elements after the form) }.
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
    if (tools) toolGrid(grid, tools, o.rules);
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

