// Responsive check of the admin panel (issue #1). Needs Chrome or Chromium. CI runs the navigation states only (066):
// nav-stress, load-failed, load-retry (see .github/workflows/ci.yml).
//
//   npm run check:responsive                      all screens at 375 / 393 / 1440 px, light and dark
//   npm run check:responsive -- --shots /tmp/rs   … and save a full-page screenshot of every screen and state
//   npm run check:responsive -- --widths 375 --schemes dark --only chats,usage
//   CHROME_PATH=/path/to/chrome npm run check:responsive
//
// It starts the demo panel (scripts/demo-panel.mjs: real core + panel, seeded data, fake WhatsApp and models, no
// network), drives headless Chrome over the DevTools protocol (no extra dependencies) and checks every screen:
//   - no horizontal page scrolling (only tab bars, tables in a scroll box and code may scroll sideways)
//   - phones (< 600 px): tap targets at least 40 × 40 px, text at least 13 px
//   - accessibility (064): every control has a name (the browser's accessibility tree, as a screen reader reads it) and
//     text meets WCAG AA contrast against what is behind it (4.5:1, 3:1 for large text), in light and dark; (066) icons
//     reach 3:1 against what is behind them, pills drawn by ::before included
// Exit code 1 lists what failed.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { startDemo, DEMO_PASSWORD, fakeChecklist, FAKE_CHECKLIST, PANEL } from './demo-panel.mjs';
import { launch, newPage } from './cdp.mjs';

