// Agents screen: the list, templates and the AI draft of a new agent. Module of the panel (063).
import { renderAgentEditor } from './agent-editor.js';
import { aiHelper } from './ai-helper.js';
import { $, api, avatar, can, emptyState, h, plural, toggle, tryApi } from './core.js';
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
  // 064: an avatar per agent, its state in a few calm tags (plural that reads well), one clear action
  const toolsOf = (b) => [...Object.keys(b.config.mcpServers || {}), ...(b.globalTools || []).filter((g) => g.on).map((g) => g.name)];
  const cards = agents.map((b) => h('div', { class: 'card agent-card' },
    h('div', { class: 'row spread nowrap', style: 'align-items:flex-start' },
      h('div', { class: 'who-line' }, avatar(b.name, b.id, `l${b.enabled || b.builtin ? '' : ' off'}`), h('div', {}, h('h2', {}, b.name), h('div', { class: 'small muted' }, b.builtin ? 'Built in' : b.enabled ? 'On' : 'Off'))),
      b.builtin ? null : toggle(b.enabled, (v) => tryApi(() => api('PUT', `/api/agents/${b.id}`, { enabled: v }), `${b.name} ${v ? 'on' : 'off'}`), false, `${b.name} on`)),
    b.description ? h('div', { class: 'small muted' }, b.description) : null,
    h('div', { class: 'tags' },
      b.config.model === 'auto' ? h('span', { class: 'pill info' }, 'Auto model') : h('span', { class: 'pill info raw', title: `Model: ${b.config.model}` }, b.config.model.slice(b.config.model.indexOf(':') + 1)),
      b.builtin ? null : [h('span', { class: 'pill' }, plural(b.config.chats.length, 'chat')), h('span', { class: 'pill' }, plural(b.config.organizers.length, 'organizer'))],
      toolsOf(b).length ? h('span', { class: 'pill', style: 'white-space:normal' }, `Tools: ${toolsOf(b).join(', ')}`) : null,
      b.config.confirm ? h('span', { class: 'pill warn' }, 'Changes need confirm') : null,
      b.config.memory?.enabled !== false ? h('span', { class: 'pill ok' }, 'Memory') : null),
    b.needs.length ? h('div', { class: 'note warn' }, `Needs secrets: ${b.needs.join(', ')}`) : null,
    h('div', { class: 'foot' }, h('div', { class: 'small muted num' }, h('a', { href: '#usage' }, '30 days'), ': ', usageLine(us?.agent?.[b.id])),
      h('button', { class: 'btn small', onclick: () => openAgent(b.id), 'aria-label': `${b.builtin ? (can('admin') ? 'Edit' : 'View') : can('admin') ? 'Edit & test' : 'View & test'} ${b.name}` }, b.builtin ? (can('admin') ? 'Edit' : 'View') : can('admin') ? 'Edit & test' : 'View & test'))));
  const aiCreate = can('admin') ? await aiHelper({ title: [h('span', { class: 'ai-chip' }, 'AI'), 'Create an agent with AI'], applyLabel: 'Create this agent',
    placeholder: 'Describe the agent in your own words, e.g. “An assistant for our family festival group: answers agenda and menu questions from panduga, replies in English or Telugu, posts tomorrow’s agenda every evening at 8.”',
    onApply: async (r) => { const res = await tryApi(() => api('POST', '/api/agents', { config: r.proposed }), 'Agent created'); if (res) openAgent(res.id); } }) : null;
  $('#main').replaceChildren(aiCreate, create, agents.length ? h('div', { class: 'grid' }, cards) : h('div', { class: 'card' }, emptyState('agents', 'No agents yet', 'Describe one above and let AI draft it, or start from a template.')));
}

