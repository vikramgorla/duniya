// Small helpers several screens share (formatting, models, usage, server size, links). Loaded with Overview.
import { $, S, api, h } from './core.js';
export const loadModels = async (refresh) => (S.models = !refresh && S.models ? S.models : await api('GET', `/api/models${refresh ? '?refresh=1' : ''}`));
/** Model picker: Auto (any provider), "<provider> · Auto", or a specific model, grouped by provider.
 *  withInherit adds "Same as the agent" (per chat). */
export function modelSelect(models, value, { withInherit = false, autoLabel = 'Auto (best connected model)', ...attrs } = {}) {
  const groups = new Map();
  for (const m of models.models) { if (!groups.has(m.provider)) groups.set(m.provider, []); groups.get(m.provider).push(m); }
  const known = new Set(['inherit', 'auto', ...models.models.map((m) => m.ref), ...[...groups.keys()].map((p) => `${p}:auto`)]);
  return h('select', attrs,
    withInherit ? h('option', { value: 'inherit', selected: value === 'inherit' }, 'Same as the agent') : null,
    h('option', { value: 'auto', selected: value === 'auto' }, autoLabel),
    [...groups].map(([prov, list]) => h('optgroup', { label: list[0].label.split(' · ')[0] },
      h('option', { value: `${prov}:auto`, selected: value === `${prov}:auto` }, `${list[0].label.split(' · ')[0]} · Auto`),
      list.map((m) => h('option', { value: m.ref, selected: value === m.ref }, m.label.split(' · ').slice(1).join(' · ') || m.ref)))),
    value && !known.has(value) ? h('option', { value, selected: true }, `${value} (not available)`) : null);
}
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const trunc = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** The guides on GitHub, and a small "?" that opens one (068: details live there, not in long help paragraphs). */
export const DOCS = 'https://github.com/vikramgorla/whatsapp-agent-duniya/blob/main/docs/';
export const helpLink = (path, label = 'Help: open the guide') => h('a', { class: 'help', href: DOCS + path, target: '_blank', rel: 'noopener', 'aria-label': label, title: label }, '?');
// ---------- models ----------
export const LINKS = {
  anthropicKeys: 'https://platform.claude.com/settings/keys',
  claudeCodeSetup: 'https://code.claude.com/docs/en/setup',
  openaiKeys: 'https://platform.openai.com/api-keys',
  openrouterKeys: 'https://openrouter.ai/settings/keys',
  openrouterFree: 'https://openrouter.ai/models?max_price=0',
  githubSignup: 'https://github.com/signup',
  copilotToken: 'https://github.com/settings/personal-access-tokens/new?name=duniya&description=Copilot+for+duniya&expires_in=90&copilot_requests=write',
};
export const saveSecretKey = (name) => async (value) => { await api('PUT', '/api/secrets', { name, value }); await api('GET', '/api/providers?refresh=1'); S.models = null; };
// ---------- settings ----------
/** 062: Settings sections in page order: [id, title, words people search for]. The index at the top of Settings and the
 *  Find box (/ or ⌘K) both use it; each card carries data-jump="<id>" (#settings/<id> opens it). */
export const SETTINGS_SECTIONS = [
  ['tool-services', 'Tool services for all agents', 'mcp tools weather calendar registry browse'],
  ['owner-assistant', 'Owner assistant', 'my own chat alerts weekly summary character'],
  ['direct-messages', 'Chats & direct messages', 'dm default agent history load earlier messages phone'],
  ['privacy-notice', 'Privacy notice', 'notice group members opt-out'],
  ['photos-voice', 'Photos & voice', 'images voice notes transcription speech pictures'],
  ['secrets', 'Secrets', 'keys tokens api key password'],
  ['users', 'Users', 'people admin viewer invite sign-up link'],
  ['sign-in', 'Sign-in', 'password login google only'],
  ['google', 'Sign in with Google', 'google oauth client'],
  ['web-access', 'Web address & access', 'domain https proxy ip allow-list certificate'],
  ['assistants', 'Connected AI assistants', 'chatgpt claude mcp admin'],
  ['password', 'Your password', 'change password account'],
  ['my-google', 'Your Google account', 'google link'],
  ['logging', 'Activity log', 'logging retention verbose minimal'],
  ['small-mode', 'Server size', 'small server mode 1 gb memory'],
  ['getting-started', 'Getting started', 'checklist first run setup guide'],
  ['whatsapp-helpers', 'WhatsApp helpers', 'groupid groups commands'],
  ['release-notes', 'Release notes', "what's new whats changelog changes version update"],
];
export const meter = (p) => h('div', { class: `meter ${p >= 85 ? 'hot' : ''}` }, h('i', { style: `width:${Math.min(100, p)}%` }));
// ---------- server (011) ----------
export const bytes = (n) => { if (n == null) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`; };
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
// ---------- usage & cost (023) ----------
export const fmtTok = (n) => (!n ? '0' : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));
export const fmtCost = (c) => (c == null ? '—' : c === 0 ? '$0' : c < 0.01 ? '<$0.01' : `$${c < 10 ? c.toFixed(2) : Math.round(c)}`);
export const usageLine = (u) => (u ? `${fmtTok(u.input + u.output)} tokens · ${u.unpriced && !u.cost ? 'price not set' : fmtCost(u.cost)}${u.unpriced && u.cost ? '+' : ''}` : 'no use yet');
// Small servers (043): one line about what this server can take, and the media queue when something waits.
export const SIZE_LABEL = { small: 'Small server', medium: 'Medium server', large: 'Large server' };
/** 055: small servers do not run local (on-server) tool services unless Small server mode is on. */
export const smallServer = () => S.status?.server?.size === 'small' && !S.status?.server?.smallMode;
export const SMALL_MODE_LINK = () => h('a', { href: '#settings', onclick: () => setTimeout(() => $('#small-mode')?.scrollIntoView({ block: 'center' }), 400) }, 'Small server mode in Settings → Server');
export function openAgent(id) { location.hash = `agents/${encodeURIComponent(id)}`; }
export function modelLabel(ref, models) {
  if (!ref || ref === 'auto') return 'Auto (default model)';
  const m = (models?.models || []).find((x) => x.ref === ref); if (m) return m.label;
  const i = String(ref).indexOf(':'); const p = ref.slice(0, i); const id = ref.slice(i + 1);
  const pm = (models?.models || []).find((x) => x.provider === p); const pl = pm ? pm.label.split(' · ')[0] : p;
  return id === 'auto' ? `${pl} · Auto` : `${pl} · ${id}`;
}
export const quietLine = (s) => `Quiet: ${s.label} ×${s.count}`;
