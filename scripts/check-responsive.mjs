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
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { startDemo, DEMO_PASSWORD } from './demo-panel.mjs';

const { values: opt } = parseArgs({ options: {
  widths: { type: 'string', default: '375,393,1440' }, schemes: { type: 'string', default: 'light,dark' },
  only: { type: 'string', default: '' }, shots: { type: 'string', default: '' },
} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- screens and states ----------
// js runs in the page after the screen loaded; T.* helpers are defined in PRELUDE.
const STATES = [
  { name: 'login', hash: '', js: "await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); await renderLogin();", relogin: true },
  { name: 'setup', hash: '', js: "clearInterval(statusTimer); S.tab = ''; renderSetup(document.querySelector('#app'), () => []);" },
  { name: 'setup-restore', hash: '', js: "clearInterval(statusTimer); S.tab = ''; renderSetup(document.querySelector('#app'), () => []); await T.click('Restore a backup');" },
  { name: 'overview', hash: 'overview' },
  { name: 'activity', hash: 'activity', js: "document.querySelector('#feed li')?.click();" },
  { name: 'agents', hash: 'agents' },
  { name: 'agents-ai-draft', hash: 'agents', js: "const ta = document.querySelector('#main textarea'); ta.value = 'A helper for our running club'; await T.click('Draft', 'button', 2500);" },
  { name: 'agent-editor-ai-diff', hash: 'agents/carpool', wait: 2500, js: "const ta = document.querySelector('#main textarea'); ta.value = 'Shorter replies, make Lea an organizer, weather before rides'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); document.querySelector('.dskip')?.click();" },
  { name: 'agent-editor-ai-side', hash: 'agents/carpool', wait: 2500, js: "const ta = document.querySelector('#main textarea'); ta.value = 'Shorter replies'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); await T.click('Side by side', 'button', 300);" },
  { name: 'agent-editor-ai-whole', hash: 'agents/carpool', wait: 2500, js: "const ta = document.querySelector('#main textarea'); ta.value = 'Shorter replies'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); await T.click('Whole new text', 'button', 300);" },
  { name: 'agent-editor', hash: 'agents/carpool', wait: 2500, js: 'T.openAll();' },
  { name: 'agent-editor-tools', hash: 'agents/carpool', wait: 2500, js: "await T.click('Choose tools for this agent', 'button', 1500); T.openAll();" },
  { name: 'agent-editor-test', hash: 'agents/school', wait: 2500, js: "const i = document.querySelector('input[placeholder^=\"Ask the\"]'); i.value = 'When are the museum trip forms due?'; await T.click('Send', 'button', 1800);" },
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

// ---------- a tiny DevTools-protocol client ----------
function findChrome() {
  const c = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean);
  const hit = c.find((p) => existsSync(p));
  if (!hit) { console.error('No Chrome or Chromium found. Set CHROME_PATH=/path/to/chrome and run again.'); process.exit(2); }
  return hit;
}
async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'duniya-chrome-'));
  const proc = spawn(findChrome(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const i = ++id; waiting.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  return { send, close: () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); } };
}
async function newPage(cdp, { width, scheme }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const phone = width < 600;
  await s('Emulation.setDeviceMetricsOverride', { width, height: phone ? 800 : 900, deviceScaleFactor: 1, mobile: phone });
  if (phone) await s('Emulation.setTouchEmulationEnabled', { enabled: true });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await s('Page.enable');
  await s('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => {});
  const evaluate = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const goto = async (url) => {
    // via about:blank: a URL that differs only in its #hash would not load the page again
    await s('Page.navigate', { url: 'about:blank' });
    await s('Page.navigate', { url });
    for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate('document.readyState').catch(() => '') === 'complete') break; }
  };
  const shot = async (file) => {
    const { cssContentSize: c } = await s('Page.getLayoutMetrics');
    const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(c.width), height: Math.ceil(c.height), scale: 1 } });
    writeFileSync(file, Buffer.from(data, 'base64'));
  };
  return { evaluate, goto, shot, close: () => cdp.send('Target.closeTarget', { targetId }) };
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
        await page.goto(`${base}/${st.hash ? `#${st.hash}` : ''}`);
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