const { values: opt } = parseArgs({ options: {
  widths: { type: 'string', default: '375,393,1440' }, schemes: { type: 'string', default: 'light,dark' },
  only: { type: 'string', default: '' }, shots: { type: 'string', default: '' },
} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- screens and states ----------
// 066: a request that never answers (a phone that suspended the app): the screen ends in Couldn't load + Retry, not
// endless placeholder cards; with the server back, Retry draws the screen.
const NAV_STRESS = `window.__realFetch ||= window.fetch; const { dropCache } = await import('/app/core.js');
  // slow lists, and a screen whose second request is slower than the first (it draws, then waits: the 064 skeleton timer
  // used to replace what was drawn)
  window.fetch = async (u, o) => { await T.wait(String(u).startsWith('/api/activity') ? 300 + Math.random() * 300 : Math.random() < 0.5 ? 0 : Math.random() * 400); return window.__realFetch(u, o); };
  const phone = innerWidth < 641; const tabs = ['activity', 'chats', 'agents', 'overview', 'usage', 'models', 'server', 'activity', 'people', 'settings', 'activity'];
  const go = async (id) => {
    const bar = document.querySelector(phone ? 'nav.tabbar' : 'nav.tabs');
    const b = bar.querySelector('button[data-tab="' + id + '"]');
    if (b) return b.click();
    bar.querySelector('button[data-tab="more"]').click(); await T.until('dialog.more', 3000);
    [...document.querySelectorAll('dialog.more .more-list button')].find((x) => x.textContent.toLowerCase().startsWith(id))?.click();
  };
  for (let round = 0; round < 3; round++) for (const id of tabs) { dropCache(); window.scrollTo(0, 99999); const was = S.tab; await go(id); await T.wait(20); if (was !== S.tab && scrollY !== 0 && !location.hash.includes('/')) throw new Error('switching to ' + id + ' kept the page scrolled to ' + scrollY); await T.wait([0, 30, 130, 260, 600][Math.floor(Math.random() * 5)]); }
  await T.wait(3500); window.fetch = window.__realFetch;
  const main = document.getElementById('main');
  const hd = document.querySelector('header').getBoundingClientRect(); if (hd.top < 0 || hd.bottom <= 0) throw new Error('header not in view after switching');
  if (main.querySelector('.skel') || main.classList.contains('loading')) throw new Error('stuck on placeholders on ' + S.tab);
  if (main.dataset.screen !== S.tab) throw new Error('screen ' + main.dataset.screen + ' drawn under tab ' + S.tab);
  if (S.tab === 'activity' && !document.getElementById('feed')?.isConnected) throw new Error('activity list not on screen; shown: ' + main.textContent.trim().slice(0, 60));`;
const HANG_AGENTS = `const { dropCache } = await import('/app/core.js'); dropCache(); S.loadTimeout = 800; window.__realFetch ||= window.fetch;
  window.fetch = (u, o) => (String(u).startsWith('/api/agents') ? new Promise((_, no) => o?.signal?.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError')))) : window.__realFetch(u, o));`;
// 045: pretend v3.0.0 (breaking) is available, with v2.26.0 still safe to install; 065: the notes of the range are the
// demo's own release notes since v2.23.0 plus the breaking v3.0.0.
const UPDATE_DECISION = `const f0 = window.fetch; window.fetch = async (u, o) => { const r = await f0(u, o);
  if (String(u) === '/api/updates' && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json();
    const steps = [{ version: '3.0.0', title: 'New memory format (fresh memory)', summary: 'Chat memory moves to a new format. Running summaries start fresh; messages and agents stay.', actions: ['Check the running summaries of your main chats after the update.', 'Re-run the installer once so the maintenance helper knows the new options.'], data: 'not-migrated', docs: 'docs/upgrading.md' }];
    const older = (await (await f0('/api/releases?from=v2.23.0')).json()).versions;
    const notes = [{ ...steps[0], breaking: true, changes: [{ type: 'new', text: 'Memory keeps a separate summary per topic.' }, { type: 'removed', text: 'The old memory format.' }] }, ...older];
    return new Response(JSON.stringify({ ...j, status: { ...j.status, current: 'v2.23.0', available: true, latest: 'v3.0.0', target: 'v3.0.0', breaking: true, steps, notes, safeTarget: 'v2.26.0', decisionVersion: '3.0.0' },
      decision: { version: 'v3.0.0', target: 'v3.0.0', current: 'v2.23.0', steps, safeTarget: 'v2.26.0', notifiedAt: Date.now() - 3600000, snoozedUntil: null, dismissed: false, show: true, backup: true, docker: false } })); }
  return r; };`;
// 065: an ordinary update from v2.22.0 to the demo's version, with the notes in between
const UPDATE_AVAILABLE = `const f0 = window.fetch; window.fetch = async (u, o) => { const r = await f0(u, o);
  if (String(u) === '/api/updates' && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json();
    const notes = (await (await f0('/api/releases?from=v2.22.0')).json()).versions;
    return new Response(JSON.stringify({ ...j, decision: null, status: { ...j.status, current: 'v2.22.0', available: true, latest: 'v' + notes[0].version, target: 'v' + notes[0].version, breaking: false, steps: [], notes, safeTarget: 'v' + notes[0].version } })); }
  return r; };`;
const WHATS_NEW = "S.status.whatsNew = { from: 'v2.24.0', to: S.status.version.split(' ')[0] }; show('overview'); await T.wait(400);";
// 052: the Add answer of Browse tool services, without changing the demo data (states run several times).
const REGISTRY_ADDED = `const f1 = window.fetch; window.fetch = async (u, o) => {
  if (String(u) === '/api/tool-services/registry/add') return new Response(JSON.stringify({ key: 'forecast', kind: 'remote', target: 'all', registry: { name: 'io.github.example-weather/forecast-mcp', version: '1.4.0' },
    secretsStored: [], warnings: [], confirmGate: null, discovery: { status: 'ok', tools: [
      { name: 'forecast', description: 'Weather forecast for a place and day (temperature, rain, wind).', risky: false, organizer: true, participant: false },
      { name: 'alerts', description: 'Official weather warnings for a region.', risky: false, organizer: true, participant: false },
      { name: 'set_alert', description: 'Send a message when a warning starts.', risky: true, organizer: true, participant: false }] } }), { status: 201, headers: { 'content-type': 'application/json' } });
  return f1(u, o); };`;
// 073: every tappable element on Overview: focused by script after a tap → no ring; after Tab → a ring.
const FOCUS_RINGS = `const ring = (e) => { const st = getComputedStyle(e); return st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0; };
  const els = [...document.querySelectorAll('nav button, button, a[href], summary')].filter((e) => e.offsetParent || e.closest('nav')).slice(0, 60);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  for (const e of els) { e.focus({ preventScroll: true }); if (document.activeElement === e && ring(e)) throw new Error('focus ring after a tap: ' + (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40)); }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  const b = els[0]; b.blur(); b.focus({ preventScroll: true });
  if (!ring(b)) throw new Error('no focus ring for keyboard users');
  b.blur(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));`;
// js runs in the page after the screen loaded; T.* helpers are defined in PRELUDE.
const STATES = [
  { name: 'login', hash: '', js: "await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); await (await import('/app/login.js')).renderLogin();", relogin: true },
  { name: 'setup', hash: '', js: "S.es?.close(); S.tab = ''; const f0 = window.fetch; window.fetch = (u, o) => (String(u).startsWith('/api/session') ? Promise.resolve(new Response(JSON.stringify({ needsSetup: true }))) : f0(u, o)); await (await import('/app/login.js')).renderLogin();" },
  { name: 'setup-restore', hash: '', js: "S.es?.close(); S.tab = ''; const f0 = window.fetch; window.fetch = (u, o) => (String(u).startsWith('/api/session') ? Promise.resolve(new Response(JSON.stringify({ needsSetup: true }))) : f0(u, o)); await (await import('/app/login.js')).renderLogin(); await T.click('Restore a backup');" },
  { name: 'overview', hash: 'overview' },
  // 061: the install hint without the browser's install prompt (iPhone, Firefox): the manual steps instead of a button
  { name: 'overview-install-steps', hash: 'overview', js: "S.installPrompt = null; localStorage.removeItem('duniya.installHint'); show(S.tab); await T.wait(300);" },
  // 062: Getting started, each step open in place (as on a fresh install), and the closing card
  ...['whatsapp', 'provider', 'agent', 'chat', 'reply'].map((step) => ({ name: `overview-start-${step}`, hash: 'overview', checklist: fakeChecklist(step), wait: 2000 })),
  { name: 'overview-start-done', hash: 'overview', checklist: fakeChecklist('', { done: true }), wait: 2000 },
  // 062: Find anything (/ or ⌘K), empty and with a query
  { name: 'find', hash: 'overview', js: 'await openFind(); await T.wait(600);' },
  { name: 'find-search-messages', hash: 'chats', js: "await openFind(); await T.wait(600); const i = document.querySelector('#palette input'); i.value = 'cornavin'; i.dispatchEvent(new Event('input')); await T.wait(200); [...document.querySelectorAll('#palette li')].at(-1).click(); await T.until('.pal-msg'); await T.wait(300);" }, // 070
  { name: 'find-query', hash: 'chats', js: "await openFind(); await T.wait(600); const i = document.querySelector('#palette input'); i.value = 'gen'; i.dispatchEvent(new Event('input')); await T.wait(200);" },
  { name: 'chats-find', hash: 'chats', js: "const i = document.querySelector('.ld-tools input'); i.value = 'car'; i.dispatchEvent(new Event('input')); await T.wait(200);" },
  // 045: a breaking release waits for the owner (banner on Overview, the dialog with release notes)
  { name: 'overview-update-decision', hash: 'overview', before: UPDATE_DECISION, wait: 1500 },
  { name: 'update-decision-dialog', hash: 'overview', before: UPDATE_DECISION, wait: 1500, js: "await T.click('Review update', 'button', 1200);" },
  // 065: the update dialog lists every release in between; What's new after an update; Settings → Release notes
  { name: 'update-dialog', hash: 'overview', before: UPDATE_AVAILABLE, wait: 1500, js: "await T.click('Update to v', 'button', 1200);" },
  { name: 'overview-whats-new', hash: 'overview', wait: 1500, js: WHATS_NEW },
  { name: 'whats-new-dialog', hash: 'overview', wait: 1500, js: `${WHATS_NEW} await T.click("See what's new", 'button', 1200);` },
  { name: 'settings-release-notes', hash: 'settings/release-notes', wait: 2000 },
  // 073: Overview's update is one row; the whole story is Settings → Updates
  { name: 'overview-update-available', hash: 'overview', before: UPDATE_AVAILABLE, wait: 1500 },
  { name: 'settings-updates', hash: 'settings/updates', wait: 2000 },
  { name: 'settings-updates-available', hash: 'settings/updates', before: UPDATE_AVAILABLE, wait: 2000 },
  // 073: no focus ring after a tap or click, even when focus moves by script (Chrome on Android); a ring for the keyboard
  { name: 'focus-ring-touch', hash: 'overview', wait: 1500, js: FOCUS_RINGS },
  { name: 'activity', hash: 'activity', js: "document.querySelector('#feed .fitem')?.click(); await T.wait(300);" },
  { name: 'agents', hash: 'agents' },
  // 066: fast tab switching (bottom tab bar, More sheet, top tabs), on a slow network, from deep down a long screen, must
  // always start the new screen at the top (iPhone painted the area above blank otherwise) and end on the chosen screen
  // fully drawn: no placeholder cards left, no screen drawn under another tab, header in view. Throws otherwise.
  { name: 'nav-stress', hash: 'overview', wait: 2000, js: NAV_STRESS },
  { name: 'load-failed', hash: 'agents', before: HANG_AGENTS, wait: 2500, js: "if (!document.querySelector('.load-failed')) throw new Error('no Retry card after a hung request'); window.fetch = window.__realFetch; S.loadTimeout = 15000;" },
  { name: 'load-retry', hash: 'agents', before: HANG_AGENTS, wait: 2500, js: "window.fetch = window.__realFetch; S.loadTimeout = 15000; await T.click('Retry', 'button', 1500); if (document.querySelector('.load-failed, .skel') || !document.querySelector('.ld-list .lrow')) throw new Error('Retry did not recover the screen');" },
  { name: 'pull-refresh', hash: 'overview', js: "const m = document.createElement('div'); m.className = 'ptr armed busy'; m.setAttribute('aria-hidden', 'true'); m.append(Object.assign(document.createElement('span'), { className: 'spinner' })); m.style.transform = 'translate(-50%, 64px)'; document.body.append(m); await T.wait(200);" },
  { name: 'agents-new', hash: 'agents/new', wait: 2000 },
  { name: 'agents-ai-draft', hash: 'agents/new', wait: 2000, js: "const ta = document.querySelector('#main textarea'); ta.value = 'A helper for our running club'; await T.click('Draft', 'button', 2500);" },
  { name: 'agent-editor-ai-diff', hash: 'agents/carpool', wait: 2500, js: "await T.click('Change with AI', 'button', 600); const ta = document.querySelector('dialog textarea'); ta.value = 'Shorter replies, make Lea an organizer, weather before rides'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); document.querySelector('.dskip')?.click();" },
  { name: 'agent-editor-ai-side', hash: 'agents/carpool', wait: 2500, js: "await T.click('Change with AI', 'button', 600); const ta = document.querySelector('dialog textarea'); ta.value = 'Shorter replies'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); await T.click('Side by side', 'button', 300);" },
  { name: 'agent-editor-ai-whole', hash: 'agents/carpool', wait: 2500, js: "await T.click('Change with AI', 'button', 600); const ta = document.querySelector('dialog textarea'); ta.value = 'Shorter replies'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); await T.click('Whole new text', 'button', 300);" },
  // 068: the agent page (header + section rows) and each section page; the owner assistant uses the same page
  { name: 'agent-editor', hash: 'agents/carpool', wait: 2500 },
  { name: 'agent-editor-owner', hash: 'agents/owner-assistant', wait: 2500 }, // 059: the built-in owner assistant
  ...['character', 'where', 'people', 'quick', 'welcome', 'schedules', 'model', 'memory', 'media', 'cap', 'advanced', 'review'].map((sec) => ({ name: `agent-sec-${sec}`, hash: `agents/carpool/${sec}`, wait: 2500, js: 'T.openAll();' })),
  { name: 'agent-sec-alerts', hash: 'agents/owner-assistant/alerts', wait: 2500 },
  { name: 'agent-wake-words', hash: 'agents/carpool/where', wait: 2500, js: "const i = document.querySelector('.tags input'); const n = document.querySelectorAll('.tag').length; i.value = 'Silku'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await T.wait(150); if (document.querySelectorAll('.tag').length !== n + 1 || ![...document.querySelectorAll('.tag')].some((x) => x.textContent.startsWith('silku'))) throw new Error('Enter did not add a lowercase tag'); if (!document.querySelector('.sec-save.dirty')) throw new Error('no Save bar after adding a wake word'); document.querySelector('.tag-x').click(); await T.wait(150); if (document.querySelectorAll('.tag').length !== n) throw new Error('× did not remove a tag');" },
  { name: 'agent-sec-dirty', hash: 'agents/carpool/character', wait: 2500, js: "const i = document.querySelector('.sbody input'); i.value += ' 2'; i.dispatchEvent(new Event('input', { bubbles: true })); await T.wait(200); if (!document.querySelector('.sec-save.dirty')) throw new Error('no Save bar after a change');" },
  { name: 'agent-editor-tools', hash: 'agents/carpool/tools', wait: 2500, js: "await T.click('Choose tools', 'button', 1500); T.openAll();" },
  { name: 'agent-tools-everyone', hash: 'agents/carpool/tools', wait: 2500, js: "await T.click('Choose tools', 'button', 1500); await T.click('Everyone: all tools', 'button', 300); const t = document.querySelector('table.stack.flat'); if (!t || [...t.querySelectorAll('input[type=checkbox]')].some((c) => !c.checked)) throw new Error('Everyone: all tools left a tool unticked'); document.querySelector('[aria-label=\\'All tools: Participants\\']').click(); await T.wait(200); if ([...document.querySelectorAll('table.stack.flat tbody tr td:nth-child(2) input')].some((c) => c.checked)) throw new Error('the Participants header tick did not clear the column');" },
  { name: 'agent-editor-test', hash: 'agents/school/test', wait: 2500, js: "const i = document.querySelector('input[placeholder^=\"Ask the\"]'); i.value = 'When are the museum trip forms due?'; await T.click('Send', 'button', 1800);" },
  { name: 'agent-editor-test-as', hash: 'agents/carpool/test', wait: 2500, js: "const sel = document.querySelector('select[aria-label=\"Test as role\"]'); sel.value = 'organizer'; sel.dispatchEvent(new Event('change')); await T.wait(1500); T.openAll();" },
  { name: 'agent-editor-quick-test', hash: 'agents/carpool/test', wait: 2500, js: "const i = document.querySelector('#test-console input[placeholder^=\"Ask the\"]'); i.value = '!rides'; await T.click('Send', 'button', 900);" },
  { name: 'agent-editor-empty', hash: 'agents/neighbours', wait: 2500 },
  // 066: the Ask conversation — thinking, a tool running, streaming with markdown, done with a follow-up and a confirm, an error
  { name: 'overview-ask-thinking', hash: 'overview', js: "S.ask = { draft: '', busy: true, turns: [{ q: 'How is the server doing?', state: 'thinking', steps: [], confirms: [], reply: '' }] }; show(S.tab); await T.wait(600); S.ask.busy = false;" },
  { name: 'overview-ask-streaming', hash: 'overview', js: "S.ask = { draft: '', busy: true, turns: [{ q: 'What did the families decide?', state: 'streaming', steps: [{ step: 'tool', tool: 'list_visible_chats', ok: true }, { step: 'calling', tool: 'chat_recap' }], confirms: [], reply: 'Here is what I found so far:\\n\\n- **Carpool:** Luca drives on Friday\\n- Class 4B: forms' }] }; show(S.tab); await T.wait(600); S.ask.busy = false;" },
  { name: 'overview-ask-done', hash: 'overview', js: "S.ask = { draft: '', busy: false, turns: [{ q: 'What did the families decide this week?', state: 'done', steps: [{ step: 'tool', tool: 'list_visible_chats', ok: true }, { step: 'tool', tool: 'chat_recap', ok: true }, { step: 'tool', tool: 'search_messages', ok: false }], confirms: [], reply: 'Two decisions this week:\\n\\n- **Carpool:** Luca drives on Friday, Mia back from Cornavin.\\n- **Class 4B:** museum forms are due **Monday 24 Nov**.\\n\\nNothing else needs you.' }, { q: 'Remind the class group on Sunday', state: 'done', steps: [{ step: 'held', tool: 'send_chat_intro', ok: true }], confirms: [{ code: 'K7Q2', preview: 'Post in Class 4B parents on Sunday 23 Nov at 18:00: “Reminder: museum forms are due tomorrow.”' }], reply: 'Here is what I prepared:' }] }; show(S.tab); await T.wait(600);" },
  { name: 'overview-ask-error', hash: 'overview', js: "S.ask = { draft: 'How is the server doing?', busy: false, turns: [{ q: 'How is the server doing?', state: 'error', error: 'All usable AI providers are paused (Claude: usage limit reached, tries again at 10:05).', steps: [], confirms: [], reply: '' }] }; show(S.tab); await T.wait(600);" },
  // #136: sending empties the box (the question moves into the thread)
  { name: 'overview-ask-sent', hash: 'overview', wait: 2000, js: "const t = () => document.querySelector('#ov-ask textarea'); t().value = 'How is the server doing?'; t().dispatchEvent(new Event('input')); [...document.querySelectorAll('#ov-ask button')].find((b) => b.getAttribute('aria-label') === 'Ask').click(); await T.wait(400); if (t().value) throw new Error('Ask kept the question in the box'); await T.wait(2500);" },
  { name: 'overview-ask-restarted', hash: 'overview', js: "S.ask = { draft: '', busy: true, turns: [{ q: 'Who is driving on Friday?', state: 'streaming', restarted: true, steps: [{ step: 'tool', tool: 'chat_recap', ok: true }], confirms: [], reply: '' }] }; show(S.tab); await T.wait(600); S.ask.busy = false;" },
  { name: 'agent-editor-owner-ask', hash: 'agents/owner-assistant/test', wait: 2500, js: "S.ask = { draft: '', busy: false, turns: [{ q: 'What did the families decide this week?', state: 'done', steps: [{ step: 'tool', tool: 'list_visible_chats', ok: true }, { step: 'tool', tool: 'chat_recap', ok: true }, { step: 'tool', tool: 'search_messages', ok: false }], confirms: [], reply: 'Two decisions this week:\\n\\n- **Carpool:** Luca drives on Friday, Mia back from Cornavin.\\n- **Class 4B:** museum forms are due **Monday 24 Nov**.\\n\\nNothing else needs you.' }] }; show(S.tab); await T.wait(1500); document.getElementById('test-console')?.scrollIntoView(); await T.wait(300);" },
  // 052: Browse tool services — the search sheet, the Add form with a key, and the result with its tools
  { name: 'registry-browse', hash: 'agents/carpool/tools', wait: 2500, js: "await T.click('Browse tool services', 'button', 1500);" },
  { name: 'registry-add', hash: 'agents/carpool/tools', wait: 2500, js: "await T.click('Browse tool services', 'button', 1500); [...document.querySelectorAll('.reg-card')].find((c) => c.textContent.includes('Recipe box')).querySelector('button').click(); await T.until('dialog form input[type=password]'); await T.wait(300);" },
  { name: 'registry-added', hash: 'settings/tool-services', wait: 2000, before: REGISTRY_ADDED, js: "await T.click('Browse tool services', 'button', 1500); [...document.querySelectorAll('.reg-card')].find((c) => c.textContent.includes('Weather forecasts')).querySelector('button').click(); await T.until('dialog form'); await T.click('Add to all agents', 'button', 1200);" },
  { name: 'chats', hash: 'chats' },
  // 064: a chat's less-used settings open in place; the phone tab bar's More sheet; toasts (undo, error)
  { name: 'chat-page', hash: 'chats/120363041122330003%40g.us', wait: 2000 },
  { name: 'toasts', hash: 'chats', js: "const { toast } = await import('/app/core.js'); toast('Book club off — agents ignore it', { undo: () => {} }); toast('The server did not answer. Try again.', { bad: true }); await T.wait(400);" },
  { name: 'chats-fallback', hash: 'chats/120363041122330003%40g.us', wait: 2000, js: "document.querySelector('button[aria-label^=\"Model fallback\"]')?.click(); await T.until('#chat-fallback select'); await T.wait(400);" },
  { name: 'chats-add-dm', hash: 'chats/add', wait: 2000, js: "const i = document.querySelector('input[inputmode=tel]'); if (i) { i.value = '+41 79 000 00 30'; i.dispatchEvent(new Event('change')); } await T.wait(600);" },
  { name: 'chats-intro', hash: 'chats/41790000009%40s.whatsapp.net', wait: 2000, js: "document.querySelector('.chat-page details.menu summary')?.click(); await T.click('Send intro', 'button', 100); await T.until('textarea[aria-label=\"Intro text\"]'); await T.wait(400);" },
  // 072: a chat's sections, each its own page: Messages (answers in the agent's colour with 👍 / 👎), opened at one
  // answer (Review → In chat), Memory, the WhatsApp group; Activity of one chat with an open reply
  { name: 'chats-message-delete', hash: 'chats/120363041122330003%40g.us/messages', wait: 2500, js: "await T.until('.msgs [data-msg]'); const m = document.querySelector('.msgs .bubble.agent[data-msg]'); m.focus(); await T.wait(150); const b = m.querySelector('.msg-acts .msg-del'); if (!b || getComputedStyle(b.parentElement).display === 'none') throw new Error('Delete does not show after tapping a message'); b.click(); await T.until('dialog[open]');" },
  { name: 'chats-messages', hash: 'chats/120363041122330003%40g.us/messages', wait: 2500, js: "await T.until('.msg-ans .rv-acts'); if (!document.querySelector('.msg-ans .av')) throw new Error('answer without its agent');" },
  { name: 'chats-messages-at', hash: 'chats/120363041122330003%40g.us', wait: 2500, js: "const r = await (await fetch('/api/agents/carpool/review')).json(); location.hash = 'chats/120363041122330003%40g.us/messages/' + r.answers[0].id; await T.until('.chatlog .hit'); await T.wait(300);" },
  { name: 'chats-memory', hash: 'chats/120363041122330003%40g.us/memory', wait: 2500 },
  { name: 'chats-group', hash: 'chats/120363041122330003%40g.us/group', wait: 2500, js: "await T.until('.wa-settings'); T.openAll();" },
  { name: 'activity-chat', hash: 'activity/chat=120363041122330003%40g.us', wait: 2000, js: "[...document.querySelectorAll('#feed .fitem')].find((li) => li.textContent.includes('Reply'))?.click(); await T.until('.fopen .rv-acts, .fopen .fx'); await T.wait(300);" },
  { name: 'more-sheet', hash: 'overview', js: "(await import('/app/find.js')).openMore(); await T.wait(400);" },
  { name: 'more-sheet-account', hash: 'overview', js: "const { askSignOut } = await import('/app/core.js'); askSignOut(); await T.wait(400);" },
  // 078: People — the list (search, filter), a person's page (ties, household, notes, tags, lists), a kid without an
  // app, a number not in People, Households and Lists (list → page), the add-tie and erase dialogs
  { name: 'people', hash: 'people' },
  { name: 'people-filter', hash: 'people', js: "const s = document.querySelector('#main select'); s.value = 'tag:badminton'; s.dispatchEvent(new Event('change')); await T.wait(800);" },
  { name: 'person', hash: 'people/41790000001', wait: 1500 },
  { name: 'person-kid', hash: 'people', js: "const r = await (await fetch('/api/people?q=vedika')).json(); location.hash = 'people/' + r[0].id; await T.until('.person-page .timeline'); await T.wait(300);" },
  { name: 'person-not-in-people', hash: 'people/41790000999', wait: 1500 },
  { name: 'person-add-tie', hash: 'people/41790000001', wait: 1500, js: "await T.click('Add a tie', 'button', 600);" },
  { name: 'person-hide', hash: 'people/41790000001', wait: 1500, js: "document.querySelector('.person-page details.menu summary').click(); await T.click('Hide', 'button', 600);" },
  { name: 'people-source', hash: 'people', js: "const s = document.querySelector('#main select'); s.value = 'source:phone'; s.dispatchEvent(new Event('change')); await T.wait(800);" },
  { name: 'people-hidden', hash: 'people', js: "const s = document.querySelector('#main select'); s.value = 'hidden:1'; s.dispatchEvent(new Event('change')); await T.wait(800);" },
  { name: 'person-hidden', hash: 'people', js: "const r = await (await fetch('/api/people?hidden=1')).json(); location.hash = 'people/' + r[0].id; await T.until('.person-page .lgroup'); await T.wait(300);" },
  { name: 'agent-people-picker', hash: 'agents/carpool/people', wait: 2500, js: "T.openAll(); const i = document.querySelector('.tags input'); i.value = 'bad'; i.dispatchEvent(new Event('input')); await T.wait(800);" },
  { name: 'people-households', hash: 'people/households', wait: 1200 },
  { name: 'people-household', hash: 'people', js: "const r = await (await fetch('/api/households')).json(); location.hash = 'people/households/' + r[0].id; await T.until('.person-page .lgroup'); await T.wait(300);" },
  { name: 'people-lists', hash: 'people/lists', wait: 1200 },
  { name: 'people-list', hash: 'people', js: "const r = await (await fetch('/api/lists')).json(); location.hash = 'people/lists/' + r[0].id; await T.until('.person-page .lgroup'); await T.wait(300);" },
  { name: 'models', hash: 'models', js: 'T.openAll();' },
  // 064: list → page: a provider's page, the Add page, Backups → Restore, Settings sections
  { name: 'models-provider', hash: 'models/chatgpt', js: 'T.openAll();' },
  { name: 'models-add', hash: 'models/add' },
  { name: 'models-claudecode', hash: 'models/claudecode', js: 'T.openAll();' }, // 074: an agent app, connected
  { name: 'models-codex', hash: 'models/codex' }, // 074: an agent app's device sign-in steps
  { name: 'models-paused', hash: 'models/openrouter' }, // 042: an account paused by its usage limit
  { name: 'backups-restore', hash: 'backups/restore' },
  { name: 'settings-whatsapp', hash: 'settings/whatsapp', wait: 2000, js: 'T.openAll();' }, // 075: Settings → Channels → WhatsApp
  { name: 'settings-telegram', hash: 'settings/telegram', wait: 2000, js: 'T.openAll();' }, // 077: Settings → Channels → Telegram (fake bot)
  { name: 'chats-telegram-group', hash: `chats/${encodeURIComponent('tg:7000000001#-100170000001')}`, wait: 2000 }, // 077: a Telegram group's page
  { name: 'settings-users', hash: 'settings/users', wait: 2000, js: 'T.openAll();' },
  { name: 'settings-pace', hash: 'settings/sending-pace', wait: 2000 }, // 080: Settings → Sending pace (preset)
  { name: 'settings-modules', hash: 'settings/modules', wait: 2000 }, // 081: Settings → Modules (on/off, ways to pay)
  { name: 'events', hash: 'people/events', wait: 2000 }, // 081: People → Events
  { name: 'event-page', hash: 'people/events', wait: 2000, js: "document.querySelector('.people-list a').click(); await T.until('.person-page'); await T.wait(300);" }, // 081: an event's page
  { name: 'event-edit', hash: 'people/events', wait: 2000, js: "document.querySelector('.people-list a').click(); await T.until('.person-page'); await T.wait(300); document.querySelector('.ap-head details.menu summary').click(); await T.click('Edit…', 'button', 600);" }, // 081: the event dialog
  { name: 'event-pending', hash: 'people/events', wait: 2000, js: "[...document.querySelectorAll('.people-list a')].find((a) => a.textContent.includes('picnic')).click(); await T.until('.person-page'); await T.wait(300);" }, // 081: to confirm and waiting list
  { name: 'sending', hash: 'people/sending', wait: 2000 }, // 082: People → Sending (history, saved audiences)
  { name: 'sending-run', hash: 'people/sending', wait: 2000, js: "[...document.querySelectorAll('a.lrow')].find((a) => a.textContent.includes('Payment')).click(); await T.until('.person-page'); await T.wait(300);" }, // 082: a run's page
  { name: 'sending-run-live', hash: 'people/sending', wait: 2000, js: "[...document.querySelectorAll('a.lrow')].find((a) => a.textContent.includes('picnic')).click(); await T.until('.person-page .quote'); await T.wait(300); if (!document.querySelector('.person-page .pill.info')) throw new Error('a message still going out shows no Sending state');" }, // 085: a message still going out, people in the queue
  { name: 'events-past', hash: 'people/events', wait: 2000, js: "await T.click('Past', '.seg button', 600); [...document.querySelectorAll('.people-list a')].find((a) => a.textContent.includes('Diwali')).click(); await T.until('.person-page'); await T.wait(300); if (!/\\d came/.test(document.querySelector('.person-page').textContent)) throw new Error('no attendance count on a past event');" }, // 085: a past event with attendance
  { name: 'orders-overdue', hash: 'people/orders', wait: 2000, js: "await T.click('Overdue', '.seg button', 600); if (!document.querySelector('.people-list .pill.bad')) throw new Error('an overdue order is not marked Overdue');" }, // 085
  { name: 'sending-new', hash: 'people/sending/new', wait: 2000, js: "document.querySelector('#main textarea').value = 'Hi {first_name}, badminton is in the new hall from Tuesday.'; await T.click('Preview', 'button', 1500);" }, // 082: New message with its preview
  { name: 'campaign', hash: 'people/sending', wait: 2000, js: "[...document.querySelectorAll('a.lrow')].find((a) => a.href.includes('/campaign/c')).click(); await T.until('.person-page'); await T.wait(300);" }, // 083: a campaign's steps
  { name: 'campaign-new', hash: 'people/sending/campaign/new', wait: 2000 }, // 083: New campaign
  { name: 'surveys', hash: 'people/surveys', wait: 2000 }, // 083: People → Surveys
  { name: 'survey-page', hash: 'people/surveys', wait: 2000, js: "document.querySelector('.people-list a').click(); await T.until('.person-page'); await T.wait(300);" }, // 083: results and answers
  { name: 'survey-edit', hash: 'people/surveys', wait: 2000, js: "document.querySelector('.people-list a').click(); await T.until('.person-page'); await T.wait(300); document.querySelector('.ap-head details.menu summary').click(); await T.click('Edit…', 'button', 600);" }, // 083: the survey editor
  { name: 'orders', hash: 'people/orders', wait: 2000 }, // 081: People → Orders (not paid, totals per event)
  { name: 'order-page', hash: 'people/orders', wait: 2000, js: "document.querySelector('.people-list a').click(); await T.until('.person-page'); await T.wait(300);" }, // 081: an order's lines and payments
  { name: 'person-modules', hash: 'people', wait: 2000, js: "[...document.querySelectorAll('.people-list a')].find((a) => a.textContent.includes('Anu')).click(); await T.until('.person-page'); await T.wait(300); [...document.querySelectorAll('.eyebrow')].find((e) => e.textContent === 'Events')?.scrollIntoView();" }, // 081: Events and Orders on a person's page
  { name: 'settings-pace-custom', hash: 'settings/sending-pace', wait: 2000, js: "await T.click('Custom', 'button', 300);" }, // 080: custom ranges
  { name: 'models-setup', hash: 'models/chatgpt', before: `const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
      if (String(u).startsWith('/api/providers') && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json(); if (Array.isArray(j)) return new Response(JSON.stringify(j.filter((x) => x.id !== 'openrouter').map((x) => ({ ...x, connected: false, models: 0 })))); }
      return r; }; S.models = null;`, js: "await T.click('Sign in with ChatGPT', 'button', 1200); T.openAll();" },
  { name: 'usage', hash: 'usage' },
  { name: 'usage-models', hash: 'usage', js: "await T.click('Models', '.seg button', 300);" }, // 073: breakdown rows with prices and ⋯
  { name: 'usage-set-price', hash: 'usage', js: "await T.click('Models', '.seg button', 300); document.querySelector('.urows details.menu').open = true; await T.click('Set price', 'button', 600);" },
  { name: 'server', hash: 'server', wait: 2000, js: 'T.openAll();' },
  // 069: Health with an almost-full disk (writes paused) and a queue at its limit
  { name: 'server-health-disk-full', hash: 'server', wait: 2000, before: `const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
      if (String(u) === '/api/server/health') { const j = await r.clone().json(); return new Response(JSON.stringify({ ...j, disk: { ...j.disk, level: 'full', free: 52428800, writesPaused: true } })); }
      return r; };`, js: "T.openAll(); document.getElementById('health')?.scrollIntoView(); await T.wait(300);" },
  // #96: OS updates grouped (will install / rolling out gradually / held back), the restart banner and last-run summary
  { name: 'server-os-updates', hash: 'server', wait: 2000, js: "T.openAll(); document.getElementById('restart-needed')?.scrollIntoView(); await T.wait(300);" },
  // #96, 056: a root helper too old to update itself: no gradual button, a note to run sudo duniya update once or reinstall
  { name: 'server-old-helper', hash: 'server', wait: 2000, before: `const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
      if (String(u) === '/api/system/ops' && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json();
        return new Response(JSON.stringify({ ...j, helperVersion: 1, helperCurrent: false, helperOutdated: true, helperSelfUpdate: false, result: null, reboot: { required: false, packages: [] } })); }
      if (String(u) === '/api/system') { const j = await r.clone().json(); return new Response(JSON.stringify({ ...j, rebootRequired: false, reboot: { required: false, packages: [] } })); }
      return r; };`, js: "T.openAll(); document.getElementById('helper-update')?.scrollIntoView(); await T.wait(300);" },
  // 056: a helper that can update itself but is older than this release's: the Update maintenance helper button
  { name: 'server-helper-update', hash: 'server', wait: 2000, before: `const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
      if (String(u) === '/api/system/ops' && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json();
        return new Response(JSON.stringify({ ...j, helperVersion: 3, helperBundled: 4, helperCurrent: true, helperOutdated: true, helperSelfUpdate: true, result: null, reboot: { required: false, packages: [] } })); }
      if (String(u) === '/api/system') { const j = await r.clone().json(); return new Response(JSON.stringify({ ...j, rebootRequired: false, reboot: { required: false, packages: [] } })); }
      return r; };`, js: "T.openAll(); document.getElementById('helper-update')?.scrollIntoView(); await T.wait(300);" },
  { name: 'backups', hash: 'backups', js: 'T.openAll();' },
  { name: 'pending', hash: 'pending' },
  { name: 'settings-secrets', hash: 'secrets' }, // 062: #secrets opens Settings → Secrets
  // 060: one-time links — enter a secret (signed in), a new user's sign-up page (before sign-in), the link in Users.
  { name: 'secret-link', hash: 'secrets', js: "const r = await (await fetch('/api/secret-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'OPENAI_API_KEY' }) })).json(); await (await import('/app/login.js')).renderSecretLink(r.link.split('=')[1]);" },
  { name: 'signup-link', hash: '', js: "const r = await (await fetch('/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `lea${Date.now() % 1e6}`, role: 'admin' }) })).json(); S.tab = ''; S.es?.close(); history.replaceState(null, '', `#signup=${r.signup.link.split('=')[1]}`); await (await import('/app/login.js')).renderLogin();" },
  { name: 'settings-signup-link', hash: 'settings/users', wait: 2000, js: "S.signupLink = { username: 'lea', link: `${location.origin}/#signup=${'a1'.repeat(32)}` }; await (await import('/app/settings.js')).renderSettings(); document.querySelector('.note code')?.scrollIntoView(); await T.wait(300);" },
  { name: 'settings', hash: 'settings', wait: 2000, js: 'T.openAll();' },
  // 055: Settings → Server, Small server mode (one switch for heavier features on a small server)
  { name: 'settings-small-mode', hash: 'settings/small-mode', wait: 2000, js: "document.getElementById('small-mode')?.scrollIntoView(); await T.wait(300);" },
  // 055: Small server mode off on a small server: a saved local tool service is shown as not started, with why
  { name: 'agent-local-blocked', hash: 'agents/carpool/tools', wait: 2000, before: `const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
      if (String(u) === '/api/status') { const j = await r.clone().json(); return new Response(JSON.stringify({ ...j, server: { ...j.server, size: 'small', smallMode: false } })); }
      return r; };`, js: "T.openAll(); document.getElementById('local-blocked')?.scrollIntoView(); await T.wait(300);" },
  // #77: a new domain was added while Google sign-in is on (callout with the values for Google Cloud)
  { name: 'settings-web-google', hash: 'settings/web-access', wait: 2500, before: `const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
      if (String(u) === '/api/web' && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json(); const old = j.current?.host || 'agents.example.org';
        return new Response(JSON.stringify({ ...j, switch: { phase: 'added', newHost: 'duniya-panel.example.org', oldHost: old },
          google: { on: true, enabled: true, only: false, callbackPath: '/auth/google/callback', consoleUrl: 'https://console.cloud.google.com/apis/credentials', addresses: [] } })); }
      return r; };`, js: 'T.openAll();' },
  // #77: the page a Google sign-in lands on when it came back to another address (server page, not the panel app)
  { name: 'google-address-help', path: '/auth/google/callback?state=demo-state' },
];
const PRELUDE = `const T = {
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(sel, ms = 15000) { for (let t = 0; t < ms && !document.querySelector(sel); t += 100) await T.wait(100); },
  openAll: () => document.querySelectorAll('details').forEach((d) => { d.open = true; }),
  async click(text, sel = 'button,a,summary', ms = 900) {
    let el = null; // 069: wait up to 5 s for it (a screen still drawing made models-setup flaky)
    for (let t = 0; t < 5000 && !(el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && e.offsetParent)); t += 100) await T.wait(100);
    if (!el) throw new Error('nothing to click: ' + text);
    el.click(); await T.wait(ms);
  },
};`;

// ---------- the checks (run in the page) ----------
/* global document, window, getComputedStyle, NodeFilter */
function audit(W, phone) {
  const out = { overflow: Math.max(document.scrollingElement.scrollWidth, window.innerWidth) - W, wide: [], taps: [], text: [] };
  const visible = (e) => {
    if (e.closest('details:not([open]) > :not(summary)') || e.closest('.hide')) return false;
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const desc = (e) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).join('.')}` : ''} "${(e.innerText || e.value || e.placeholder || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
  const inScroller = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth - 1) return true; } return false; };
  for (const e of document.querySelectorAll('body *')) {
    if (!visible(e) || getComputedStyle(e).position === 'fixed') continue;
    const r = e.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !inScroller(e)) out.wide.push(`${desc(e)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  if (phone) {
    const taps = 'button, a.btn, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea, summary, label.toggle, label.inline, label.tick, .choice';
    for (const e of document.querySelectorAll(taps)) {
      if (!visible(e) || e.closest('.cue') || (e.matches('input,button') && e.closest('label.inline, label.toggle, label.tick'))) continue;
      const r = e.getBoundingClientRect();
      if (r.height < 39.5 || r.width < 39.5) out.taps.push(`${desc(e)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    for (const e of document.querySelectorAll('input[type=checkbox], input[type=radio]')) if (visible(e) && !e.closest('label')) out.taps.push(`checkbox without a label: ${desc(e.parentElement)}`);
    const seen = new Set(); const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const e = n.parentElement;
      if (!n.textContent.trim() || !e || seen.has(e) || !visible(e) || e.closest('.cue, svg, .ai-chip, .toast, [aria-hidden=true]')) continue;
      seen.add(e);
      const fs = parseFloat(getComputedStyle(e).fontSize);
      if (fs < 12.95) out.text.push(`${desc(e)} ${fs}px`);
    }
  }
  // 064: WCAG AA contrast of visible text against the colour behind it (backgrounds blended up the tree, opacity included)
  out.contrast = [];
  const rgba = (c) => {
    const m = /^rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:,?\s*\/?\s*([\d.]+))?\)$/.exec(c) || /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/.exec(c);
    if (!m) return null;
    const k = c.startsWith('color(') ? 255 : 1;
    return [Number(m[1]) * k, Number(m[2]) * k, Number(m[3]) * k, m[4] == null ? 1 : Number(m[4])];
  };
  const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3])).concat(1);
  const behind = (e) => {
    const stack = [];
    for (let p = e; p; p = p.parentElement) { const b = rgba(getComputedStyle(p).backgroundColor); if (b && b[3] > 0) { stack.push(b); if (b[3] >= 1) break; } }
    return stack.reverse().reduce((acc, b) => over(b, acc), [255, 255, 255, 1]);
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const seenC = new Set(); const walkC = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walkC.nextNode(); n; n = walkC.nextNode()) {
    const e = n.parentElement;
    if (!n.textContent.trim() || !e || seenC.has(e) || !visible(e)) continue;
    seenC.add(e);
    if (e.closest('.cue, svg, [aria-hidden=true], :disabled, [disabled], .skel, option, pre, input, textarea, select')) continue;
    const cs = getComputedStyle(e); const fg = rgba(cs.color); if (!fg) continue;
    let op = 1; for (let p = e; p; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
    const bg = behind(e); const text = over([...fg.slice(0, 3), fg[3] * op], bg);
    const size = parseFloat(cs.fontSize); const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const r = ratio(text, bg);
    if (r < (large ? 3 : 4.5)) out.contrast.push(`${desc(e)} ${r.toFixed(2)}:1`);
  }
  // 066: icons (SVG drawn in currentColor) reach 3:1 against what is behind them (WCAG 1.4.11), including a pill drawn by
  // an ancestor's ::before (the active phone tab) — a white icon on lime failed this on a real iPhone.
  const pill = (p) => { const b = getComputedStyle(p, '::before'); const c = rgba(b.backgroundColor); return b.content !== 'none' && b.position === 'absolute' && c && c[3] > 0 ? c : null; };
  for (const svg of document.querySelectorAll('svg')) {
    if (!visible(svg) || svg.closest('.cue, .logo, .spark, .bars, .empty, .qr, .lmark, .av') || !svg.querySelector('[stroke=currentColor], [fill=currentColor]')) continue;
    const cs = getComputedStyle(svg); const fg = rgba(cs.color); if (!fg) continue;
    let op = 1; for (let p = svg; p; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
    let bg = behind(svg);
    for (let p = svg.parentElement; p && p !== document.body; p = p.parentElement) { const c = pill(p); if (c) { bg = over(c, bg); break; } }
    const r = ratio(over([...fg.slice(0, 3), fg[3] * op], bg), bg);
    if (r < 3) out.contrast.push(`icon in ${desc(svg.parentElement)} ${r.toFixed(2)}:1`);
  }
  const uniq = (a) => [...new Set(a)].slice(0, 12);
  return { overflow: out.overflow, wide: uniq(out.wide), taps: uniq(out.taps), text: uniq(out.text), contrast: uniq(out.contrast) };
}


/** 064: controls without a name, from Chrome's accessibility tree (what a screen reader announces). */
const NAMED = new Set(['button', 'link', 'checkbox', 'switch', 'textbox', 'searchbox', 'combobox', 'listbox', 'radio', 'slider', 'spinbutton', 'tab', 'menuitem', 'dialog']);
async function unnamed(page) {
  await page.send('DOM.enable'); await page.send('Accessibility.enable');
  const { nodes } = await page.send('Accessibility.getFullAXTree');
  const out = [];
  for (const n of nodes) {
    if (n.ignored || !NAMED.has(n.role?.value) || String(n.name?.value || '').trim()) continue;
    if (n.properties?.some((p) => p.name === 'hidden' && p.value?.value)) continue;
    const d = n.backendDOMNodeId ? await page.send('DOM.describeNode', { backendNodeId: n.backendDOMNodeId }).catch(() => null) : null;
    const attrs = d?.node?.attributes || []; const at = (k) => attrs[attrs.indexOf(k) + 1];
    // where it is: the heading of its card (helps to find it)
    const obj = n.backendDOMNodeId ? await page.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId }).catch(() => null) : null;
    const where = obj?.object?.objectId ? (await page.send('Runtime.callFunctionOn', { objectId: obj.object.objectId, returnByValue: true,
      functionDeclaration: 'function () { const c = this.closest(".card, dialog, section, li, tr"); return (c?.querySelector("h2, h3, b")?.textContent || "").trim().slice(0, 40); }' }).catch(() => null))?.result?.value : '';
    out.push(`${n.role.value} <${(d?.node?.nodeName || '?').toLowerCase()}${at('class') && attrs.includes('class') ? `.${at('class').split(' ').join('.')}` : ''}${attrs.includes('type') ? ` type=${at('type')}` : ''}>${where ? ` in “${where}”` : ''}`);
  }
  return [...new Set(out)].slice(0, 12);
}

// ---------- run ----------
const { base } = await startDemo();
console.log(`Demo panel on ${base}`);
if (opt.shots) mkdirSync(opt.shots, { recursive: true });
const cdp = await launch();
const failures = [];
const login = `fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ${JSON.stringify(DEMO_PASSWORD)} }) }).then((r) => r.status)`;
for (const scheme of opt.schemes.split(',')) {
  for (const width of opt.widths.split(',').map(Number)) {
    const page = await newPage(cdp, { width, scheme });
    await page.goto(base); await page.evaluate(login);
    for (const st of STATES) {
      if (opt.only && !opt.only.split(',').includes(st.name)) continue;
      const key = `${st.name} @ ${width} ${scheme}`;
      try {
        await page.goto(st.path ? `${base}${st.path}` : `${base}/${st.hash ? `#${st.hash}` : ''}`);
        if (st.checklist) await page.call(FAKE_CHECKLIST, st.checklist);
        if (st.before) await page.evaluate(`(async () => { ${PANEL} ${st.before} show(S.tab); })()`);
        await sleep(st.wait || 1500);
        if (st.js) await page.evaluate(`(async () => { ${PRELUDE} ${PANEL} ${st.js} })()`);
        await sleep(300);
        const r = await page.call(String(audit), width, width < 600);
        r.names = await unnamed(page);
        const bad = r.overflow > 0 || r.wide.length || r.taps.length || r.text.length || r.contrast.length || r.names.length;
        console.log(`${bad ? '✗' : '✓'} ${key}`);
        if (bad) failures.push([key, r]);
        if (opt.shots) await page.shot(join(opt.shots, `${st.name}@${width}-${scheme}.png`));
      } catch (e) { console.log(`✗ ${key}: ${e.message}`); failures.push([key, { error: e.message }]); }
      if (st.relogin) await page.evaluate(login);
    }
    await page.close();
  }
}
cdp.close();
if (failures.length) {
  console.log(`\n${failures.length} screen(s) failed:`);
  for (const [key, r] of failures) {
    console.log(`\n${key}`);
    if (r.error) console.log(`  error: ${r.error}`);
    if (r.overflow > 0) console.log(`  page scrolls sideways by ${r.overflow} px`);
    for (const [k, label] of [['wide', 'wider than the screen'], ['taps', 'tap target under 40 px'], ['text', 'text under 13 px'], ['contrast', 'contrast under AA'], ['names', 'control without a name']]) for (const x of r[k] || []) console.log(`  ${label}: ${x}`);
  }
  process.exit(1);
}
console.log('\nAll screens pass.');
process.exit(0);
