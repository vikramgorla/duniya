// Agents screen (068): a calm list → page. One row per agent (avatar · name · "On · 1 chat · Auto model" · switch ·
// chevron), the built-in owner assistant in its own small section, "New agent" as one row; the page of the chosen
// agent is agentPage() (agent-editor.js). Two panes on wide screens, a pushed page on phones. Module of the panel (063).
import { agentPage } from './agent-editor.js';
import { aiHelper } from './ai-helper.js';
import { $, api, avatar, can, emptyState, h, icon, toast, toggle, tryApi } from './core.js';
import { listDetail } from './listdetail.js';
import { loadModels, modelLabel, openAgent, plural } from './shared.js';

/** The one muted line of an agent's row. */
const rowLine = (b, models) => (b.builtin ? 'Your own chat and Ask'
  : [b.enabled ? 'On' : 'Off', plural(b.config.chats.length, 'chat'), b.config.model === 'auto' ? 'Auto model' : modelLabel(b.config.model, models)].join(' · '));

export async function renderAgents() {
  const [agents, models] = await Promise.all([api('GET', '/api/agents'), loadModels().catch(() => ({ models: [] }))]);
  const own = agents.filter((b) => !b.builtin); const built = agents.filter((b) => b.builtin);
  const rowOf = (id) => $(`.ld-list a[href="#agents/${CSS.escape(encodeURIComponent(id))}"]`);
  /** Keeps a row (and the open page's switch) in step after a change on either. */
  const refresh = (b) => {
    const a = rowOf(b.id); if (!a) return;
    a.querySelector('.lrow-name').textContent = b.name;
    a.querySelector('.lrow-sub').textContent = rowLine(b, models);
    a.querySelector('.av')?.classList.toggle('off', !b.enabled && !b.builtin);
    const sw = a.parentElement.querySelector('input[role=switch]'); if (sw) sw.checked = !!b.enabled;
  };
  const flip = async (b, v) => {
    const r = await tryApi(() => api('PUT', `/api/agents/${encodeURIComponent(b.id)}`, { enabled: v }));
    if (!r) { refresh(b); return; }
    Object.assign(b, r); refresh(r);
    const sw = $(`.ap[data-agent="${CSS.escape(b.id)}"] .ap-head input[role=switch]`); if (sw) sw.checked = v;
    toast(`${b.name} ${v ? 'on' : 'off'}`, { undo: () => flip(b, !v) });
  };
  const item = (b) => ({ id: b.id, name: b.name, sub: rowLine(b, models), mark: avatar(b.name, b.id, b.enabled || b.builtin ? '' : 'off'),
    end: b.builtin ? null : toggle(b.enabled, (v) => flip(b, v), !can('admin'), `${b.name} on`) });
  const groups = [{ title: 'Your agents', items: own.map(item) }, { title: 'Built in', items: built.map(item) }];
  if (can('admin')) groups.push({ items: [{ id: 'new', name: 'New agent', sub: 'From a description, a template or a file', mark: h('span', { class: 'lmark add', 'aria-hidden': 'true' }, '+') }] });
  if (!own.length && !can('admin')) return $('#main').replaceChildren(h('div', { class: 'card' }, emptyState('agents', 'No agents yet', 'An admin can create one here.')));
  $('#main').replaceChildren(listDetail({ screen: 'agents', title: 'Agents', groups, first: own[0]?.id || (can('admin') ? 'new' : built[0]?.id),
    page: (id) => (id === 'new' ? newAgentPage() : agentPage(id, { onChange: refresh })) }));
}

/** New agent (068): one page with the three ways to start. */
function newAgentPage() {
  const box = h('div', { class: 'card ap-sec' }, h('h2', { tabindex: '-1' }, 'New agent'), h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading…'));
  (async () => {
    const templates = await api('GET', '/api/templates');
    const tpl = h('select', { 'aria-label': 'Template' }, templates.map((t) => h('option', { value: t.id }, t.name)));
    const about = h('div', { class: 'small muted' }, templates[0]?.description || '');
    tpl.onchange = () => { about.textContent = templates.find((t) => t.id === tpl.value)?.description || ''; };
    const name = h('input', { placeholder: 'Agent name (optional)', 'aria-label': 'Agent name' });
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'hide', onchange: async () => {
      const f = fileIn.files[0]; if (!f) return;
      const r = await tryApi(async () => api('POST', '/api/agents/import', JSON.parse(await f.text())), 'Imported');
      if (r) openAgent(r.id);
    } });
    const ai = await aiHelper({ bare: true, applyLabel: 'Create this agent',
      placeholder: 'Describe it in your own words, e.g. “For our festival group: answers agenda and menu questions, replies in English or Telugu, posts tomorrow’s agenda every evening at 8.”',
      onApply: async (r) => { const res = await tryApi(() => api('POST', '/api/agents', { config: r.proposed }), 'Agent created'); if (res) openAgent(res.id); } });
    box.replaceChildren(h('h2', { tabindex: '-1' }, 'New agent'),
      h('div', { class: 'sblock' }, h('h3', {}, h('span', { class: 'ai-chip' }, 'AI'), ' Describe it'), ai),
      h('div', { class: 'sblock' }, h('h3', {}, 'From a template'), h('div', { class: 'row' }, tpl, name,
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const base = templates.find((t) => t.id === tpl.value);
          const r = await tryApi(() => api('POST', '/api/agents', { template: tpl.value, config: name.value.trim() ? { name: name.value.trim() } : {} }), `Created from “${base?.name}”`);
          if (r) openAgent(r.id);
        } }, 'Create')), about),
      h('div', { class: 'sblock' }, h('h3', {}, 'From a file'), h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, icon('backups'), 'Import an agent (.json)'), fileIn));
  })().catch((e) => box.append(h('div', { class: 'note bad' }, e.message)));
  return box;
}
