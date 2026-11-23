// Agents → one agent's page (068): a compact header (avatar, name, state, switch, ⋯) and a short list of sections, each
// a row with its current value that opens the section's own page (#agents/<id>/<section>). Every section saves on its
// own: one Save, disabled until something changed, then "Saved" and Undo in the toast. Module of the panel (063).
import { changeWithAi as changeWithAiDialog } from './ai-helper.js';
import { answerActions } from './answers.js';
import { messageMedia, wordsBeside } from './media.js';
import { askCard } from './ask.js';
import { peoplePicker, tagInput } from './tags.js';
import { S, api, ask, avatar, can, field, fieldError, h, icon, lines, menu, partFailed, splitLines, tagPill, time, toast, toggle, tryApi, whoLabel } from './core.js';
import { fallbackLine, fallbackPicker } from './fallback.js';
import { browseButton } from './registry.js';
import { helpLink, loadModels, modelLabel, modelSelect, openAgent, plural, trunc, usageLine } from './shared.js';
import { ROLE_LABEL, behaviourEditor, globRe, markSaved, seg, serverConfig, serverState, toolGrid, toolServiceEditor } from './tool-editor.js';
import { capEditor, usageSummary } from './usage.js';

const DM_LABEL = { members: 'Members of its groups', organizers: 'Organizers only', anyone: 'Anyone', none: 'Nobody' };
// 079: which people an agent's People tools and sender cards may see
const PEOPLE_SHORT = { own: 'sees its chats’ people', everyone: 'sees everyone in People', off: 'no People access' };
const PEOPLE_ACCESS = { own: 'Its own chats (default)', everyone: 'Everyone in People', off: 'Nobody' };
// 093: how sure an agent must be before changing things (value, label, one line)
const AUTONOMY = [['ask', 'Ask first', 'Shows the change and waits for a yes.'], ['clear', 'Act on clear requests', 'An organizer’s clear request is the go-ahead; it says what changed.'],
  ['act', 'Act and report', 'Also makes changes that clearly follow; reports each one.']];
const autonomyLabel = (v) => (AUTONOMY.find((a) => a[0] === v) || AUTONOMY[1])[1];
// 076: how an agent answers in groups
const GROUP_REPLIES = { followups: 'When woken + follow-ups', wake: 'Only when woken', auto: 'Whenever needed' };
const tick = (input, label) => h('label', { class: 'tick' }, input, ` ${label}`);
const check = (on, disabled = !can('admin')) => h('input', { type: 'checkbox', checked: !!on, disabled });
/** A titled block inside a section page: hairline above, no box in a box. */
const block = (title, ...kids) => h('div', { class: 'sblock' }, title ? h('h3', {}, title) : null, kids);

/**
 * The sections of an agent's page, in order. `sub(ctx)`: the one-line current value on the row; `build(ctx)` returns
 * { el, value?() } — value() is the part of the agent this section saves (no value: the section saves itself or has
 * nothing to save). `bi`: shown for the built-in owner assistant; `agent`: shown for normal agents.
 */
const SECTIONS = [
  { group: 'What it does', id: 'character', icon: 'agents', c: 'c5', title: () => 'Character', help: 'agents.md#create-and-change-agents',
    line: (x) => (x.bi ? 'Tone, language and habits, added to its built-in instructions.' : 'Who it is and how it answers.'),
    sub: (x) => trunc(x.c.description || x.c.prompt || 'Not written yet', 60), build: buildCharacter },
  { group: 'What it does', id: 'where', agent: true, icon: 'chats', c: 'c3', title: () => 'Where it answers', help: 'agents.md#create-and-change-agents', line: () => 'The chats it serves, the words that wake it and who may write to it directly.',
    sub: (x) => [plural(x.chats.length, 'chat'), x.c.triggers?.length ? x.c.triggers.join(', ') : 'no wake word', `direct: ${DM_LABEL[x.c.dm]?.toLowerCase() || x.c.dm}`].join(' · '), build: buildWhere },
  { group: 'What it does', id: 'people', agent: true, icon: 'people', c: 'c4', title: () => 'People', help: 'agents.md#roles', line: () => 'Who is an organizer, and which people it may know about.',
    sub: (x) => [x.c.organizers?.length ? plural(x.c.organizers.length, 'organizer') : 'Group admins are organizers', PEOPLE_SHORT[x.c.peopleAccess || 'own']].join(' · '), build: buildPeople },
  { group: 'What it does', id: 'quick', agent: true, icon: 'send', c: 'c2', title: () => 'Quick replies & FAQ', help: 'agents.md#quick-replies-welcome--faq', line: () => 'Instant answers from your text: no AI, no tokens.',
    sub: (x) => { const n = (x.c.quickReplies || []).length; const f = (x.c.faq?.items || []).length; return n || f ? [n ? plural(n, 'quick reply', 'quick replies') : '', f ? plural(f, 'question') : ''].filter(Boolean).join(' · ') : 'None'; }, build: buildQuick },
  { group: 'What it does', id: 'welcome', agent: true, icon: 'people', c: 'c3', title: () => 'Welcome', help: 'agents.md#quick-replies-welcome--faq', line: () => 'Greets people who join a group, once per person.',
    sub: (x) => (x.c.welcome?.enabled ? 'On' : 'Off'), build: buildWelcome },
  { group: 'What it does', id: 'promises', agent: true, icon: 'people', c: 'c1', title: () => 'Promises & people', help: 'intelligence.md#commitments', line: () => 'Promises people make in its chats, reminders when due, and family ties it hears about.',
    sub: (x) => [x.c.promises?.track ? `Tracks promises${x.c.promises.followUp === 'off' ? '' : `, reminds ${x.c.promises.followUp === 'dm' ? 'directly' : 'in the chat'}`}` : 'Promises not tracked', x.c.cues ? 'suggests ties' : ''].filter(Boolean).join(' · '), build: buildPromises },
  { group: 'What it does', id: 'schedules', icon: 'pending', c: 'c1', title: (x) => (x.bi ? 'Scheduled messages' : 'Schedules'), help: 'agents.md', line: (x) => (x.bi ? 'Sent to you in your own chat, even while agents are paused.' : 'Posts it writes by itself at set times.'),
    sub: (x) => { const s = x.c.schedules || []; return s.length ? `${plural(s.length, 'schedule')} · ${s.map((y) => y.at).join(', ')}` : 'None'; }, build: buildSchedules },
  { group: 'How it works', id: 'model', icon: 'models', c: 'c4', title: () => 'Model', help: 'models.md', line: () => 'Which model answers, and what happens when it is unavailable.',
    sub: (x) => `${x.c.model === 'auto' ? 'Auto' : modelLabel(x.c.model, x.models)}${x.c.fallback?.mode === 'off' ? ' · no fallback' : ''}${x.c.selfCheck === false ? ' · no self-check' : ''}`, build: buildModel },
  { group: 'How it works', id: 'tools', icon: 'settings', c: 'c0', title: () => 'Tools', help: 'agents.md#tool-services-mcp', line: () => 'Tool services and chat actions, allowed per role in code.',
    sub: (x) => { const t = [...Object.keys(x.c.mcpServers || {}), ...(x.b.globalTools || []).filter((g) => g.on).map((g) => g.name)]; return [x.bi ? '' : autonomyLabel(x.c.autonomy), t.length ? t.join(', ') : 'no tool services'].filter(Boolean).join(' · '); }, build: buildTools },
  { group: 'How it works', id: 'memory', icon: 'notes', c: 'c2', title: () => 'Memory', help: 'agents.md#memory', line: (x) => (x.bi ? 'Notes it saves when you ask, private to you.' : 'Chat memory and notes shared across its chats.'),
    sub: (x) => (x.c.memory?.enabled === false ? 'Off' : 'On'), build: buildMemory },
  { group: 'How it works', id: 'media', icon: 'image', c: 'c1', title: () => 'Photos & voice', help: 'settings.md', line: () => 'What it does with photos and voice notes, and whether it speaks.',
    sub: (x) => { const m = { photos: true, voiceNotes: true, voiceReply: 'never', ...(x.c.media || {}) }; return [m.photos ? 'Photos' : '', m.voiceNotes ? 'voice notes' : '', m.voiceReply !== 'never' ? 'speaks' : ''].filter(Boolean).join(', ') || 'Off'; }, build: buildMedia },
  { group: 'How it works', id: 'cap', icon: 'pending', c: 'c0', title: () => 'Spending cap', help: 'spending.md', line: () => 'A monthly limit; at 80 % you get an alert.',
    sub: (x) => (x.cap ? `${Math.round(x.cap.used * 100)}% of this month's cap` : 'No cap'), build: buildCap },
  { group: 'How it works', id: 'alerts', only: 'bi', icon: 'shield', c: 'c1', title: () => 'Alerts', help: 'owner-assistant.md', line: () => 'Spending, provider and update alerts go to this WhatsApp number.',
    sub: (x) => (x.c.alerts?.to ? `+${x.c.alerts.to}` : 'Only in Activity'), build: buildAlerts },
  { group: 'How it works', id: 'advanced', icon: 'settings', c: 'c0', title: () => 'Advanced', help: 'agents.md', line: () => 'Time zone and how much it reads and writes.',
    sub: (x) => [x.c.timezone || (x.bi ? x.b.clock.server : 'Your time zone'), plural(x.c.historySize, 'message'), `${x.c.maxTokens} tokens`].join(' · '), build: buildAdvanced },
  { group: 'Try it', id: 'review', agent: true, icon: 'activity', c: 'c3', title: () => 'Review', help: 'agents.md#review-and-teach', line: () => 'Its recent answers. Rate them, and teach it where it went wrong.',
    sub: (x) => reviewLine(x.review), build: buildReview },
  { group: 'Try it', id: 'lessons', agent: true, icon: 'notes', c: 'c2', title: () => 'Lessons', help: 'intelligence.md#lessons', line: () => 'What it learned from your corrections, and when to join in.',
    sub: (x) => (x.c.lessons?.enabled === false ? 'Off' : x.b.lessonsToApprove ? `${plural(x.b.lessonsToApprove, 'lesson')} to approve` : 'From your 👎 and corrections'), build: buildLessons },
  { group: 'Try it', id: 'test', icon: 'send', c: 'c5', title: (x) => (x.bi ? 'Try it' : 'Test'), help: 'agents.md', line: (x) => (x.bi ? 'The same conversation as Ask on Overview.' : 'Real tools and saved settings; nothing is posted to WhatsApp.'),
    sub: (x) => (x.bi ? 'Ask it something' : 'Ask it as a participant or an organizer'), build: buildTest },
];
const shown = (sec, bi) => (bi ? sec.only === 'bi' || !sec.agent : sec.only !== 'bi');
/** Old deep links (first-run guide, why-quiet fixes) land in the section that now holds them. */

