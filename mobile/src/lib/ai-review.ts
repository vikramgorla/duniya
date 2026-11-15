// "Change with AI" review model (#63): the same reading of each proposed change as the panel's changeCard()
// (src/panel/public/index.html), without React: section, a plain headline and the kind of view to draw.
import { diffText, listChange, type ListItem, type TextDiff } from './diff.ts';
import type { ModelList } from './types.ts';

export const FIELD_LABEL: Record<string, string> = {
  name: 'Name', description: 'Description', prompt: 'Instructions', triggers: 'Triggers', respondToMentions: 'Reply when @mentioned', dm: 'Who may message it directly',
  organizers: 'Organizers', participants: 'Extra participants', mcpServers: 'Tool services', globalMcp: 'Global tool services', tools: 'Tool rules', confirm: 'Confirmation',
  schedules: 'Scheduled posts', memory: 'Group memory', model: 'Model', timezone: 'Timezone', historySize: 'Recent messages in context', maxTokens: 'Max reply tokens',
  plugins: 'Plugins', enabled: 'Enabled', media: 'Photos & voice',
};
// The editor's sections, in the editor's order: the review groups changes the same way.
const SECTIONS: [string, string[]][] = [['General', ['name', 'description', 'enabled', 'memory', 'respondToMentions', 'model', 'triggers', 'dm']], ['Instructions', ['prompt']],
  ['People & roles', ['organizers', 'participants']], ['Tool services', ['mcpServers', 'globalMcp', 'tools']], ['Photos & voice', ['media']], ['Changes need confirmation', ['confirm']],
  ['Scheduled posts', ['schedules']], ['Advanced', ['plugins', 'timezone', 'historySize', 'maxTokens']]];
const ORDER = SECTIONS.flatMap(([, f]) => f);
export const sectionOf = (f: string) => (SECTIONS.find(([, fs]) => fs.includes(f)) || ['Other'])[0];
const DM_LABEL: Record<string, string> = { none: 'Nobody', organizers: 'Organizers only', members: 'Members of its groups', anyone: 'Anyone' };
const DAY_LABEL: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export const daysLabel = (d: unknown) => (!d || d === 'daily' ? 'every day' : d === 'mon,tue,wed,thu,fri' ? 'weekdays' : d === 'sat,sun' ? 'weekends'
  : String(d).split(',').map((x) => DAY_LABEL[x.trim()] || x).join(', '));
export const trunc = (s: unknown, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface Ctx { names?: Record<string, string>; models?: ModelList | null }
type Any = any;

export function modelLabel(ref: unknown, models?: ModelList | null) {
  const r = String(ref || '');
  if (!r || r === 'auto') return 'Auto (default model)';
  if (r === 'inherit') return 'Same as the agent';
  const m = models?.models.find((x) => x.ref === r); if (m) return m.label;
  const i = r.indexOf(':'); const p = r.slice(0, i); const id = r.slice(i + 1);
  const pm = models?.models.find((x) => x.provider === p); const pl = pm ? pm.label.split(' · ')[0] : p;
  return id === 'auto' ? `${pl} · Auto` : `${pl} · ${id}`;
}
const personLabel = (p: unknown, names?: Record<string, string>) => { const d = String(p).replace(/\D/g, ''); return names?.[d] ? `${names[d]} (+${d})` : `+${d}`; };
export const ruleLabel = (r: unknown) => { const [srv, tool] = String(r).split(':'); if (!tool) return String(r); if (tool === '*') return `everything in ${srv}`; if (tool === '-') return `nothing from ${srv}`; return `${tool.replace(/\*/g, '…').replace(/_/g, ' ')} (${srv})`; };
const serverLabel = (k: string, s: Any) => { let host = ''; try { host = s?.url ? new URL(String(s.url).replace(/\$\{[^}]+\}/g, 'x')).host : ''; } catch { host = ''; } return host ? `${k} · ${host}` : s?.type === 'local' ? `${k} · on this server` : k; };
export const schedLabel = (s: Any) => `${s?.at || '?'} ${daysLabel(s?.days)}${s?.enabled === false ? ' (paused)' : ''} — ${trunc(s?.prompt, 70)}`;

