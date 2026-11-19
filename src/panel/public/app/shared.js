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
// ---------- money, days and numbers (085): one format on every screen, in the reader's locale ----------
/** Cents → "CHF 60.00" (or "€60.00", "₹1,200.00": the reader's locale decides). */
export const money = (cents, cur = 'CHF') => { const v = Number(cents || 0) / 100; try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(v); } catch { return `${cur} ${v.toFixed(2)}`; } };
const DAY = 86400000;
/** A calendar day ("2027-01-14" or a timestamp) → "14 Jan 2027" ("14 Jan" this year); `near`: "today", "tomorrow",
 *  "yesterday", "in 3 days", "3 days ago" within a week. */
export const day = (d, near = false) => {
  if (!d) return '';
  const at = typeof d === 'number' ? new Date(d) : new Date(`${String(d).slice(0, 10)}T12:00`);
  if (Number.isNaN(at.getTime())) return String(d);
  const n = Math.round((new Date(at).setHours(12, 0, 0, 0) - new Date().setHours(12, 0, 0, 0)) / DAY);
  if (near && Math.abs(n) < 7) return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
const CC2 = new Set('20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' '));
/** Digits of a phone number → "+41 79 000 00 01", "+91 98765 43210", "+1 415 555 0100"; others in groups of three. */
export const phone = (digits) => {
  const d = String(digits || '').replace(/\D/g, ''); if (!d) return '';
  const cc = /^[17]/.test(d) ? d.slice(0, 1) : CC2.has(d.slice(0, 2)) ? d.slice(0, 2) : d.slice(0, 3);
  const r = d.slice(cc.length);
  const sizes = cc === '41' && r.length === 9 ? [2, 3, 2, 2] : cc === '91' && r.length === 10 ? [5, 5] : cc === '1' && r.length === 10 ? [3, 3, 4] : null;
  const parts = []; let i = 0;
  if (sizes) for (const s of sizes) { parts.push(r.slice(i, i + s)); i += s; } else { while (r.length - i > 4) { parts.push(r.slice(i, i + 3)); i += 3; } parts.push(r.slice(i)); }
  return `+${cc} ${parts.filter(Boolean).join(' ')}`;
};
export const trunc = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** The guides on GitHub, and a small "?" that opens one (068: details live there, not in long help paragraphs). */
// 084: the repository from the shell's <meta> (package.json), never a literal
export const repoFile = (path, ref = 'main') => `${document.querySelector('meta[name=duniya-repo]')?.content}/blob/${ref}/${path}`;
export const docsUrl = (path) => repoFile(`docs/${path}`);
export const helpLink = (path, label = 'Help: open the guide') => h('a', { class: 'help', href: docsUrl(path), target: '_blank', rel: 'noopener', 'aria-label': label, title: label }, '?');
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
  ['whatsapp', 'WhatsApp', 'channels numbers qr code link phone pairing unlink add number memory switch off'],
  ['tool-services', 'Tool services for all agents', 'mcp tools weather calendar registry browse'],
  ['owner-assistant', 'Owner assistant', 'my own chat alerts weekly summary character'],
  ['direct-messages', 'Chats & direct messages', 'dm default agent history load earlier messages phone'],
  ['privacy-notice', 'Privacy notice', 'notice group members opt-out'],
  ['photos-voice', 'Photos & voice', 'images voice notes transcription speech pictures'],
  ['modules', 'Modules', 'events registrations orders payments price list waiting list duties'],
  ['sending-pace', 'Sending pace', 'read receipts blue ticks typing speed gaps daily cap new chats quiet hours warm-up'],
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
  ['updates', 'Updates', 'update upgrade version automatic install check restart backup before update'],
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
