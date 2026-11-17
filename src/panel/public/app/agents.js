// Agents screen: the list, templates and the AI draft of a new agent. Module of the panel (063).
import { renderAgentEditor } from './agent-editor.js';
import { aiHelper } from './ai-helper.js';
import { $, api, can, h, toggle, tryApi } from './core.js';
import { openAgent, usageLine } from './shared.js';
import { usageSummary } from './usage.js';
export async function renderAgents() {
  const route = location.hash.split('/');
  if (route[1]) return renderAgentEditor(decodeURIComponent(route[1]));
  const [agents, templates, us] = await Promise.all([api('GET', '/api/agents'), api('GET', '/api/templates'), usageSummary()]);
  const tpl = h('select', {}, templates.map((t) => h('option', { value: t.id }, t.name)));
  const name = h('input', { placeholder: 'Agent name' });
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'hide', onchange: async () => {
    const f = fileIn.files[0]; if (!f) return;
    const r = await tryApi(async () => api('POST', '/api/agents/import', JSON.parse(await f.text())), 'Imported');
    if (r) openAgent(r.id);
  } });
  const create = h('div', { class: 'card mut', style: 'margin-bottom:14px' }, h('h2', {}, 'New agent'),
    h('div', { class: 'row' }, tpl, name, h('button', { class: 'btn primary', onclick: async () => {
      const base = templates.find((t) => t.id === tpl.value);
      const r = await tryApi(() => api('POST', '/api/agents', { template: tpl.value, config: name.value.trim() ? { name: name.value.trim() } : {} }), `Created from “${base?.name}”`);
      if (r) openAgent(r.id);
    } }, 'Create'), h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Import…'), fileIn),
    h('div', { class: 'small muted', style: 'margin-top:6px' }, templates.find((t) => t.id === tpl.value)?.description || ''));
  tpl.onchange = () => { create.lastChild.textContent = templates.find((t) => t.id === tpl.value)?.description || ''; };
  const cards = agents.map((b) => h('div', { class: 'card' },
    h('div', { class: 'row spread nowrap', style: 'align-items:flex-start' }, h('div', { style: 'flex:1;min-width:0' }, h('h2', { style: 'margin:0' }, b.name), h('div', { class: 'small muted' }, b.description || b.id)),
      b.builtin ? null : toggle(b.enabled, (v) => tryApi(() => api('PUT', `/api/agents/${b.id}`, { enabled: v }), `${b.name} ${v ? 'on' : 'off'}`))),
    h('div', { class: 'row small', style: 'margin:10px 0' },
      h('span', { class: 'pill info' }, b.config.model === 'auto' ? 'model: auto' : b.config.model),
      b.builtin ? h('span', { class: 'pill ok' }, 'built in · your own chat') : [h('span', { class: 'pill' }, `${b.config.chats.length} chat(s)`), h('span', { class: 'pill' }, `${b.config.organizers.length} organizer(s)`)],
      Object.keys(b.config.mcpServers || {}).map((k) => h('span', { class: 'pill' }, `tools: ${k}`)),
      (b.globalTools || []).filter((g) => g.on).map((g) => h('span', { class: 'pill' }, `tools: ${g.name} (global)`)),
      b.config.confirm ? h('span', { class: 'pill warn' }, 'changes need confirm') : null,
      b.config.memory?.enabled !== false ? h('span', { class: 'pill ok' }, 'memory') : null),
    h('div', { class: 'small muted num' }, h('a', { href: '#usage' }, '30 days: '), usageLine(us?.agent?.[b.id])),
    b.needs.length ? h('div', { class: 'note warn' }, `Needs secrets: ${b.needs.join(', ')}`) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => openAgent(b.id) }, b.builtin ? (can('admin') ? 'Edit' : 'View') : can('admin') ? 'Edit & test' : 'View & test'))));
  const aiCreate = can('admin') ? await aiHelper({ title: [h('span', { class: 'ai-chip' }, 'AI'), 'Create an agent with AI'], applyLabel: 'Create this agent',
    placeholder: 'Describe the agent in your own words, e.g. “An assistant for our family festival group: answers agenda and menu questions from panduga, replies in English or Telugu, posts tomorrow’s agenda every evening at 8.”',
    onApply: async (r) => { const res = await tryApi(() => api('POST', '/api/agents', { config: r.proposed }), 'Agent created'); if (res) openAgent(res.id); } }) : null;
  $('#main').replaceChildren(aiCreate, create, agents.length ? h('div', { class: 'grid' }, cards) : h('p', { class: 'muted' }, 'No agents yet.'));
}

