// The AI helper (016): describe a change, review it as a friendly diff, apply it. Module of the panel (063).
import * as D from './diff.js';
import { api, ask as askDialog, h, toast, tryApi } from './core.js';
import { loadModels, modelLabel, modelSelect, plural, trunc } from './shared.js';
// ---------- AI helper (016) ----------
const FIELD_LABEL = { name: 'Name', description: 'Description', prompt: 'Instructions', triggers: 'Triggers', respondToMentions: 'Reply when @mentioned', groupReplies: 'In groups', dm: 'Who may message it directly',
  organizers: 'Organizers', participants: 'Extra participants', mcpServers: 'Tool services', globalMcp: 'Global tool services', tools: 'Tool rules', confirm: 'Confirmation', schedules: 'Schedules', memory: 'Memory',
  model: 'Model', timezone: 'Time zone', historySize: 'Recent messages in context', maxTokens: 'Max reply tokens', enabled: 'Enabled', media: 'Photos & voice',
  quickReplies: 'Quick replies', help: '!help list', welcome: 'Welcome message', faq: 'FAQ auto-answers' };
// The agent page's sections (068), in its order: the review groups changes the same way.
const AI_SECTIONS = [['Character', ['name', 'description', 'prompt']], ['Where it answers', ['enabled', 'triggers', 'respondToMentions', 'groupReplies', 'dm']], ['People', ['organizers', 'participants']],
  ['Quick replies & FAQ', ['quickReplies', 'help', 'faq']], ['Welcome', ['welcome']], ['Schedules', ['schedules']], ['Model', ['model']],
  ['Tools', ['mcpServers', 'globalMcp', 'tools', 'confirm']], ['Memory', ['memory']], ['Photos & voice', ['media']], ['Advanced', ['timezone', 'historySize', 'maxTokens']]];
