// Responsive check of the admin panel (issue #1). Not part of CI: it needs a local Chrome or Chromium.
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
// Exit code 1 lists what failed.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { startDemo, DEMO_PASSWORD } from './demo-panel.mjs';
import { launch, newPage } from './cdp.mjs';

const { values: opt } = parseArgs({ options: {
  widths: { type: 'string', default: '375,393,1440' }, schemes: { type: 'string', default: 'light,dark' },
  only: { type: 'string', default: '' }, shots: { type: 'string', default: '' },
} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- screens and states ----------
// 045: pretend v3.0.0 (breaking) is available, with v2.10.0 still safe to install.
const UPDATE_DECISION = `const f0 = window.fetch; window.fetch = async (u, o) => { const r = await f0(u, o);
  if (String(u) === '/api/updates' && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json();
    const steps = [{ version: '3.0.0', title: 'New memory format (fresh memory)', summary: 'Chat memory moves to a new format. Running summaries start fresh; messages and agents stay.', actions: ['Check the running summaries of your main chats after the update.', 'Re-run the installer once so the maintenance helper knows the new options.'], data: 'not-migrated', docs: 'docs/upgrading.md' }];
    return new Response(JSON.stringify({ ...j, status: { ...j.status, available: true, latest: 'v3.0.0', target: 'v3.0.0', breaking: true, steps, safeTarget: 'v2.10.0', decisionVersion: '3.0.0' },
      decision: { version: 'v3.0.0', target: 'v3.0.0', current: j.status?.current || 'v2.9.0', steps, safeTarget: 'v2.10.0', notifiedAt: Date.now() - 3600000, snoozedUntil: null, dismissed: false, show: true, backup: true, docker: false } })); }
  return r; };`;
// js runs in the page after the screen loaded; T.* helpers are defined in PRELUDE.
const STATES = [
  { name: 'login', hash: '', js: "await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); await renderLogin();", relogin: true },
  { name: 'setup', hash: '', js: "clearInterval(statusTimer); S.tab = ''; renderSetup(document.querySelector('#app'), () => []);" },
  { name: 'setup-restore', hash: '', js: "clearInterval(statusTimer); S.tab = ''; renderSetup(document.querySelector('#app'), () => []); await T.click('Restore a backup');" },
  { name: 'overview', hash: 'overview' },
  { name: 'overview-checklist', hash: 'overview', js: "drawChecklist(document.querySelector('#ov-checklist'), { done: 2, total: 5, complete: false, dismissed: false, steps: [['provider', 'Connect an AI model provider', true, '#models'], ['whatsapp', 'Link a WhatsApp number', true, '#overview/whatsapp'], ['agent', 'Create an agent', false, '#agents'], ['chat', 'Switch a chat on', false, '#chats'], ['reply', 'Get a first reply', false, '#agents']].map(([id, title, done, href]) => ({ id, title, done, href, hint: 'Every chat starts Off. Switch on the groups and people your agent should answer.' })) });" },
  // 045: a breaking release waits for the owner (banner on Overview, the dialog with release notes)
  { name: 'overview-update-decision', hash: 'overview', before: UPDATE_DECISION, wait: 1500 },
  { name: 'update-decision-dialog', hash: 'overview', before: UPDATE_DECISION, wait: 1500, js: "await T.click('Review update', 'button', 600);" },
  { name: 'activity', hash: 'activity', js: "document.querySelector('#feed li')?.click();" },
  { name: 'agents', hash: 'agents' },
  { name: 'agents-ai-draft', hash: 'agents', js: "const ta = document.querySelector('#main textarea'); ta.value = 'A helper for our running club'; await T.click('Draft', 'button', 2500);" },
  { name: 'agent-editor-ai-diff', hash: 'agents/carpool', wait: 2500, js: "const ta = document.querySelector('#main textarea'); ta.value = 'Shorter replies, make Lea an organizer, weather before rides'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); document.querySelector('.dskip')?.click();" },
  { name: 'agent-editor-ai-side', hash: 'agents/carpool', wait: 2500, js: "const ta = document.querySelector('#main textarea'); ta.value = 'Shorter replies'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); await T.click('Side by side', 'button', 300);" },
  { name: 'agent-editor-ai-whole', hash: 'agents/carpool', wait: 2500, js: "const ta = document.querySelector('#main textarea'); ta.value = 'Shorter replies'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); await T.click('Whole new text', 'button', 300);" },
  { name: 'agent-editor', hash: 'agents/carpool', wait: 2500, js: 'T.openAll();' },
  { name: 'agent-editor-tools', hash: 'agents/carpool', wait: 2500, js: "await T.click('Choose tools for this agent', 'button', 1500); T.openAll();" },
  { name: 'agent-editor-test', hash: 'agents/school', wait: 2500, js: "const i = document.querySelector('input[placeholder^=\"Ask the\"]'); i.value = 'When are the museum trip forms due?'; await T.click('Send', 'button', 1800);" },
  { name: 'agent-editor-test-as', hash: 'agents/carpool/test', wait: 2500, js: "const sel = document.querySelector('select[aria-label=\"Test as role\"]'); sel.value = 'organizer'; sel.dispatchEvent(new Event('change')); await T.wait(1500); T.openAll();" },
  { name: 'agent-editor-empty', hash: 'agents/neighbours', wait: 2500, js: 'T.openAll();' },
  { name: 'chats', hash: 'chats' },
  { name: 'chats-memory', hash: 'chats', js: "[...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Geneva rides'))?.querySelector('button')?.click(); await T.wait(1800); T.openAll();" },
  { name: 'contacts', hash: 'contacts' },
  { name: 'models', hash: 'models', js: 'T.openAll();' },
  { name: 'models-setup', hash: 'models', before: `const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
      if (String(u).startsWith('/api/providers') && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json(); if (Array.isArray(j)) return new Response(JSON.stringify(j.filter((x) => x.id !== 'openrouter').map((x) => ({ ...x, connected: false, models: 0 })))); }
      return r; }; modelsCache = null;`, js: "await T.click('Sign in with ChatGPT', 'button', 1200); T.openAll();" },
  { name: 'usage', hash: 'usage' },
  { name: 'server', hash: 'server', wait: 2000, js: 'T.openAll();' },
  { name: 'backups', hash: 'backups', js: 'T.openAll();' },
  { name: 'pending', hash: 'pending' },
  { name: 'secrets', hash: 'secrets' },
  { name: 'settings', hash: 'settings', wait: 2000, js: 'T.openAll();' },
  // #77: a new domain was added while Google sign-in is on (callout with the values for Google Cloud)
  { name: 'settings-web-google', hash: 'settings', wait: 2500, before: `const f = window.fetch; window.fetch = async (u, o) => { const r = await f(u, o);
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
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && e.offsetParent);
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
      if (!n.textContent.trim() || !e || seen.has(e) || !visible(e) || e.closest('.cue, svg, .ai-chip, .toast')) continue;
      seen.add(e);
      const fs = parseFloat(getComputedStyle(e).fontSize);
      if (fs < 12.95) out.text.push(`${desc(e)} ${fs}px`);
    }
  }
  const uniq = (a) => [...new Set(a)].slice(0, 12);
  return { overflow: out.overflow, wide: uniq(out.wide), taps: uniq(out.taps), text: uniq(out.text) };
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
        if (st.before) await page.evaluate(`(async () => { ${st.before} show(S.tab); })()`);
        await sleep(st.wait || 1500);
        if (st.js) await page.evaluate(`(async () => { ${PRELUDE} ${st.js} })()`);
        await sleep(300);
        const r = await page.evaluate(`(${audit})(${width}, ${width < 600})`);
        const bad = r.overflow > 0 || r.wide.length || r.taps.length || r.text.length;
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
    for (const [k, label] of [['wide', 'wider than the screen'], ['taps', 'tap target under 40 px'], ['text', 'text under 13 px']]) for (const x of r[k] || []) console.log(`  ${label}: ${x}`);
  }
  process.exit(1);
}
console.log('\nAll screens pass.');
process.exit(0);
