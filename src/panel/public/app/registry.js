// Browse tool services (052): the MCP Registry sheet. Module of the panel (063).
// ---------- Browse tool services (052): search the MCP Registry, add in one step ----------
import { S, api, can, field, h, toast, tryApi } from './core.js';
import { reloadSection } from './settings.js';
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);
const TRUST_PILL = { good: ['ok', 'Verified publisher · source linked'], ok: ['info', 'Verified publisher'], warn: ['warn', 'Check before adding'] };
/**
 * The search sheet. o: { target: 'all' | agent id, targetName, onAdded() }. Registry text is shown as text only;
 * links open in a new tab and only when they are http(s).
 */
function browseRegistry(o) {
  const enc = encodeURIComponent;
  const body = h('div', {});
  const dlg = h('dialog', { class: 'dlg sheet', 'aria-label': 'Browse tool services' },
    h('div', { class: 'row spread', style: 'align-items:flex-start' }, h('h2', { style: 'margin:0' }, 'Browse tool services'),
      h('button', { class: 'btn small', 'aria-label': 'Close', onclick: () => dlg.close() }, 'Close')),
    h('p', { class: 'small muted', style: 'margin:6px 0 0' }, `From the MCP Registry. Adds to ${o.targetName}. Hosted services run elsewhere; local ones run on this server.`),
    body);
  let added = false;
  dlg.addEventListener('close', () => { dlg.remove(); if (added) o.onAdded?.(); });
  document.body.append(dlg); dlg.showModal();

  // ----- search view -----
  const q = h('input', { type: 'search', placeholder: 'Search, e.g. notion, calendar, github', 'aria-label': 'Search the MCP Registry', style: 'flex:1 1 200px;min-width:0' });
  const list = h('div', { class: 'reg-list', 'aria-live': 'polite' });
  const more = h('div', {});
  let cursor = null; let token = 0;
  async function search(append = false) {
    const my = ++token;
    if (!append) { cursor = null; list.replaceChildren(h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Searching…')); }
    more.replaceChildren();
    try {
      const r = await api('GET', `/api/tool-services/registry?q=${enc(q.value.trim())}&limit=20${append && cursor ? `&cursor=${enc(cursor)}` : ''}`);
      if (my !== token) return;
      if (!append) list.replaceChildren();
      if (!r.items.length && !append) list.append(h('p', { class: 'small muted' }, 'Nothing found. Try a shorter word: the registry searches service names.'));
      list.append(...r.items.map(card));
      cursor = r.nextCursor;
      if (cursor) more.replaceChildren(h('button', { class: 'btn small', style: 'margin-top:10px', onclick: () => search(true) }, 'Show more'));
    } catch (e) { if (my === token) list.replaceChildren(h('div', { class: 'note warn' }, e.message)); }
  }
  function card(s) {
    const [tc, tl] = TRUST_PILL[s.trust.level] || TRUST_PILL.ok;
    const repo = safeHref(s.repository?.url);
    return h('div', { class: 'reg-card' },
      h('div', { class: 'row spread', style: 'align-items:flex-start;flex-wrap:nowrap' },
        h('div', { style: 'min-width:0' }, h('h3', {}, s.title), h('div', { class: 'reg-sub' }, `${s.publisher.label} · ${s.name} · v${s.version}`)),
        h('button', { class: 'btn small primary', disabled: !s.can.any || !can('admin'), onclick: () => addView(s.name) }, 'Add')),
      s.description ? h('p', { class: 'reg-desc' }, s.description) : null,
      h('div', { class: 'row' },
        s.can.remote !== null ? h('span', { class: 'pill info' }, 'Hosted') : null,
        s.can.local !== null ? h('span', { class: 'pill' }, 'Local (npm)') : null,
        s.can.any ? null : h('span', { class: 'pill bad' }, 'Not supported here'),
        s.can.any ? h('span', { class: `pill${s.auth.needed ? ' warn' : ''}` }, s.auth.text) : null,
        h('span', { class: `pill ${tc}`, title: [...s.trust.hints, ...s.trust.warnings].join('. ') }, tl)),
      s.trust.warnings.length ? h('div', { class: 'small', style: 'color:var(--warn);margin-top:6px' }, s.trust.warnings.join('. ')) : null,
      s.can.any ? null : h('div', { class: 'small muted', style: 'margin-top:6px' }, s.can.reason),
      repo ? h('div', { class: 'small', style: 'margin-top:6px' }, h('a', { href: repo, target: '_blank', rel: 'noopener noreferrer' }, 'Source code ↗')) : null);
  }
  function searchView() {
    body.replaceChildren(h('form', { class: 'row', style: 'margin-top:12px;flex-wrap:nowrap', onsubmit: (e) => { e.preventDefault(); search(); } }, q, h('button', { class: 'btn', type: 'submit' }, 'Search')), list, more);
    q.focus();
  }

  // ----- add view -----
  async function addView(name) {
    body.replaceChildren(h('p', { class: 'small muted', style: 'margin-top:12px' }, h('span', { class: 'spinner' }), ' Loading…'));
    let d;
    try { d = await api('GET', `/api/tool-services/registry/server?name=${enc(name)}`); } catch (e) { body.replaceChildren(h('div', { class: 'note warn' }, e.message), backBtn()); return; }
    const e = d.entry;
    let kind = d.remote ? 'remote' : 'local';
    const key = h('input', { value: d.key, 'aria-label': 'Tool service name', autocomplete: 'off' });
    const form = h('div', {});
    const vals = {};
    const msg = h('div', { 'aria-live': 'polite' });
    const go = h('button', { class: 'btn primary', type: 'submit' }, `Add to ${o.targetName}`);
    const seg = d.remote && d.local ? h('div', { class: 'seg', role: 'group', 'aria-label': 'How it runs' }, [['remote', 'Hosted'], ['local', 'Local on this server']].map(([v, l]) => h('button', { type: 'button', class: kind === v ? 'on' : '',
      onclick: (ev) => { kind = v; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === ev.target)); drawForm(); } }, l))) : null;
    function drawForm() {
      const way = kind === 'remote' ? d.remote : d.local;
      const blocked = kind === 'local' && !d.local.allowed;
      go.disabled = blocked;
      const what = kind === 'remote' ? e.remotes[e.can.remote].url : `npm package ${e.packages[e.can.local].spec}`;
      form.replaceChildren(
        h('div', { class: 'small muted', style: 'overflow-wrap:anywhere' }, kind === 'remote' ? `Hosted at ${what}` : `Runs on this server: ${what}. Only the owner can add local services; the package is installed when you click Install.`),
        blocked ? h('div', { class: 'note warn' }, d.local.reason) : null,
        ...way.fields.map((f) => {
          const inp = h('input', { type: f.secret ? 'password' : 'text', autocomplete: 'off', value: vals[f.id] ?? (f.secret ? '' : f.default || ''), 'aria-label': f.label,
            placeholder: f.secret && f.stored ? 'stored — leave empty to keep' : f.placeholder || (f.template ? f.template : ''), oninput: (ev) => { vals[f.id] = ev.target.value; } });
          if (f.choices?.length) {
            const sel = h('select', { 'aria-label': f.label, onchange: (ev) => { vals[f.id] = ev.target.value; } }, f.choices.map((c) => h('option', { value: c, selected: (vals[f.id] ?? f.default) === c }, c)));
            return field(`${f.label}${f.required ? ' *' : ''}`, sel, f.description);
          }
          const hint = [f.description, f.secret ? `Stored as the secret ${f.secretName}; never shown again.` : ''].filter(Boolean).join(' ');
          return field(`${f.label}${f.required ? ' *' : ''}`, inp, hint || null);
        }),
        way.fields.length ? null : h('p', { class: 'small muted' }, kind === 'remote' ? 'No keys described. If the service asks you to sign in, a Connect button appears after adding.' : 'Nothing to fill in.'));
    }
    async function submit(replace = false) {
      go.disabled = true; msg.replaceChildren(h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Adding and listing its tools…'));
      try {
        const r = await api('POST', '/api/tool-services/registry/add', { server: e.name, kind, key: key.value.trim(), target: o.target, values: vals, replace });
        added = true; resultView(e, r);
      } catch (err) {
        go.disabled = false;
        msg.replaceChildren(h('div', { class: 'note warn' }, err.message), err.data?.code === 'exists' ? h('button', { class: 'btn small danger', type: 'button', onclick: () => submit(true) }, 'Replace it') : null);
      }
    }
    body.replaceChildren(
      h('form', { style: 'margin-top:12px', onsubmit: (ev) => { ev.preventDefault(); submit(); } },
        h('h3', { style: 'margin:0' }, e.title), h('div', { class: 'reg-sub' }, `${e.publisher.label} · ${e.name} · v${e.version}`),
        e.trust.warnings.length ? h('div', { class: 'note warn' }, e.trust.warnings.join('. ')) : h('div', { class: 'note ok' }, e.trust.hints.join('. ')),
        seg, field('Name in this app', key, 'Lowercase letters, digits and _. Tool rules use it, like name:*'), form, msg,
        h('div', { class: 'row', style: 'margin-top:12px' }, go, backBtn())));
    drawForm();
  }
  function backBtn() { return h('button', { class: 'btn', type: 'button', onclick: searchView }, 'Back'); }

  // ----- result view -----
  function toolsTable(tools) {
    return h('table', { class: 'stack flat' }, h('thead', {}, h('tr', {}, h('th', {}, `${tools.length} tools`), h('th', { class: 'c' }, 'Organizers'), h('th', { class: 'c' }, 'Participants'))),
      h('tbody', {}, tools.map((t) => h('tr', {},
        h('td', { 'data-label': '' }, h('b', {}, t.name), t.risky ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'changes things') : null, h('div', { class: 'small muted' }, t.description)),
        h('td', { class: 'c', 'data-label': 'Organizers' }, t.organizer ? '✓ on' : 'off'), h('td', { class: 'c', 'data-label': 'Participants' }, t.participant ? '✓ on' : 'off')))));
  }
  function resultView(e, r) {
    const where = r.target === 'all' ? 'Settings → Tool services' : 'the agent’s Tool services';
    const disc = r.discovery || {};
    const tools = h('div', {});
    const gate = r.confirmGate;
    if (disc.status === 'ok') tools.replaceChildren(toolsTable(disc.tools));
    else if (disc.status === 'sign_in') tools.replaceChildren(h('div', { class: 'note' }, `This service uses sign-in. Close this and click Connect next to ${r.key} in ${where}; its tools are listed after that.`));
    else if (disc.status === 'install') {
      const base = r.target === 'all' ? '/api/tool-services' : `/api/agents/${enc(r.target)}`;
      const btn = h('button', { class: 'btn primary', onclick: async () => {
        btn.disabled = true; btn.textContent = 'Installing… (can take a minute)';
        try {
          await api('POST', `${base}/local/${enc(r.key)}/install`, {});
          const list = await api('POST', `${base}/discover`, { server: r.key, type: 'local' });
          tools.replaceChildren(toolsTable(list.map((t) => ({ ...t, organizer: true, participant: false, risky: /(^|_)(delete|remove|send|write|update|create|edit|set|post|move|upload|run|exec)(_|$)/i.test(t.name) }))));
        } catch (err) { btn.disabled = false; btn.textContent = 'Install and list tools'; toast(err.message); }
      } }, 'Install and list tools');
      tools.replaceChildren(h('p', { class: 'small muted' }, 'The package is downloaded from npm and runs on this server with only the settings you gave it.'), btn);
    } else tools.replaceChildren(h('div', { class: 'note warn' }, `Added, but its tools could not be listed yet: ${disc.error || 'unknown error'}. Check its keys in ${where}.`));
    body.replaceChildren(h('div', { style: 'margin-top:12px' },
      h('div', { class: 'note ok' }, `Added ${e.title} as ${r.key} to ${o.targetName}. Organizers get its tools, participants none: change that in ${where}.`),
      r.secretsStored.length ? h('p', { class: 'small muted' }, `Stored as secrets: ${r.secretsStored.join(', ')}.`) : null,
      ...(r.warnings || []).map((w) => h('div', { class: 'note warn' }, w)),
      gate ? h('div', { class: 'note' }, gate.applied ? `Changes go through ${gate.preview} and wait for an organizer to reply “confirm CODE”.` : `This service previews changes before applying them (${gate.preview}). ${gate.note || ''}`) : null,
      tools,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Done'), h('button', { class: 'btn', onclick: searchView }, 'Add another'))));
  }
  searchView();
  search();
  return dlg;
}
/** "Browse" button, or nothing when browsing is off or this user cannot add. */
export function browseButton(o, settings) {
  if (!can('admin') || settings?.enabled === false) return null;
  return h('button', { class: 'btn small', type: 'button', onclick: () => browseRegistry(o) }, 'Browse tool services');
}
/** Settings → Tool services: the registry switch and a private registry address (owner). */
export function registrySettingsBox(st) {
  const isOwner = S.user?.role === 'owner';
  const on = h('input', { type: 'checkbox', checked: st.enabled, disabled: !isOwner });
  const url = h('input', { value: st.baseUrl, placeholder: 'https://registry.modelcontextprotocol.io (default)', disabled: !isOwner, 'aria-label': 'Registry address' });
  return h('details', { style: 'margin-top:10px' }, h('summary', {}, `MCP Registry: ${st.enabled ? (st.official ? 'official registry' : st.baseUrl) : 'off'}`),
    h('label', { class: 'check' }, on, 'Allow browsing the MCP Registry to add tool services'),
    field('Registry address', url, 'Leave empty for the official registry. A company registry with the same API also works (https).'),
    isOwner ? h('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => tryApi(async () => { await api('PUT', '/api/tool-services/registry/settings', { enabled: on.checked, baseUrl: url.value.trim() }); reloadSection(); }, 'Saved') }, 'Save') : h('p', { class: 'small muted' }, 'Only the owner can change this.'));
}