const AI_ORDER = AI_SECTIONS.flatMap(([, f]) => f);
const sectionOf = (f) => (AI_SECTIONS.find(([, fs]) => fs.includes(f)) || ['Other'])[0];
const DM_LABEL = { none: 'Nobody', organizers: 'Organizers only', members: 'Members of its groups', anyone: 'Anyone' };
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const daysLabel = (d) => (!d || d === 'daily' ? 'every day' : d === 'mon,tue,wed,thu,fri' ? 'weekdays' : d === 'sat,sun' ? 'weekends' : String(d).split(',').map((x) => DAY_LABEL[x.trim()] || x).join(', '));
const personLabel = (p, names) => { const d = String(p).replace(/\D/g, ''); return names?.[d] ? `${names[d]} (+${d})` : `+${d}`; };
const ruleLabel = (r) => { const [srv, tool] = String(r).split(':'); if (!tool) return String(r); if (tool === '*') return `everything in ${srv}`; if (tool === '-') return `nothing from ${srv}`; return `${tool.replace(/\*/g, '…').replace(/_/g, ' ')} (${srv})`; };
const serverLabel = (k, s) => { let host; try { host = s?.url ? new URL(s.url.replace(/\$\{[^}]+\}/g, 'x')).host : ''; } catch { host = ''; } return host ? `${k} · ${host}` : s?.type === 'local' ? `${k} · on this server` : k; };
const schedLabel = (s) => `${s.at || '?'} ${daysLabel(s.days)}${s.enabled === false ? ' (paused)' : ''} — ${trunc(s.prompt, 70)}`;
/** One plain value as a short sentence part ("on", "Organizers only", "Claude Sonnet 5.5"). */
function aiScalar(field, v, ctx) {
  if (field === 'model') return modelLabel(v, ctx.models);
  if (field === 'dm') return DM_LABEL[v] || String(v ?? '—');
  if (field === 'memory') return v?.enabled === false ? 'off' : 'on';
  if (field === 'welcome') return v?.enabled ? `on — “${trunc(v.text || 'Welcome {name} to {group}! 👋', 60)}”${v.rules ? ' + rules' : ''}` : 'off';
  if (field === 'confirm') return v ? `on (preview ${v.preview || '—'}, confirm with ${v.tool || '—'})` : 'off';
  if (field === 'media' && v) return [v.photos !== false && 'photos', v.documents !== false && 'PDFs', v.stickers && 'stickers', v.voiceNotes !== false && 'voice notes',
    `voice replies: ${({ never: 'never', voice: 'to voice notes', always: 'always' })[v.voiceReply || 'never']}`, `pictures: ${[v.createImages?.organizer !== false && 'organizers', v.createImages?.participant && 'participants'].filter(Boolean).join(' + ') || 'nobody'}`].filter(Boolean).join(', ');
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (v == null || v === '') return '—';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
/** List-like fields as [{ k: key, l: readable label, v: value for "changed" checks }]. */
const AI_LISTS = {
  triggers: (v) => (v || []).map((x) => ({ k: x, l: x })),
  names: (v) => (v || []).map((x) => ({ k: x, l: x })),
  quickReplies: (v) => (v || []).map((q) => ({ k: q.command, l: `${q.command}${q.who === 'organizers' ? ' (organizers)' : ''} → ${trunc(q.text, 70)}`, v: q })),
  faq: (v) => [...(v?.items || []).map((it) => ({ k: (it.questions?.[0] || (it.keywords || []).join(', ')).toLowerCase(), l: `${trunc(it.questions?.[0] || (it.keywords || []).join(', '), 50)} → ${trunc(it.answer, 50)}`, v: it })),
    ...(v ? [{ k: '~match', l: `Match: ${v.strictness === 'strict' ? 'strict' : 'normal'}${v.wholeGroup ? ', in the whole group' : ', when addressed'}`, v: [v.strictness, !!v.wholeGroup] }] : [])],
  organizers: (v, c) => (v || []).map((p) => ({ k: String(p).replace(/\D/g, ''), l: personLabel(p, c.names) })),
  participants: (v, c) => (v || []).map((p) => ({ k: String(p).replace(/\D/g, ''), l: personLabel(p, c.names) })),
  mcpServers: (v) => Object.entries(v || {}).map(([k, s]) => ({ k, l: serverLabel(k, s), v: s })),
  schedules: (v) => (v || []).map((s) => ({ k: s.id || s.at, l: schedLabel(s), v: s })),
};
const segNode = (s) => (s.newline ? null : s.type === 'add' ? h('ins', {}, s.text) : s.type === 'del' ? (s.text.trim() ? h('del', {}, s.text) : null) : s.text);
function diffLine(segs) {
  const add = segs.some((s) => s.type === 'add' && s.text.trim()); const del = segs.some((s) => s.type === 'del' && s.text.trim());
  const mark = add && del ? '±' : add ? '+' : del ? '−' : '';
  return h('div', { class: `dl${add && !del ? ' a' : ''}${del && !add ? ' d' : ''}${add && del ? ' m' : ''}` }, h('i', { 'aria-hidden': 'true' }, mark), h('span', {}, segs.map(segNode), '​'));
}
/** Lines with folded unchanged stretches ("… 12 unchanged lines …", tap to show). keep(seg) filters a side. */
function diffBlocks(blocks, keep = () => true) {
  return blocks.map((b) => {
    const rows = b.lines.map((l) => l.filter(keep)).filter((l, i) => l.length || !b.lines[i].length);
    if (b.type === 'lines') return rows.map(diffLine);
    const btn = h('button', { type: 'button', class: 'dskip', onclick: () => btn.replaceWith(...rows.map(diffLine)) }, `… ${plural(rows.length, 'unchanged line')} …`);
    return btn;
  });
}
/** Inline word diff of a text field with a view switch: Changes only / Side by side / Whole new text. */
function textDiffView(before, after, { switcher = true } = {}) {
  const d = D.diffText(before, after);
  const blocks = D.hunks(d.ops, { context: 2 });
  const body = h('div', {});
  const views = {
    changes: () => h('div', { class: 'dtext' }, diffBlocks(blocks)),
    side: () => h('div', { class: 'dside' },
      h('div', {}, h('div', { class: 'eyebrow' }, '− Before'), h('div', { class: 'dtext' }, diffBlocks(blocks, (s) => s.type !== 'add'))),
      h('div', {}, h('div', { class: 'eyebrow' }, '+ After'), h('div', { class: 'dtext' }, diffBlocks(blocks, (s) => s.type !== 'del')))),
    whole: () => h('div', { class: 'dtext' }, D.hunks(d.ops.filter((o) => o.type !== 'del'), { context: 1e9 }).flatMap((b) => b.lines.map(diffLine))),
  };
  let mode = 'changes';
  const seg = h('div', { class: 'seg dseg', role: 'group', 'aria-label': 'How to show the changes' }, [['changes', 'Changes only'], ['side', 'Side by side'], ['whole', 'Whole new text']].map(([v, l]) =>
    h('button', { type: 'button', class: v === mode ? 'on' : '', 'aria-pressed': String(v === mode), onclick: (e) => {
      mode = v; seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); }); body.replaceChildren(views[mode]());
    } }, l)));
  body.replaceChildren(views.changes());
  const long = /\n/.test(`${before}${after}`) || `${before}${after}`.length > 200;
  return { el: h('div', {}, switcher && long && before ? seg : null, body), added: d.added, removed: d.removed };
}
const chipRow = (title, items, cls) => (items.length ? h('div', { class: 'dchips' }, h('span', { class: 'dgl' }, title),
  items.map((x) => h(cls === 'add' ? 'ins' : 'del', { class: 'dchip' }, h('span', { 'aria-hidden': 'true' }, cls === 'add' ? '+ ' : '− '), x))) : null);