/** One plain value as a short sentence part ("on", "Organizers only", "Claude Sonnet 5.5"). */
export function scalar(field: string, v: Any, ctx: Ctx = {}): string {
  if (field === 'model') return modelLabel(v, ctx.models);
  if (field === 'dm') return DM_LABEL[v] || String(v ?? '—');
  if (field === 'memory') return v?.enabled === false ? 'off' : 'on';
  if (field === 'confirm') return v ? `on (preview ${v.preview || '—'}, confirm with ${v.tool || '—'})` : 'off';
  if (field === 'media' && v) return [v.photos !== false && 'photos', v.documents !== false && 'PDFs', v.stickers && 'stickers', v.voiceNotes !== false && 'voice notes',
    `voice replies: ${({ never: 'never', voice: 'to voice notes', always: 'always' } as Record<string, string>)[v.voiceReply || 'never']}`,
    `pictures: ${[v.createImages?.organizer !== false && 'organizers', v.createImages?.participant && 'participants'].filter(Boolean).join(' + ') || 'nobody'}`].filter(Boolean).join(', ');
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (v == null || v === '') return '—';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** List-like fields as [{ k: key, l: readable label, v: value for "changed" checks }]. */
export const LISTS: Record<string, (v: Any, ctx: Ctx) => ListItem[]> = {
  triggers: (v) => (v || []).map((x: string) => ({ k: x, l: x })),
  plugins: (v) => (v || []).map((x: string) => ({ k: x, l: x })),
  organizers: (v, c) => (v || []).map((p: string) => ({ k: String(p).replace(/\D/g, ''), l: personLabel(p, c.names) })),
  participants: (v, c) => (v || []).map((p: string) => ({ k: String(p).replace(/\D/g, ''), l: personLabel(p, c.names) })),
  mcpServers: (v) => Object.entries(v || {}).map(([k, s]) => ({ k, l: serverLabel(k, s), v: s })),
  schedules: (v) => (v || []).map((s: Any) => ({ k: s.id || s.at, l: schedLabel(s), v: s })),
};

/** What changed in one scheduled post: "Time: 06:45 → 06:30 · Days: weekdays → every day". */
export function schedParts(a: Any, b: Any): { what: string; before: string; after: string }[] {
  const parts: [string, string, (v: Any) => string][] = [['at', 'Time', (v) => v || '—'], ['days', 'Days', daysLabel], ['enabled', 'Status', (v) => (v === false ? 'paused' : 'on')],
    ['chats', 'Chats', (v) => String(Array.isArray(v) ? v.length : v || 'all')]];
  return parts.filter(([k]) => JSON.stringify(a?.[k] ?? null) !== JSON.stringify(b?.[k] ?? null)).map(([k, what, f]) => ({ what, before: String(f(a?.[k])), after: String(f(b?.[k])) }));
}

export type ListView = ReturnType<typeof listChange> & { addedTitle: string; removedTitle: string };
export type ChangeView =
  | { kind: 'text'; field: string; section: string; label: string; head: string; diff: TextDiff; switcher: boolean; added: number; removed: number }
  | { kind: 'list'; field: string; section: string; label: string; head: string; list: ListView; added: 0; removed: 0 }
  | { kind: 'roles'; field: string; section: string; label: string; head: string; roles: { title: string; list: ListView }[]; added: 0; removed: 0 }
  | { kind: 'scalar'; field: string; section: string; label: string; head: string; before: string; after: string; added: 0; removed: 0 };

/** One proposed change as the friendliest view for its kind of field. */
export function changeView(ch: { field: string; before: unknown; after: unknown }, ctx: Ctx = {}): ChangeView {
  const label = FIELD_LABEL[ch.field] || ch.field; const section = sectionOf(ch.field); const field = ch.field;
  const b: Any = ch.before; const a: Any = ch.after;
  if (field === 'prompt' || field === 'description') {
    const diff = diffText(b || '', a || '');
    const head = !b ? `${label} written` : !a ? `${label} removed`
      : `${label}: ${[diff.added && `${plural(diff.added, 'word')} added`, diff.removed && `${diff.removed} removed`].filter(Boolean).join(', ') || 'spacing changed'}`;
    const long = /\n/.test(`${b || ''}${a || ''}`) || `${b || ''}${a || ''}`.length > 200;
    return { kind: 'text', field, section, label, head, diff, switcher: field === 'prompt' && long && !!b, added: diff.added, removed: diff.removed };
  }
  if (LISTS[field]) {
    const list = { ...listChange(LISTS[field](b, ctx), LISTS[field](a, ctx)), addedTitle: 'Added', removedTitle: 'Removed' };
    return { kind: 'list', field, section, label, head: `${label}: ${list.n}`, list, added: 0, removed: 0 };
  }
  if (field === 'globalMcp') {
    const list = { ...listChange(LISTS.plugins(b?.disabled, ctx), LISTS.plugins(a?.disabled, ctx)), addedTitle: 'Turned off', removedTitle: 'Turned on again' };
    return { kind: 'list', field, section, label, head: `${label}: ${list.n.replace('added', 'turned off').replace('removed', 'turned on')}`, list, added: 0, removed: 0 };
  }
  if (field === 'tools') {
    const roles = ([['participant', 'Participants may use'], ['organizer', 'Organizers may use'], ['deny', 'Never allowed']] as [string, string][]).map(([role, title]) => {
      const f = (v: Any): ListItem[] => (v?.[role] || []).map((x: string) => ({ k: x, l: ruleLabel(x) }));
      const x = f(b); const y = f(a);
      return JSON.stringify(x) === JSON.stringify(y) ? null : { title, list: { ...listChange(x, y), addedTitle: 'Added', removedTitle: 'Removed' } };
    }).filter((r): r is { title: string; list: ListView } => !!r);
    return { kind: 'roles', field, section, label, head: `${label}: ${roles.map((r) => r.title.split(' ')[0].toLowerCase()).join(', ')} changed`, roles, added: 0, removed: 0 };
  }
  return { kind: 'scalar', field, section, label, head: label, before: scalar(field, b, ctx), after: scalar(field, a, ctx), added: 0, removed: 0 };
}

/** The whole review: changes in the editor's order, "3 changes · 2 sections", word counts. */
export function review(changes: { field: string; before: unknown; after: unknown }[], ctx: Ctx = {}) {
  const views = [...changes].sort((x, y) => ORDER.indexOf(x.field) - ORDER.indexOf(y.field)).map((c) => changeView(c, ctx));
  const added = views.reduce((s, v) => s + v.added, 0); const removed = views.reduce((s, v) => s + v.removed, 0);
  const sections = new Set(views.map((v) => v.section)).size;
  return { views, added, removed, title: `${plural(views.length, 'change')} · ${plural(sections, 'section')}` };
}