/** The page of one agent inside the Agents list → page. `onChange(agent)` keeps the list row in step. */
export function agentPage(id, { onChange } = {}) {
  const root = h('div', { class: 'ap', 'data-agent': id }, h('div', { class: 'card' }, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading…')));
  load().catch((e) => root.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Couldn’t load this agent'), h('p', { class: 'small muted' }, e.message))));
  async function load() {
    const enc = encodeURIComponent(id);
    const [b, models, us, bud, chats] = await Promise.all([api('GET', `/api/agents/${enc}`), loadModels().catch(() => ({ models: [] })), usageSummary(),
      api('GET', '/api/budget').catch(() => null), api('GET', '/api/chats').catch(() => [])]);
    const x = { id, enc, b, c: structuredClone(b.config), bi: !!b.builtin, models, us, review: b.review, cap: (bud?.caps || []).find((k) => k.scope === 'agent' && k.id === id) || null,
      chats: chats.filter((ch) => (b.config.chats || []).includes(ch.id)) };
    const [, , want, focus = ''] = location.hash.split('/'); // #agents/<id>/<section>/<part>: a part to focus in it
    if (want && SECTIONS.some((s) => s.id === want && shown(s, x.bi))) openSection(x, want, false, focus); else drawHome(x);
  }
  /** Saves a part of the agent; Undo puts the previous values back. Returns true when saved. */
  async function save(x, patch, F = {}, { quiet = false } = {}) {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, structuredClone(x.b.config[k] ?? null)]));
    let r;
    try { r = await api('PUT', `/api/agents/${x.enc}`, patch); } catch (e) { fieldError(e, F); return false; }
    x.b = r; x.c = structuredClone(r.config); onChange?.(r);
    if (!quiet) toast(r.warnings?.length ? `Saved — ${r.warnings.join('; ')}` : 'Saved', { undo: () => tryApi(async () => { const u = await api('PUT', `/api/agents/${x.enc}`, before); x.b = u; x.c = structuredClone(u.config); onChange?.(u); redraw(x); }, 'Undone') });
    return true;
  }
  let redraw = () => {};
  function header(x) {
    const b = x.b;
    const state = () => [x.bi ? 'Built in' : b.enabled ? 'On' : 'Off', x.bi ? null : plural(x.chats.length, 'chat'), x.us?.agent?.[id] ? `${usageLine(x.us.agent[id])} in 30 days` : null].filter(Boolean).join(' · ');
    const line = h('div', { class: 'small muted' }, state());
    const av = avatar(b.name, b.id, `l${b.enabled || x.bi ? '' : ' off'}`);
    const flip = async (v) => {
      const ok = await save(x, { enabled: v }, {}, { quiet: true });
      if (!ok) return;
      line.textContent = state(); av.classList.toggle('off', !v);
      toast(`${b.name} ${v ? 'on' : 'off'}`, { undo: () => flip(!v).then(() => { const sw = root.querySelector('.ap-head input[role=switch]'); if (sw) sw.checked = !v; }) });
    };
    const admin = can('admin');
    return h('div', { class: 'ap-head' }, av,
      h('div', { class: 'ap-title' }, h('h2', {}, b.name), line),
      x.bi ? null : toggle(b.enabled, flip, !admin, `${b.name} on`),
      menu(`More actions for ${b.name}`,
        h('button', { class: 'btn small', type: 'button', onclick: () => openSection(x, 'test', true) }, x.bi ? 'Try it' : 'Test'),
        admin ? h('button', { class: 'btn small', type: 'button', onclick: () => changeWithAi(x) }, 'Change with AI') : null,
        x.bi || !admin ? null : h('button', { class: 'btn small', type: 'button', onclick: async () => { const r = await tryApi(() => api('POST', `/api/agents/${x.enc}/duplicate`), 'Duplicated'); if (r) openAgent(r.id); } }, 'Duplicate'),
        h('a', { class: 'btn small', href: `/api/agents/${x.enc}/export`, download: `${id}.agent.json` }, 'Export'),
        x.bi || !admin ? null : h('button', { class: 'btn small danger', type: 'button', onclick: async () => {
          if (await ask({ title: `Delete “${b.name}”?`, text: 'Its chats no longer have this agent. Chat memory stays until you erase it.', ok: 'Delete agent', danger: true }) && await tryApi(() => api('DELETE', `/api/agents/${x.enc}`), 'Deleted')) location.hash = 'agents';
        } }, 'Delete')));
  }
  function drawHome(x) {
    redraw = drawHome;
    const groups = [...new Set(SECTIONS.map((s) => s.group))];
    const row = (s) => h('li', {}, h('a', { class: 'lrow', href: `#agents/${x.enc}/${s.id}`, onclick: (e) => { e.preventDefault(); openSection(x, s.id, true); } },
      h('span', { class: `lmark ${s.c}`, 'aria-hidden': 'true' }, icon(s.icon)),
      h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, s.title(x)), h('span', { class: 'lrow-sub' }, s.sub(x))),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
    root.replaceChildren(h('div', { class: 'card ap-card' }, header(x),
      x.b.needs?.length ? h('div', { class: 'note warn' }, `Needs secrets: ${x.b.needs.join(', ')}. `, h('a', { href: '#settings/secrets' }, 'Set them in Settings')) : null,
      x.bi ? h('p', { class: 'small muted ap-note' }, 'Your own assistant in your WhatsApp chat and in Ask. ', helpLink('owner-assistant.md')) : null,
      can('admin') ? h('button', { class: 'ai-entry', type: 'button', onclick: () => changeWithAi(x) }, h('span', { class: 'ai-chip' }, 'AI'), 'Change with AI', h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')) : null,
      groups.map((g) => { const items = SECTIONS.filter((s) => s.group === g && shown(s, x.bi)); return items.length ? h('div', { class: 'lgroup' }, h('div', { class: 'eyebrow' }, g), h('ul', {}, items.map(row))) : null; })));
  }
  function openSection(x, sid, push, focus = '') {
    const s = SECTIONS.find((y) => y.id === sid);
    redraw = (y) => openSection(y, sid, false);
    if (push) history.pushState(null, '', `#agents/${x.enc}/${sid}`);
    const built = s.build(x, { save: (patch, F, o) => save(x, patch, F, o), teach: (text) => changeWithAi(x, text) });
    let base = built.value ? JSON.stringify(built.value()) : '';
    // One save model (068): nothing changed → a quiet "All changes saved"; a change → a bar with Save that stays in reach
    const saveBtn = built.value && can('admin') ? h('button', { class: 'btn primary', type: 'button' }, 'Save') : null;
    const state = h('span', { class: 'small muted', role: 'status' });
    const bar = saveBtn ? h('div', { class: 'sec-save' }, state, saveBtn) : null;
    const dirty = () => !!built.value && JSON.stringify(built.value()) !== base;
    const sync = () => { if (!bar) return; const d = dirty(); bar.classList.toggle('dirty', d); saveBtn.disabled = !d; state.textContent = d ? 'Unsaved changes' : 'All changes saved'; };
    built.rebase = () => { base = built.value ? JSON.stringify(built.value()) : ''; sync(); };
    if (saveBtn) saveBtn.onclick = async () => { saveBtn.disabled = true; if (await save(x, built.value(), built.F)) built.rebase(); else sync(); };
    const back = async (e) => {
      e.preventDefault();
      if (dirty() && !await ask({ title: 'Leave without saving?', text: 'Your changes in this section are not saved.', ok: 'Leave', danger: true })) return;
      history.pushState(null, '', `#agents/${x.enc}`); drawHome(x); root.querySelector('.ap-head h2')?.focus?.();
    };
    const body = h('div', { class: 'sbody' }, built.el);
    ['input', 'change', 'click'].forEach((ev) => body.addEventListener(ev, () => queueMicrotask(sync)));
    root.replaceChildren(h('div', { class: 'card ap-sec' },
      h('a', { class: 'sub-back', href: `#agents/${x.enc}`, onclick: back }, icon('back'), x.b.name),
      h('div', { class: 'sec-head' }, h('h2', { tabindex: '-1' }, s.title(x)), helpLink(s.help)),
      h('p', { class: 'small muted sec-line' }, s.line(x)),
      body,
      bar));
    sync();
    built.ready?.then(() => built.rebase());
    document.title = `${s.title(x)} · ${x.b.name} · Duniya`;
    if (push) { if (matchMedia('(max-width: 640px)').matches) window.scrollTo({ top: 0 }); root.querySelector('.sec-head h2')?.focus({ preventScroll: true }); }
    if (focus && built.F?.[focus]) { built.F[focus].scrollIntoView({ block: 'center' }); built.F[focus].focus({ preventScroll: true }); }
  }
  /** "Change with AI" (the shared dialog): applied changes save like a section, then the page redraws. */
  const changeWithAi = (x, initial = '') => changeWithAiDialog(id, initial, async (patch) => { if (!await save(x, patch)) return false; redraw(x); return true; });
  return root;
}

// ---------- sections ----------
/** 070: "👍 3 · 👎 1 this week" on the Review row. */
const reviewLine = (r) => (!r ? 'Rate its answers' : r.up || r.down ? `👍 ${r.up} · 👎 ${r.down} this week` : r.answers ? `${plural(r.answers, 'answer')} this week, none rated` : 'No answers this week');
/** 091: Promises & people — loaded with the section (promises.js). */
function buildPromises(x, { save }) {
  const box = h('div', {}, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading…'));
  import('./promises.js').then((m) => box.replaceChildren(m.promisesView(x, (patch) => save(patch, {}, { quiet: true }))));
  return { el: box };
}
/** 089: Lessons — loaded with the section (lessons.js). */
function buildLessons(x, { save }) {
  const box = h('div', {}, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading lessons…'));
  import('./lessons.js').then((m) => box.replaceChildren(m.lessonsView(x, (patch) => save(patch, {}, { quiet: true }))));
  return { el: box };
}
/** 070: Review & teach — its answers with the question, 👍 / 👎, and Teach (the AI helper, pre-filled). */
function buildReview(x, { teach }) {
  if (!can('admin')) return { el: h('p', { class: 'small muted' }, 'Admins and the owner can read and rate its answers.') };
  const list = h('div', { class: 'rv-list', onrated: (e) => { x.review = e.detail.counts; } }, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading answers…'));
  const more = h('button', { class: 'btn small hide', type: 'button' }, 'Show older answers');
  let only = ''; let last = 0;
  // 072: the same answer row as a chat's Messages and Activity; "In chat ›" opens the conversation at this answer
  const item = (a) => h('div', { class: 'rv' },
    h('div', { class: 'small muted' }, [a.question?.name, a.chatName, time(a.ts)].filter(Boolean).join(' · ')),
    a.question ? h('div', { class: 'rv-q' }, a.question.text) : null,
    messageMedia(a.chat, a.id, a.media, wordsBeside(a.text).label), // 096: the GIF it shared with the answer
    h('div', { class: 'rv-a', title: 'Tap to show all', onclick: (e) => e.currentTarget.classList.toggle('open') }, a.media?.shown ? wordsBeside(a.text).text : a.text),
    answerActions({ ...a, agent: x.id }, { teach, extra: h('a', { class: 'btn small ghost rv-in', href: `#chats/${encodeURIComponent(a.chat)}/messages/${a.id}` }, 'In chat\u00a0›') }));
  async function load(older) {
    const r = await tryApi(() => api('GET', `/api/agents/${x.enc}/review?only=${only}${older && last ? `&before=${last}` : ''}`));
    if (!r) return;
    x.review = r.counts;
    const items = r.answers.map(item);
    if (older) list.append(...items);
    else list.replaceChildren(...(items.length ? items : [h('p', { class: 'small muted' }, only === 'down' ? 'No answer is rated 👎.' : only ? 'Every answer is rated.' : 'No answers yet. They appear here after the agent answers in a chat.')]));
    last = r.answers.at(-1)?.id || last; more.classList.toggle('hide', !r.more);
  }
  more.onclick = () => load(true);
  const filter = seg('Show', [['', 'All'], ['down', '👎'], ['unrated', 'Not rated']], only, (v) => { only = v; last = 0; load(false); });
  load(false);
  return { el: h('div', {}, h('div', { class: 'ld-tools' }, filter), list, h('div', { style: 'text-align:center;margin-top:10px' }, more)) };
}
function buildCharacter(x) {
  const F = { name: h('input', { value: x.c.name || '' }), description: h('input', { value: x.c.description || '' }),
    prompt: h('textarea', { class: 'prose', style: 'min-height:min(52vh,420px)', value: x.c.prompt || '', placeholder: x.bi ? 'e.g. Answer in English, short; call me Vik.' : '' }) };
  return { F, el: h('div', {}, field('Name', F.name), x.bi ? null : field('Description', F.description, 'One line, shown in lists.'), field(x.bi ? 'Character' : 'Instructions', F.prompt)),
    value: () => ({ name: F.name.value, ...(x.bi ? {} : { description: F.description.value }), prompt: F.prompt.value }) };
}
function buildWhere(x) {
  const F = { triggers: tagInput(x.c.triggers || [], { placeholder: 'Add a word, e.g. silku', label: 'Add a wake word' }), respondToMentions: check(x.c.respondToMentions),
    groupReplies: h('select', {}, Object.entries(GROUP_REPLIES).map(([v, l]) => h('option', { value: v, selected: (x.c.groupReplies || 'followups') === v }, l))),
    dm: h('select', {}, Object.entries({ members: 'Members of its groups + listed participants', organizers: 'Organizers only', anyone: 'Anyone, even people whose chat is off', none: 'Nobody' }).map(([v, l]) => h('option', { value: v, selected: x.c.dm === v }, l))) };
  return { F, el: h('div', {},
    block('Chats', x.chats.length ? h('ul', { class: 'mini-list' }, x.chats.map((ch) => h('li', {}, h('a', { class: 'lrow', href: `#chats/${encodeURIComponent(ch.id)}` },
      avatar(ch.name || ch.id, ch.id, ch.enabled ? 's' : 's off'), h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, ch.name || ch.id), h('span', { class: 'lrow-sub' }, ch.enabled ? 'On' : 'Off')),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))))
      : h('p', { class: 'small muted' }, 'No chat yet. ', h('a', { href: '#chats' }, 'Choose this agent for a chat on Chats'), '.')),
    block('Wake words', field('Words', F.triggers.box, 'Any case, anywhere in the message. Press Enter after each.'), tick(F.respondToMentions, 'Reply when @mentioned or replied to'),
      field('In groups', F.groupReplies, 'Follow-ups: after it speaks, it reads the replies and answers the ones for it. Whenever needed: it reads every message (costs more).')),
    block('Direct messages', field('Who may message it directly', F.dm))),
  value: () => ({ triggers: F.triggers.values(), respondToMentions: F.respondToMentions.checked, groupReplies: F.groupReplies.value, dm: F.dm.value }) };
}
function buildPeople(x) {
  // 079: roles are numbers, people and lists. Group members switch between participant and organizer here; everyone
  // else (people in People, lists, numbers) is picked below. People access: which people its tools and cards may see.
  const orgSet = new Set(x.c.organizers || []);
  const memberKeys = new Set(); // the entries the member switches stand for (number and person of each member)
  const F = { access: h('select', { 'aria-label': 'People access', disabled: !can('admin') }, Object.entries(PEOPLE_ACCESS).map(([v, l]) => h('option', { value: v, selected: (x.c.peopleAccess || 'own') === v }, l))) };
  const box = h('div', {}, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Loading group members…'));
  const more = h('div', {});
  const ready = api('GET', `/api/agents/${x.enc}/people`).then((pp) => {
    if (pp.suggested) for (const g of pp.groups) for (const m of g.members) if (m.suggested) orgSet.add(m.phone);
    for (const g of pp.groups) for (const m of g.members) for (const k of [m.phone, m.person]) if (k) memberKeys.add(k);
    const isOrg = (m) => orgSet.has(m.phone) || (m.person && orgSet.has(m.person));
    const role = (m) => (!m.phone ? h('span', { class: 'small muted' }, 'number hidden') : seg(`Role of ${whoLabel(m)}`, [['participant', 'Participant'], ['organizer', 'Organizer']],
      isOrg(m) ? 'organizer' : 'participant', (v) => { orgSet.delete(m.phone); if (m.person) orgSet.delete(m.person); if (v === 'organizer') orgSet.add(m.person || m.phone); box.dispatchEvent(new Event('input', { bubbles: true })); }));
    box.replaceChildren(
      pp.suggested && pp.groups.some((g) => g.members.some((m) => m.suggested)) ? h('p', { class: 'small muted' }, 'No roles saved yet: the group admins are its organizers.') : null,
      pp.groups.length ? pp.groups.map((g) => block(`${g.name} · ${plural(g.members.length, 'member')}`, g.error ? h('div', { class: 'small', style: 'color:var(--bad)' }, g.error) : null,
        h('ul', { class: 'people' }, g.members.map((m) => h('li', {}, h('span', { class: 'who' }, h('b', {}, m.phone ? h('a', { href: `#people/${encodeURIComponent(m.person || m.phone)}` }, whoLabel(m)) : whoLabel(m)), tagPill(m.tag), m.admin ? h('span', { class: 'small muted' }, ' · admin') : null), role(m))))))
        : h('p', { class: 'small muted' }, 'Choose this agent for a group on Chats to pick people from its members.'));
    const entry = new Map(pp.entries.map((e) => [e.value, e]));
    const pick = (values, label, o = {}) => peoplePicker(values.map((v) => entry.get(v) || { value: v, label: v, kind: 'phone' }), { label, lists: pp.lists, ...o });
    F.organizers = pick([...orgSet].filter((v) => !memberKeys.has(v)), 'More organizers');
    F.participants = pick(x.c.participants || [], 'Extra participants');
    F.lists = pick(x.c.peopleLists || [], 'Lists shared with this agent', { only: 'list', placeholder: 'Type a list name' });
    more.replaceChildren(field('More organizers', F.organizers, 'People, lists (e.g. "Committee") or numbers. A role follows the person on WhatsApp and Telegram.'),
      field('Extra participants who may message it directly', F.participants));
    shared.replaceChildren(field('Lists shared with it', F.lists, 'It also sees the people on these lists.'));
  }).catch((e) => box.replaceChildren(h('p', { class: 'small muted' }, `Could not load members: ${e.message}`)));
  const shared = h('div', {});
  return { F, ready, el: h('div', {}, box,
    h('details', { class: 'sblock' }, h('summary', {}, 'People outside these groups'), more),
    block('People access', field('Which people it may look up and know about', F.access, 'Its People tools and the short card about who is writing. Own chats: people who write in or are members of its chats, plus the lists below. When you write to it yourself, it sees everyone.'), shared)),
  value: () => ({ organizers: [...[...orgSet].filter((v) => memberKeys.has(v)), ...(F.organizers?.values() || [...orgSet].filter((v) => !memberKeys.has(v)))],
    participants: F.participants?.values() || x.c.participants || [], peopleAccess: F.access.value, peopleLists: F.lists?.values() || x.c.peopleLists || [] }) };
}
function buildModel(x) {
  const F = { model: modelSelect(x.models, x.c.model, { smart: true, autoLabel: `Auto${x.models.resolvedDefault ? ` (now ${modelLabel(x.models.resolvedDefault, x.models)})` : ''}` }) };
  const fb = fallbackPicker(x.models, x.c.fallback, { what: 'agent' });
  // 088: Smart choice — its own light / strong models (empty: Settings → Models), shown while "smart" is chosen
  const sm = x.models.smart || {};
  const tier = (k) => modelSelect(x.models, x.c.modelTiers?.[k] || 'auto', { autoLabel: 'Same as Models', 'aria-label': `${k} model` });
  const now = (ref) => (ref ? `Models: ${modelLabel(ref, x.models)}` : '');
  F['modelTiers.light'] = tier('light'); F['modelTiers.strong'] = tier('strong');
  const tiers = block('Light and strong', h('p', { class: 'small muted' }, 'Simple messages (greetings, thanks, short questions) go to the light model; the owner, photos, changes, long or multi-step messages and looking things up go to the strong one. Activity says which answered and why. ', helpLink('models.md#smart-choice')),
    h('div', { class: 'grid2' }, field('Light model', F['modelTiers.light'], now(sm.resolvedLight)), field('Strong model', F['modelTiers.strong'], now(sm.resolvedStrong))));
  const showTiers = () => tiers.classList.toggle('hide', F.model.value !== 'smart');
  F.model.addEventListener('change', showTiers); showTiers();
  F.selfCheck = check(x.c.selfCheck !== false);
  return { F, el: h('div', {}, field('Model', F.model, x.models.problem || null), tiers, block('When the model is unavailable', fb.el),
    block('Self-check', tick(F.selfCheck, 'Check amounts, dates and counts against People, events and orders before sending'), h('p', { class: 'small muted' }, 'A wrong figure is corrected once; if it is still wrong, a plain answer without figures goes out. ', helpLink('intelligence.md#self-check')))),
    value: () => ({ model: F.model.value, fallback: fb.value(), modelTiers: { light: F['modelTiers.light'].value, strong: F['modelTiers.strong'].value }, selfCheck: F.selfCheck.checked }) };
}
function buildCap(x) {
  const box = h('div', {});
  capEditor('agent', x.id, x.models).then((el) => box.replaceChildren(el));
  return { el: box };
}
function buildAlerts(x) {
  const F = { 'alerts.to': h('input', { type: 'tel', inputmode: 'tel', value: x.c.alerts?.to ? `+${x.c.alerts.to}` : '', placeholder: '+41 79 123 45 67', disabled: S.user?.role !== 'owner' }) };
  return { F, el: field('Alerts go to', F['alerts.to'], S.user?.role === 'owner' ? 'With country code; empty: only in Activity.' : 'Only the owner can change this.'),
    value: () => ({ alerts: { to: F['alerts.to'].value } }) };
}
function buildAdvanced(x) {
  // the owner assistant's time zone is the owner's clock; every other agent uses it unless it has its own
  const zones = h('datalist', { id: 'zones' }, Intl.supportedValuesOf('timeZone').map((z) => h('option', { value: z })));
  const F = { timezone: h('input', { value: x.c.timezone || '', list: 'zones', autocomplete: 'off', placeholder: x.bi ? `${x.b.clock.server} (the server’s)` : `${x.b.clock.yours} (yours)` }),
    historySize: h('input', { type: 'number', value: x.c.historySize }), maxTokens: h('input', { type: 'number', value: x.c.maxTokens }) };
  const zone = x.bi ? field('Your time zone', F.timezone, 'Your day, the months of spending caps and the times of updates and backups go by it. So does every agent without a time zone of its own.') : field('Time zone', F.timezone);
  return { F, el: h('div', { class: 'grid2' }, zone, zones, field('Recent messages it reads', F.historySize), field('Longest reply (tokens)', F.maxTokens)),
    value: () => ({ timezone: F.timezone.value.trim(), historySize: Number(F.historySize.value), maxTokens: Number(F.maxTokens.value) }) };
}
function buildMemory(x) {
  const F = { memory: check(x.c.memory?.enabled !== false) };
  const notesBox = h('div', {});
  const loadNotes = async () => {
    const { notes } = await api('GET', `/api/agents/${x.enc}/memory`).catch(() => ({ notes: [] }));
    notesBox.replaceChildren(block(`Shared notes (${notes.length})`, notes.length ? h('ul', { class: 'notes' }, notes.map((n) => h('li', {}, h('span', {}, n.text, h('span', { class: 'small muted' }, ` · ${n.author || '?'}, ${time(n.ts)}`)),
      can('admin') ? h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Delete note: ${trunc(n.text, 40)}`, onclick: () => tryApi(async () => { await api('DELETE', `/api/notes/${n.id}`); loadNotes(); }, 'Note deleted') }, 'Delete') : null)))
      : h('p', { class: 'small muted' }, 'None yet. Organizers add them in WhatsApp: “remember for all groups: …”.')));
  };
  if (!x.bi) loadNotes();
  // 072: each chat's own memory lives on the chat's page; one tap from here
  const chats = x.bi || !x.chats.length ? null : block('Memory of each chat', h('ul', { class: 'notes' }, x.chats.map((ch) => h('li', {},
    h('a', { href: `#chats/${encodeURIComponent(ch.id)}/memory` }, `${ch.name || ch.id}\u00a0›`)))));
  return { F, el: h('div', {}, tick(F.memory, x.bi ? 'Keep notes when asked' : 'Remember each chat (summary and notes)'), chats, notesBox), value: () => ({ memory: { enabled: F.memory.checked } }) };
}
function buildMedia(x) {
  const md = { photos: true, documents: true, stickers: false, voiceNotes: true, voiceReply: 'never', ...structuredClone(x.c.media || {}) };
  md.createImages = { organizer: true, participant: false, ...(md.createImages || {}) };
  const box = h('div', {}, h('p', { class: 'small muted' }, h('span', { class: 'spinner' }), ' Checking what your models can do…'));
  const mt = (key, label, obj = md) => { const i = check(obj[key]); i.onchange = () => { obj[key] = i.checked; }; return tick(i, label); };
  const hint = (ok, text) => (ok ? null : h('div', { class: 'small muted cap-hint' }, text, ' ', h('a', { href: '#models' }, 'Models')));
  const ready = api('GET', '/api/media').catch(() => null).then((caps) => {
    const ms = caps?.summary || {};
    box.replaceChildren(
      block('What it takes in', mt('photos', 'Look at photos'), hint(ms.sees !== false, 'No connected model can see photos.'), mt('documents', 'Read PDF files'), mt('stickers', 'Look at stickers too'),
        mt('voiceNotes', 'Listen to voice notes'), hint(ms.hears, 'Nothing connected can listen yet.')),
      block('Reply with voice', seg('Reply with voice', [['never', 'Never'], ['voice', 'To voice notes'], ['always', 'Always']], md.voiceReply, (v) => { md.voiceReply = v; }), hint(ms.speaks, 'Nothing connected can speak yet.')),
      block('Who may ask for pictures', mt('organizer', 'Organizers', md.createImages), mt('participant', 'Participants', md.createImages), hint(ms.creates, 'Nothing connected can create pictures yet.')));
  });
  return { ready, el: box, value: () => ({ media: md }) };
}
function buildSchedules(x) {
  const scheds = structuredClone(x.c.schedules || []);
  const box = h('div', {}); const out = h('div', {});
  const draw = () => box.replaceChildren(...scheds.map((s, i) => h('div', { class: 'sblock sched' },
    h('div', { class: 'row' }, h('input', { value: s.at || '08:00', 'aria-label': 'Time (HH:MM)', placeholder: 'HH:MM', style: 'max-width:96px', oninput: (e) => (s.at = e.target.value) }),
      h('input', { value: s.days || 'daily', 'aria-label': 'Days', placeholder: 'daily or mon,wed', style: 'max-width:170px', oninput: (e) => (s.days = e.target.value) }),
      h('label', { class: 'tick' }, h('input', { type: 'checkbox', checked: s.enabled !== false, onchange: (e) => (s.enabled = e.target.checked) }), ' On'),
      Object.assign(menu(`Actions for schedule ${s.id || i + 1}`,
        h('button', { class: 'btn small', type: 'button', onclick: () => tryApi(async () => { const r = await api('POST', `/api/agents/${x.enc}/schedules/${encodeURIComponent(s.id)}/run`); toast(r.length ? `Ran for ${plural(r.length, 'chat')}` : x.bi ? 'Nobody to send it to yet' : 'No chats bound'); }) }, 'Run now'),
        s.kind === 'weekly-summary' ? h('button', { class: 'btn small', type: 'button', onclick: () => tryApi(async () => { const r = await api('GET', '/api/owner-assistant/weekly-preview'); out.replaceChildren(h('pre', { class: 'small' }, r.text)); }) }, 'Preview') : null,
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { scheds.splice(i, 1); draw(); } }, 'Remove')), { style: 'margin-left:auto' })),
    s.kind === 'weekly-summary' ? h('div', { class: 'small muted' }, 'The weekly summary: counts and costs, never message contents.')
      : h('textarea', { class: 'prose', style: 'min-height:60px;margin-top:6px', 'aria-label': x.bi ? 'What to send you' : 'What to post', value: s.prompt || '', placeholder: x.bi ? 'e.g. a morning brief of my groups' : 'e.g. a short summary of today’s agenda', oninput: (e) => (s.prompt = e.target.value) }))),
  scheds.length ? null : h('p', { class: 'small muted' }, 'No schedules yet.'));
  draw();
  return { el: h('div', {}, box, out, can('admin') ? h('button', { class: 'btn small', type: 'button', onclick: () => { scheds.push({ id: `s${Date.now().toString(36)}`, at: '08:00', days: 'daily', prompt: '', chats: 'all', enabled: true }); draw(); } }, '+ Add schedule') : null),
    value: () => ({ schedules: scheds }) };
}
function buildTools(x, { save }) {
  const c = x.c; const bi = x.bi;
  const servers = Object.entries(c.mcpServers || {}).map(([key, sv]) => serverState(key, sv));
  const rulesBox = Object.fromEntries(['participant', 'organizer', 'deny'].map((r) => [r, h('textarea', { value: lines(c.tools?.[r]), style: 'min-height:60px' })]));
  const allowed = (role, fq) => splitLines(rulesBox[role].value).some((r) => globRe(r).test(fq));
  const writeRules = (key, role, names, tools, explicitNone = false) => {
    const keep = splitLines(rulesBox[role].value).filter((r) => !r.startsWith(`${key}:`));
    const mine = names.length === tools.length ? [`${key}:*`] : !names.length && explicitNone ? [`${key}:-`] : names.map((n) => `${key}:${n}`);
    rulesBox[role].value = [...keep, ...mine].join('\n');
  };
  const explicitFor = (key, role) => splitLines(rulesBox[role].value).filter((r) => r.startsWith(`${key}:`));
  const globalOff = new Set(c.globalMcp?.disabled || []);
  const confirm = { on: !!c.confirm, preview: c.confirm?.preview || '', tool: c.confirm?.tool || '', idField: c.confirm?.idField || 'confirm_id', ttl: c.confirm?.ttlMinutes || 9 };
  let autonomy = c.autonomy || 'clear';
  // 094: how it uses each service (only what differs from the service's default); the services' tools and defaults load with the page
  const services = structuredClone(c.services || {}); let sinfo = []; const openFolds = new Set();
  const states = {}; // one editable object per service, put into `services` while it sets something
  const stateOf = (key) => (states[key] ||= services[key] || {});
  const commit = (key) => {
    const st = states[key];
    if (st.tools && !Object.keys(st.tools).length) delete st.tools;
    if (Object.keys(st).length) services[key] = st; else delete services[key];
  };
  const bhFill = new Map(); // service → redraw its How it uses it card (only that card, when the services' tools arrive)
  const behaviourBox = (key) => {
    if (bi) return null;
    // shown at once with the service defaults; whether it shares media (and the service's own defaults) fill in when the
    // services' tools arrive (a slow or signed-out service must never hide these settings, nor wipe an open tool grid)
    const box = h('div', {});
    const fill = () => { const i = sinfo.find((y) => y.service === key) || {};
      box.replaceChildren(behaviourEditor(stateOf(key), { dflt: i.default || {}, media: i.media || '', shared: i.shared || null, onChange: () => commit(key),
        open: openFolds.has(key), onToggle: (on) => (on ? openFolds.add(key) : openFolds.delete(key)) })); }; // stays open when redrawn
    fill(); bhFill.set(key, fill);
    return box;
  };
  const riskOf = (key) => ({ get: (name) => stateOf(key).tools?.[name],
    set: (name, v) => { const st = stateOf(key); st.tools = { ...(st.tools || {}) }; if (v === 'auto') delete st.tools[name]; else st.tools[name] = v; commit(key); } });
  const value = () => ({
    mcpServers: Object.fromEntries(servers.filter((s) => s.key).map((s) => [s.key, serverConfig(s)])), globalMcp: { disabled: [...globalOff] },
    tools: { participant: splitLines(rulesBox.participant.value), organizer: splitLines(rulesBox.organizer.value), deny: splitLines(rulesBox.deny.value) },
    ...(bi ? {} : { autonomy, services, confirm: confirm.on ? { preview: confirm.preview.trim(), tool: confirm.tool.trim(), idField: confirm.idField.trim(), ttlMinutes: Number(confirm.ttl) } : null }),
  });
  const saveAll = async () => { const ok = await save(value()); if (ok) for (const sv of servers) markSaved(sv); return ok; };
  const srvList = h('div', {}); const globalBox = h('div', {}); const waBox = h('div', {});
  let conns = []; let locals = []; let waTools = []; let registry = null;
  function drawServers() {
    srvList.replaceChildren(...servers.map((s, i) => toolServiceEditor(s, { base: `/api/agents/${x.enc}`, conns, locals, isOwner: S.user?.role === 'owner', save: saveAll, saveHint: 'Save to connect',
      rules: { has: (role, name) => allowed(role, `${s.key}:${name}`), write: (role, names, tools) => writeRules(s.key, role, names, tools) }, redraw: drawServers, top: behaviourBox(s.key), risk: bi ? null : riskOf(s.key), remove: () => { servers.splice(i, 1); drawServers(); } })),
    servers.length ? null : h('p', { class: 'small muted' }, 'No tool service of its own.'));
  }
  function drawGlobals() {
    if (!x.b.globalTools?.length) return globalBox.replaceChildren(h('p', { class: 'small muted' }, 'None yet. ', h('a', { href: '#settings/tool-services' }, 'Add services for every agent in Settings'), '.'));
    globalBox.replaceChildren(h('ul', { class: 'gtools' }, x.b.globalTools.map((g) => {
      const grid = h('div', {});
      const replaced = servers.some((sv) => sv.key === g.name);
      const custom = ['organizer', 'participant'].some((role) => explicitFor(g.name, role).length);
      const rules = { has: (role, name) => { const ex = explicitFor(g.name, role); return ex.length ? ex.some((r) => globRe(r).test(`${g.name}:${name}`)) : (g.defaults?.[role] || []).some((y) => globRe(y).test(name)); },
        write: (role, names, tools) => writeRules(g.name, role, names, tools, true) };
      const use = check(!globalOff.has(g.name)); use.setAttribute('aria-label', `Use ${g.name}`);
      use.onchange = () => { if (use.checked) globalOff.delete(g.name); else globalOff.add(g.name); drawGlobals(); };
      return h('li', {}, h('div', { class: 'row spread nowrap' }, h('span', {}, h('b', {}, g.name), h('span', { class: 'small muted' }, custom ? ' · own tool choices' : ` · ${g.type === 'local' ? 'local' : 'remote'}`)),
        replaced ? h('span', { class: 'small muted' }, 'replaced by its own') : h('label', { class: 'tick' }, use)),
      !replaced && !globalOff.has(g.name) ? behaviourBox(g.name) : null,
      !replaced && !globalOff.has(g.name) ? h('div', { class: 'row', style: 'gap:6px' },
        h('button', { class: 'btn small', type: 'button', onclick: async () => { const tools = await tryApi(() => api('POST', '/api/tool-services/discover', { server: g.name })); if (tools) toolGrid(grid, tools, rules, bi ? null : riskOf(g.name)); } }, 'Choose tools'),
        custom ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { for (const role of ['organizer', 'participant']) rulesBox[role].value = splitLines(rulesBox[role].value).filter((r) => !r.startsWith(`${g.name}:`)).join('\n'); drawGlobals(); } }, 'Use the defaults') : null) : null, grid);
    })));
  }
  // Built-in tools by role (chat actions; 081: module tools): "<key>:" rules, all / none per role (#165)
  const bOn = (key, role, t) => { const mine = splitLines(rulesBox[role].value).filter((r) => r.startsWith(`${key}:`)); return !mine.length ? role === 'organizer' || t.participantDefault : mine.some((r) => globRe(r).test(`${key}:${t.name}`)); };
  const setB = (key, tools, role, name, on) => {
    const may = tools.filter((t) => role === 'organizer' || !t.organizerOnly);
    const next = may.filter((t) => (name === '*' || t.name === name ? on : bOn(key, role, t))).map((t) => t.name);
    const rest = splitLines(rulesBox[role].value).filter((r) => !r.startsWith(`${key}:`));
    rulesBox[role].value = [...rest, ...(!next.length ? [`${key}:-`] : role === 'organizer' && next.length === may.length ? [`${key}:*`] : next.map((n) => `${key}:${n}`))].join('\n');
  };
  const drawB = (box, key, tools) => box.replaceChildren(tools.length ? h('details', {}, h('summary', {}, `Choose per role (${tools.length})`),
    can('admin') ? h('div', { class: 'row', style: 'gap:6px' }, ['participant', 'organizer'].map((role) => { const may = tools.filter((t) => role === 'organizer' || !t.organizerOnly), n = may.filter((t) => bOn(key, role, t)).length;
      return h('label', { class: 'tick' }, h('input', { type: 'checkbox', checked: n === may.length, indeterminate: n > 0 && n < may.length, onchange: (e) => { setB(key, tools, role, '*', e.target.checked); drawB(box, key, tools); } }), ` All: ${ROLE_LABEL[role]}`); })) : null,
    h('ul', { class: 'wa-tools' }, tools.map((t) => h('li', {},
    h('div', {}, h('b', {}, t.name.replace(/_/g, ' ')), t.organizerOnly ? h('span', { class: 'small muted' }, ' · organizers only') : null), h('div', { class: 'small muted' }, t.description),
    h('div', { class: 'row', style: 'gap:4px;margin-top:4px' }, ['participant', 'organizer'].map((role) => h('label', { class: 'tick' }, h('input', { type: 'checkbox', checked: (role === 'organizer' || !t.organizerOnly) && bOn(key, role, t), disabled: !can('admin') || (role === 'participant' && t.organizerOnly),
      onchange: (e) => { setB(key, tools, role, t.name, e.target.checked); drawB(box, key, tools); } }), ` ${ROLE_LABEL[role]}`))))))) : h('p', { class: 'small muted' }, 'None.'));
  const modBox = h('div', {});
  const ready = Promise.all([api('GET', `/api/agents/${x.enc}/connections`).catch(() => []), api('GET', `/api/agents/${x.enc}/local`).catch(() => []), api('GET', '/api/whatsapp/tools').catch((e) => ({ failed: e })),
    can('admin') ? api('GET', '/api/tool-services/registry/settings').catch(() => null) : null, bi ? [] : api('GET', '/api/modules/tools').catch((e) => ({ failed: e }))]).then(([cn, lo, wa, reg, mods]) => {
    conns = cn; locals = lo; registry = reg;
    // 094: how it uses each service needs the services' tools (a slow service must not hold up the page): drawn when they arrive
    if (!bi) api('GET', `/api/agents/${x.enc}/services`).then((sv) => { sinfo = sv; for (const fill of bhFill.values()) fill(); }, () => {});
    drawServers(); drawGlobals();
    // a list that did not load says so (never "None."); Retry draws the Tools page again
    const drawWa = (w) => { if (w.failed) return waBox.replaceChildren(partFailed(w.failed, '', () => api('GET', '/api/whatsapp/tools').catch((e) => ({ failed: e })).then(drawWa)));
      waTools = bi ? w.filter((t) => t.owner) : w; drawB(waBox, 'whatsapp', waTools); };
    const drawMods = (ms) => (ms.failed ? modBox.replaceChildren(partFailed(ms.failed, 'Modules', () => api('GET', '/api/modules/tools').catch((e) => ({ failed: e })).then(drawMods)))
      : modBox.replaceChildren(...ms.map((m) => { const box = h('div', {}); drawB(box, m.id, m.tools); return block(m.label, h('p', { class: 'small muted' }, `${m.line} (Settings → Modules).${m.changes ? ' Changes for someone else wait for an organizer\'s confirm code.' : ''}`), box); })));
    drawWa(wa); drawMods(mods);
    addRow.replaceChildren(browseButton({ target: x.id, targetName: c.name || x.id, onAdded: () => location.reload() }, registry),
      can('admin') ? h('button', { class: 'btn small', type: 'button', onclick: () => { servers.push(serverState('', {})); drawServers(); } }, '+ Add by address') : null);
  });
  const addRow = h('div', { class: 'row', style: 'gap:6px' });
  const confirmBox = bi ? null : (() => {
    const on = check(confirm.on); on.onchange = () => { confirm.on = on.checked; };
    const inp = (k, ph) => h('input', { value: confirm[k], placeholder: ph, oninput: (e) => { confirm[k] = e.target.value; } });
    return h('details', { class: 'sblock' }, h('summary', {}, `Changes need confirmation${confirm.on ? ' · on' : ''}`),
      tick(on, 'Hold changes that ask first until an organizer replies “confirm CODE”'),
      h('div', { class: 'grid2' }, field('Preview tools', inp('preview', 'panduga:*_preview')), field('Confirm tool', inp('tool', 'panduga:confirm')),
        field('Confirmation id field', inp('idField', 'confirm_id')), field('Valid for (minutes)', h('input', { type: 'number', value: confirm.ttl, oninput: (e) => { confirm.ttl = e.target.value; } }))));
  })();
  // 093: three choices, one line each; the rule behind them and the log of changes made without asking under "?"
  const pick = bi ? null : h('div', { class: 'choices autonomy', role: 'group', 'aria-label': 'How sure before changing things' }, AUTONOMY.map(([v, label, line]) => h('button', {
    type: 'button', class: 'choice', 'aria-pressed': String(autonomy === v), disabled: !can('admin'),
    onclick: (e) => { autonomy = v; pick.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, h('b', {}, label), h('span', {}, line))));
  const sure = bi ? null : block('How sure before changing things', pick, h('p', { class: 'small muted' }, 'Tools that declare themselves destructive always ask, read-only ones never do; each service can differ (How it uses it). Participants never change things. ',
    helpLink('agents.md#how-sure-before-changing-things'), ' ', h('a', { href: '#activity/type=change.auto' }, 'Changes made without asking\u00a0›')));
  return { ready, value, el: h('div', {},
    sure,
    block('Its own tool services', srvList, addRow),
    block('Tool services for all agents', globalBox),
    block('Chat actions', h('p', { class: 'small muted' }, bi ? 'In your own chat it acts at once; anything sent elsewhere waits for your confirm.' : 'Organizer-only actions happen at once when an organizer asks. Every action is in Activity.'), waBox),
    modBox,
    confirmBox,
    h('details', { class: 'sblock' }, h('summary', {}, 'Tool rules (advanced)'), field('Participant rules', rulesBox.participant), field('Organizer rules', rulesBox.organizer), field('Never allowed', rulesBox.deny))) };
}
/** Quick replies, !help and FAQ (054): rows with a live preview filled with sample values. */
const SAMPLE = () => ({ name: 'Anu', group: 'your group', date: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '') });
const fill = (t, v) => String(t || '').replace(/\{(name|group|date|rules)\}/g, (m, k) => (v[k] === undefined ? m : v[k])).trim();
const preview = (text, v = SAMPLE()) => h('div', { class: 'qa-preview small' }, h('span', { class: 'eyebrow' }, 'Preview'), h('div', {}, fill(text, v) || '—'));
function buildQuick(x) {
  const ro = !can('admin');
  const qr = structuredClone(x.c.quickReplies || []);
  const faq = { items: [], strictness: 'normal', wholeGroup: false, ...structuredClone(x.c.faq || {}) };
  const help = check(x.c.help);
  const qrBox = h('div', { class: 'qa-rows' }); const faqBox = h('div', { class: 'qa-rows' });
  const drawQr = () => qrBox.replaceChildren(...qr.map((q, i) => {
    const prev = h('div', {}, preview(q.text));
    return h('div', { class: 'qa-row' },
      h('div', { class: 'row' }, h('input', { value: q.command || '', placeholder: '!rides', 'aria-label': 'Command', class: 'mono', style: 'max-width:160px', disabled: ro, oninput: (e) => { q.command = e.target.value.trim(); } }),
        h('select', { disabled: ro, 'aria-label': 'Who may use it', onchange: (e) => { q.who = e.target.value; } }, [['everyone', 'Everyone'], ['organizers', 'Organizers only']].map(([v, l]) => h('option', { value: v, selected: (q.who || 'everyone') === v }, l))),
        ro ? null : h('button', { type: 'button', class: 'btn small ghost', 'aria-label': `Remove ${q.command || 'quick reply'}`, onclick: () => { qr.splice(i, 1); drawQr(); } }, 'Remove')),
      h('textarea', { class: 'prose', style: 'min-height:60px;margin-top:6px', value: q.text || '', disabled: ro, 'aria-label': 'Answer', placeholder: 'The answer. Placeholders: {name} {group} {date}', oninput: (e) => { q.text = e.target.value; prev.replaceChildren(preview(q.text)); } }), prev);
  }), qr.length ? '' : h('p', { class: 'small muted' }, 'No quick replies yet.'));
  const drawFaq = () => faqBox.replaceChildren(...faq.items.map((it, i) => {
    const prev = h('div', {}, preview(it.answer));
    return h('div', { class: 'qa-row' },
      field('Questions (one way of asking per line)', h('textarea', { class: 'prose', style: 'min-height:50px', value: (it.questions || []).join('\n'), disabled: ro, oninput: (e) => { it.questions = e.target.value.split('\n').map((y) => y.trim()).filter(Boolean); } })),
      field('Keywords (optional)', h('input', { value: (it.keywords || []).join(', '), disabled: ro, placeholder: 'bus, departure', oninput: (e) => { it.keywords = e.target.value.split(',').map((y) => y.trim()).filter(Boolean); } })),
      field('Answer', h('textarea', { class: 'prose', style: 'min-height:56px', value: it.answer || '', disabled: ro, oninput: (e) => { it.answer = e.target.value; prev.replaceChildren(preview(it.answer)); } })),
      prev, ro ? null : h('button', { type: 'button', class: 'btn small ghost', onclick: () => { faq.items.splice(i, 1); drawFaq(); } }, 'Remove question'));
  }), faq.items.length ? '' : h('p', { class: 'small muted' }, 'No questions yet.'));
  drawQr(); drawFaq();
  const whole = check(faq.wholeGroup, ro); whole.onchange = () => { faq.wholeGroup = whole.checked; };
  return { el: h('div', { id: 'quick-answers' },
    block('Quick replies', h('p', { class: 'small muted' }, 'A command as the whole message or its first word, e.g. !rides.'), qrBox,
      ro ? null : h('button', { type: 'button', class: 'btn small', onclick: () => { qr.push({ command: '', text: '', who: 'everyone' }); drawQr(); } }, '+ Add quick reply'),
      tick(help, '“!help” lists these commands')),
    block('FAQ', h('p', { class: 'small muted' }, 'A message that clearly matches gets your answer; the agent knows the rest.'), faqBox,
      ro ? null : h('button', { type: 'button', class: 'btn small', onclick: () => { faq.items.push({ questions: [], keywords: [], answer: '' }); drawFaq(); } }, '+ Add question'),
      field('Match', seg('How closely a message must match', [['normal', 'Normal'], ['strict', 'Strict']], faq.strictness, (v) => { faq.strictness = v; })),
      tick(whole, 'Answer in the whole group, not only when addressed'))),
  value: () => ({ quickReplies: qr.filter((q) => q.command || q.text), help: help.checked, faq: { ...faq, items: faq.items.filter((it) => (it.questions || []).length || (it.keywords || []).length || it.answer) } }) };
}
function buildWelcome(x) {
  const ro = !can('admin');
  const wel = { enabled: false, text: '', rules: '', ...structuredClone(x.c.welcome || {}) };
  const prev = h('div', {});
  const drawPrev = () => { const t = wel.text || 'Welcome {name} to {group}! 👋'; prev.replaceChildren(preview(wel.rules && !t.includes('{rules}') ? `${t}\n\n{rules}` : t, { ...SAMPLE(), name: '@Mia', rules: wel.rules })); };
  const on = check(wel.enabled, ro); on.onchange = () => { wel.enabled = on.checked; };
  drawPrev();
  return { el: h('div', {}, tick(on, 'Greet people who join a group'),
    field('Message', h('textarea', { class: 'prose', style: 'min-height:56px', value: wel.text, disabled: ro, placeholder: 'Welcome {name} to {group}! 👋', oninput: (e) => { wel.text = e.target.value; drawPrev(); } }), '{name} becomes an @mention; {rules} the rules below. A chat can override this.'),
    field('Group rules', h('textarea', { class: 'prose', style: 'min-height:56px', value: wel.rules, disabled: ro, placeholder: 'Optional, e.g. Be kind. Rides are posted on Sundays.', oninput: (e) => { wel.rules = e.target.value; drawPrev(); } })), prev),
  value: () => ({ welcome: wel }) };
}
/** Test console (#37): a role and a chat; shows the tools that role gets. Never sends to WhatsApp. The owner assistant
 *  gets the Ask conversation instead (066). */
function buildTest(x) {
  if (x.bi) return { el: askCard({ id: 'test-console', title: 'Try it', wide: false }) };
  const log = h('div', { class: 'chatlog' });
  let thread = []; // #163: sent with each message
  const fresh = () => { thread = []; log.replaceChildren(); };
  const role = h('select', { 'aria-label': 'Test as role', onchange: () => { fresh(); loadTools(); } }, h('option', { value: 'participant' }, 'a participant'), h('option', { value: 'organizer' }, 'an organizer'));
  const where = h('select', { 'aria-label': 'Test in chat', onchange: () => { fresh(); hintBox.replaceChildren(x.chats.find((ch) => ch.id === where.value && !ch.enabled) ? h('div', { class: 'small', style: 'color:var(--warn)' }, 'This chat is Off: in WhatsApp the agent stays silent there.') : null); } },
    h('option', { value: 'new' }, 'a new direct chat'), x.chats.map((ch) => h('option', { value: ch.id }, `${ch.isGroup ? 'group' : 'chat'}: ${ch.name || ch.id}`)));
  const hintBox = h('div', {});
  const toolsBox = h('details', { class: 'small' }, h('summary', {}, 'Tools for this role…'));
  async function loadTools() {
    const r0 = role.value;
    toolsBox.replaceChildren(h('summary', {}, h('span', { class: 'spinner' }), ' Loading tools…'));
    const r = await api('GET', `/api/agents/${x.enc}/test-tools?role=${r0}`).catch((e) => ({ error: e.message }));
    if (role.value !== r0) return;
    const who = r0 === 'organizer' ? 'organizers' : 'participants';
    toolsBox.replaceChildren(h('summary', {}, r.error ? `Tools for ${who}: could not load` : `Tools ${who} get (${r.count})`),
      r.error ? h('div', { class: 'note bad' }, r.error) : null,
      (r.errors || []).map((e) => h('div', { class: 'note warn' }, `A tool service did not answer: ${e}`)),
      r.services?.length ? r.services.map((sv) => h('div', { style: 'margin-top:8px' }, h('b', {}, sv.name), sv.global ? h('span', { class: 'small muted' }, ' · for all agents') : null,
        h('ul', { class: 'toolset' }, sv.tools.map((t) => h('li', {}, h('code', {}, t.name), t.description && t.description !== t.name ? h('span', { class: 'muted' }, ` — ${t.description}`) : null)))))
        : r.error ? null : h('p', { class: 'muted' }, `No tools: ${who} get answers from the instructions and memory.`));
  }
  loadTools();
  const input = h('input', { placeholder: 'Ask the agent something…', 'aria-label': 'Message to the agent' });
  const form = h('form', { class: 'row nowrap', onsubmit: async (e) => {
    e.preventDefault(); const text = input.value.trim(); if (!text) return;
    const as = role.value === 'organizer' ? 'organizer' : 'participant';
    log.append(h('div', { class: 'bubble me', title: `as ${as}` }, text)); input.value = '';
    const wait = h('div', { class: 'bubble agent muted' }, '…'); log.append(wait); log.scrollTop = 1e9;
    try {
      const r = await api('POST', `/api/agents/${x.enc}/test`, { text, role: as, chat: where.value, thread });
      thread.push({ from: 'me', text }, { from: 'agent', text: r.reply || '' }); thread = thread.slice(-20);
      wait.textContent = r.reply || '(no reply)'; wait.classList.remove('muted'); if (r.model) wait.title = `${r.answeredBy || r.model} · as ${as}`;
      const path = r.path === 'quick' ? `${r.answeredBy || 'Quick reply'} · no AI` : r.path === 'faq' ? 'FAQ answer · no AI' : r.path === 'model' ? `Model${r.model ? ` · ${modelLabel(r.answeredBy && r.answeredBy.includes(':') ? r.answeredBy : r.model, x.models)}` : ''}` : '';
      if (path) wait.after(h('div', { class: 'small muted test-path' }, path.charAt(0).toUpperCase() + path.slice(1)));
      const fbl = fallbackLine(r.fallback);
      if (fbl) wait.after(h('div', { class: 'small muted test-path' }, `${fbl}.`));
    } catch (err) { wait.textContent = `Error: ${err.message}`; }
    log.scrollTop = 1e9;
  } }, input, h('button', { class: 'btn primary' }, 'Send'));
  const restart = h('button', { class: 'btn small ghost', type: 'button', onclick: () => { fresh(); input.focus(); } }, 'New conversation');
  return { el: h('div', { id: 'test-console' }, h('div', { class: 'row test-as' }, h('span', { class: 'small' }, 'As'), role, h('span', { class: 'small' }, 'in'), where, restart), hintBox, toolsBox, log, form) };
}