function listDiffView(before, after, { added = 'Added', removed = 'Removed', describe = null } = {}) {
  const r = D.diffList(before, after, (x) => x.k);
  const changed = r.kept.filter((x) => { const old = before.find((y) => y.k === x.k); return JSON.stringify(old?.v ?? null) !== JSON.stringify(x.v ?? null); });
  const same = r.kept.filter((x) => !changed.includes(x));
  return {
    el: h('div', {}, chipRow(added, r.added.map((x) => x.l), 'add'), chipRow(removed, r.removed.map((x) => x.l), 'del'),
      changed.map((x) => { const old = before.find((y) => y.k === x.k); return h('div', { class: 'dsent' }, h('span', { class: 'dgl' }, '± Changed'), describe ? describe(old.v, x.v) : [h('del', {}, old.l), ' → ', h('ins', {}, x.l)]); }),
      same.length ? h('div', { class: 'small muted' }, `${same.length} unchanged: ${trunc(same.map((x) => x.l).join(', '), 120)}`) : null),
    n: [r.added.length && `${r.added.length} added`, r.removed.length && `${r.removed.length} removed`, changed.length && `${changed.length} changed`].filter(Boolean).join(', ') || 'reordered',
  };
}
/** What changed in one scheduled post, in short sentences: "“Post today's rides…” · Time: 06:45 → 06:30". */
function schedChange(a, b) {
  const parts = [['at', 'Time', (v) => v || '—'], ['days', 'Days', daysLabel], ['enabled', 'Status', (v) => (v === false ? 'paused' : 'on')], ['chats', 'Chats', (v) => (Array.isArray(v) ? v.length : v || 'all')]]
    .filter(([k]) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null))
    .map(([k, t, f], i) => [i ? ' · ' : '', `${t}: `, h('del', {}, String(f(a?.[k]))), ' → ', h('ins', {}, String(f(b?.[k])))]);
  return h('span', {}, `“${trunc(b?.prompt, 50)}” `, parts, a?.prompt !== b?.prompt ? h('div', { style: 'margin-top:6px' }, textDiffView(a?.prompt || '', b?.prompt || '', { switcher: false }).el) : null);
}
/** One change as a card: a plain label, and the friendliest view for the kind of field. */
function changeCard(ch, ctx) {
  const label = FIELD_LABEL[ch.field] || ch.field;
  let head; let body = null; let added = 0; let removed = 0;
  if (ch.field === 'prompt' || ch.field === 'description') {
    const v = textDiffView(ch.before || '', ch.after || '', { switcher: ch.field === 'prompt' });
    ({ added, removed } = v); body = v.el;
    head = !ch.before ? `${label} written` : !ch.after ? `${label} removed` : `${label}: ${[added && `${plural(added, 'word')} added`, removed && `${removed} removed`].filter(Boolean).join(', ') || 'spacing changed'}`;
  } else if (AI_LISTS[ch.field]) {
    const v = listDiffView(AI_LISTS[ch.field](ch.before, ctx), AI_LISTS[ch.field](ch.after, ctx), { describe: ch.field === 'schedules' ? schedChange : null }); body = v.el; head = `${label}: ${v.n}`;
  } else if (ch.field === 'globalMcp') {
    const v = listDiffView(AI_LISTS.names(ch.before?.disabled), AI_LISTS.names(ch.after?.disabled), { added: 'Turned off', removed: 'Turned on again' }); body = v.el; head = `${label}: ${v.n.replace('added', 'turned off').replace('removed', 'turned on')}`;
  } else if (ch.field === 'tools') {
    const roles = [['participant', 'Participants may use'], ['organizer', 'Organizers may use'], ['deny', 'Never allowed']];
    const parts = roles.map(([role, t]) => { const f = (v) => (v?.[role] || []).map((x) => ({ k: x, l: ruleLabel(x) })); const a = f(ch.before); const b = f(ch.after);
      return JSON.stringify(a) === JSON.stringify(b) ? null : [t, listDiffView(a, b)]; }).filter(Boolean);
    body = parts.map(([t, v]) => h('div', { class: 'drole' }, h('div', { class: 'eyebrow' }, t), v.el)); head = `${label}: ${parts.map(([t]) => t.split(' ')[0].toLowerCase()).join(', ')} changed`;
  } else {
    head = h('span', {}, `${label}: `, h('del', {}, aiScalar(ch.field, ch.before, ctx)), ' → ', h('ins', {}, aiScalar(ch.field, ch.after, ctx)));
  }
  return { added, removed, el: h('details', { class: 'dcard', open: true },
    h('summary', {}, h('span', { class: 'eyebrow' }, sectionOf(ch.field)), h('b', {}, head)), body ? h('div', { class: 'dbody' }, body) : null) };
}
/** Review of proposed edits: "3 changes · 2 sections · +40 words −12 words", then one card per change. */
function changesReview(r, ctx) {
  const changes = [...r.changes].sort((a, b) => AI_ORDER.indexOf(a.field) - AI_ORDER.indexOf(b.field));
  const cards = changes.map((ch) => changeCard(ch, ctx));
  const words = cards.reduce((s, c) => ({ a: s.a + c.added, d: s.d + c.removed }), { a: 0, d: 0 });
  const sections = new Set(changes.map((c) => sectionOf(c.field))).size;
  return h('div', { class: 'dreview' },
    h('div', { class: 'dsum' }, h('b', {}, `${plural(changes.length, 'change')} · ${plural(sections, 'section')}`),
      words.a ? h('ins', { class: 'dcount' }, `+${plural(words.a, 'word')}`) : null, words.d ? h('del', { class: 'dcount' }, `−${plural(words.d, 'word')}`) : null),
    cards.map((c) => c.el));
}
/** A clean summary of a brand-new agent (create with AI): what it is, then only what differs from the defaults. */
function newAgentReview(r, ctx) {
  const p = r.proposed || {};
  const rows = [...r.changes].filter((c) => !['name', 'description'].includes(c.field)).sort((a, b) => AI_ORDER.indexOf(a.field) - AI_ORDER.indexOf(b.field)).map((ch) => {
    let v;
    if (ch.field === 'prompt') {
      const lines = String(ch.after || '').split('\n'); const box = h('div', { class: 'dtext dplain' }, lines.slice(0, 10).join('\n'));
      v = h('div', {}, box, lines.length > 10 ? h('button', { type: 'button', class: 'dskip', onclick: (e) => { box.textContent = ch.after; e.currentTarget.remove(); } }, `Show all ${lines.length} lines`) : null);
    } else if (AI_LISTS[ch.field]) {
      const items = AI_LISTS[ch.field](ch.after, ctx);
      v = ch.field === 'schedules' ? h('ul', { class: 'dlist' }, items.map((x) => h('li', {}, x.l))) : h('div', { class: 'dchips' }, items.length ? items.map((x) => h('span', { class: 'dchip n' }, x.l)) : h('span', { class: 'muted' }, 'none'));
    } else if (ch.field === 'tools') {
      v = h('div', {}, [['participant', 'Participants'], ['organizer', 'Organizers'], ['deny', 'Never']].filter(([k]) => ch.after?.[k]?.length).map(([k, t]) => h('div', { class: 'dchips' }, h('span', { class: 'dgl' }, t), ch.after[k].map((x) => h('span', { class: 'dchip n' }, ruleLabel(x))))));
    } else if (ch.field === 'globalMcp') v = `Turned off: ${(ch.after?.disabled || []).join(', ') || 'none'}`;
    else v = aiScalar(ch.field, ch.after, ctx);
    return h('div', { class: 'drow' }, h('div', { class: 'eyebrow' }, FIELD_LABEL[ch.field] || ch.field), h('div', {}, v));
  });
  return h('div', { class: 'dnew' }, h('div', { class: 'eyebrow' }, h('span', { class: 'ai-chip' }, 'NEW'), ' New agent'),
    h('h3', {}, p.name || 'New agent'), p.description ? h('p', { class: 'muted', style: 'margin:0 0 6px' }, p.description) : null,
    rows, h('p', { class: 'small muted' }, 'Everything else uses the defaults; you can change any of it in the editor afterwards.'));
}
/** "Describe it → AI drafts → review the changes → apply". onApply(result) does the saving. */
export async function aiHelper({ agentId = '', title, placeholder, applyLabel, onApply, bare = false, initial = '' }) {
  const models = await loadModels().catch(() => ({ models: [] }));
  const ask = h('textarea', { class: 'prose', style: 'min-height:90px', placeholder, value: initial, 'aria-label': 'What you want, in your own words' });
  // 070: Teach pre-fills the request; the cursor waits at the end ("Better answer: ")
  if (initial) setTimeout(() => { ask.focus(); ask.setSelectionRange(initial.length, initial.length); }, 50);
  const model = modelSelect(models, 'auto', { 'aria-label': 'Model for the AI helper', autoLabel: `Default model${models.resolvedDefault ? ` (${modelLabel(models.resolvedDefault, models)})` : ''}` });
  const out = h('div', {});
  const go = h('button', { class: 'btn primary', onclick: async () => {
    go.disabled = true; out.replaceChildren(h('p', { class: 'muted small' }, h('span', { class: 'spinner' }), ' Thinking… this can take up to a minute.'));
    try {
      const r = await api('POST', '/api/ai/agent-draft', { agentId, request: ask.value, model: model.value });
      const ctx = { names: r.names || {}, models };
      out.replaceChildren(
        h('div', { class: 'note ok' }, h('b', {}, 'Draft ready · '), r.summary || plural(r.changes.length, 'change')),
        r.questions?.length ? h('div', { class: 'note' }, h('b', {}, 'The AI asks: '), r.questions.join(' ')) : null,
        !r.changes.length ? h('p', { class: 'muted small' }, 'No changes were needed.') : agentId ? changesReview(r, ctx) : newAgentReview(r, ctx),
        h('p', { class: 'small muted' }, `Drafted with ${r.model}. Nothing is saved until you apply.`),
        h('div', { class: 'row' }, r.changes.length ? h('button', { class: 'btn primary', onclick: () => onApply(r) }, applyLabel) : null,
          h('button', { class: 'btn', onclick: () => out.replaceChildren() }, 'Discard')));
    } catch (e) { out.replaceChildren(h('div', { class: 'note bad' }, e.message)); }
    go.disabled = false;
  } }, 'Draft');
  const parts = [ask, h('div', { class: 'row', style: 'margin-top:8px' }, h('div', { style: 'flex:2' }, model), go), out];
  return bare ? h('div', {}, parts) : h('div', { class: 'card', style: 'margin-bottom:16px' }, h('h2', {}, title), parts);
}

/**
 * "Change with AI" for one agent (068, 072): the helper in a dialog (a sheet on phones). `save(patch)` saves the applied
 * changes and returns true; without one the change is saved here with Undo in the toast (Teach from a chat's messages
 * or Activity, away from the agent's page).
 */
export async function changeWithAi(agentId, initial = '', save = null) {
  const enc = encodeURIComponent(agentId);
  const keep = save || (async (patch) => {
    const before = (await api('GET', `/api/agents/${enc}`)).config;
    if (!await tryApi(() => api('PUT', `/api/agents/${enc}`, patch))) return false;
    toast('Saved', { undo: () => tryApi(() => api('PUT', `/api/agents/${enc}`, Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null]))), 'Undone') });
    return true;
  });
  const helper = await aiHelper({ agentId, bare: true, applyLabel: 'Apply & save', initial,
    placeholder: 'What should change? e.g. “Shorter, friendlier replies”, “Make Anu and Ravi organizers”, “Post a menu reminder every Saturday at 9”.',
    onApply: async (r) => { if (await keep(Object.fromEntries(r.changes.map((ch) => [ch.field, ch.after])))) helper.closest('dialog')?.close(); } });
  askDialog({ title: 'Change with AI', body: helper, ok: null, cancel: 'Close', wide: true });
}
