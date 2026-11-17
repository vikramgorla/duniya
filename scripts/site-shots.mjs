// Screenshots and short videos for the GitHub Pages site (docs/site/img, docs/site/video), taken from the demo panel.
// Not part of CI: it needs a local Chrome/Chromium (CHROME_PATH) and ffmpeg for the videos.
//
//   npm run site:shots                       everything
//   npm run site:shots -- --only overview,card-ask --no-video
//   npm run site:shots -- --out /tmp/shots   write somewhere else (default docs/site)
//
// The demo panel (scripts/demo-panel.mjs) runs the real core + panel with seeded data, fake WhatsApp numbers
// (+41 79 000 00 xx) and fake models; no network. Pages: 1440×900 (desktop) and 393×852 @2x (phone), WebP.
// Cards: the element only, @2x. Videos: 1280×800 H.264 (-preset veryfast), with a WebP poster.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { startDemo, DEMO_PASSWORD, fakeChecklist, FAKE_CHECKLIST, PANEL } from './demo-panel.mjs';
import { launch, newPage } from './cdp.mjs';

const { values: opt } = parseArgs({ options: {
  only: { type: 'string', default: '' }, out: { type: 'string', default: resolve(import.meta.dirname, '../docs/site') },
  'no-video': { type: 'boolean', default: false }, scheme: { type: 'string', default: 'light' },
} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (name) => !opt.only || opt.only.split(',').includes(name);

const PRELUDE = `const T = {
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(sel, ms = 15000) { for (let t = 0; t < ms && !document.querySelector(sel); t += 100) await T.wait(100); },
  openAll: (root = document) => root.querySelectorAll('details').forEach((d) => { d.open = true; }),
  async click(text, sel = 'button,a,summary', ms = 900) {
    let el = null; // 069: wait up to 5 s for it (a screen still drawing made models-setup flaky)
    for (let t = 0; t < 5000 && !(el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && e.offsetParent)); t += 100) await T.wait(100);
    if (!el) throw new Error('nothing to click: ' + text);
    el.click(); await T.wait(ms);
  },
  /** The card / fieldset whose heading starts with text. */
  box(text) {
    const hd = [...document.querySelectorAll('#main h2, #main h3, #main legend')].find((e) => e.textContent.trim().startsWith(text) && e.offsetParent);
    return hd?.closest('fieldset, .card') || null;
  },
  async type(el, text, ms = 28) { el.focus(); for (let i = 1; i <= text.length; i++) { el.value = text.slice(0, i); el.dispatchEvent(new Event('input', { bubbles: true })); await T.wait(ms); } },
};`;

// The owner assistant's answer in the Ask box (demo data; the fake model is not asked).
const ASK = `S.ask = { draft: '', busy: false, turns: [{ q: 'What did the families decide this week?', state: 'done', reply: 'This week in your chats:\\n- **Morges ↔ Geneva rides:** Marc drives Fridays at 07:40 (2 seats left); Sophie gets a lift back with Mia on Thursday.\\n- **Class 4B parents:** museum trip forms are due Monday 24 Nov; Lea can drive 3 children.\\n- **Family ❤️:** Diwali dinner Saturday 19:00 at Ravi & Priya’s.\\n\\nThe Book club and Rue du Midi neighbours chats are off, so I can’t see them.',
  confirms: [{ code: 'H4M9', preview: 'Turn off the agent “Office colleagues” (1 chat). It stops answering until you switch it on again.' }],
  steps: [{ step: 'tool', tool: 'list_visible_chats', ok: true }, { step: 'tool', tool: 'chat_recap', ok: true }, { step: 'tool', tool: 'search_messages', ok: true }, { step: 'held', tool: 'set_agent_enabled', ok: true }] }] };`;
const START = 'await T.wait(1500);'; // 062: Getting started, one step open (data installed with page.call, see open())
const AI_DIFF = "await T.click('Change with AI', 'button', 600); const ta = document.querySelector('dialog textarea'); ta.value = 'Shorter replies, make Lea an organizer, weather before rides'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); document.querySelector('.dskip')?.click(); await T.wait(400);";
const TEST_AS = "const sel = document.querySelector('select[aria-label=\"Test as role\"]'); sel.value = 'organizer'; sel.dispatchEvent(new Event('change')); await T.wait(1200); const i = document.querySelector('#test-console input[placeholder^=\"Ask the\"]'); if (i) { i.value = 'Who drives to Geneva on Friday?'; await T.click('Send', 'button', 1800); }";
// 065: an update from v2.22.0 to the demo's version: the dialog lists every release in between
const UPDATE_NOTES = `const f0 = window.fetch; window.fetch = async (u, o) => { const r = await f0(u, o);
  if (String(u) === '/api/updates' && (!o || !o.method || o.method === 'GET')) { const j = await r.clone().json();
    const notes = (await (await f0('/api/releases?from=v2.22.0')).json()).versions;
    return new Response(JSON.stringify({ ...j, decision: null, status: { ...j.status, current: 'v2.22.0', available: true, latest: 'v' + notes[0].version, target: 'v' + notes[0].version, breaking: false, steps: [], notes, safeTarget: 'v' + notes[0].version } })); }
  return r; }; show(S.tab); await T.wait(1500);
  document.head.append(Object.assign(document.createElement('style'), { textContent: 'dialog.dlg[open] { animation: none !important; }' })); // a still frame, not the fade-in
  await T.click('Update to v', 'button', 1500);`;

// [name, hash, js before the shot, phone too?]
const PAGES = [
  ['overview', 'overview', ASK + ' show(S.tab); await T.wait(600);', true],
  ['agents', 'agents', '', true],
  ['chats', 'chats', '', true],
  ['models', 'models', '', false],
  ['usage', 'usage', '', false],
  ['server', 'server', '', false],
  ['backups', 'backups', '', false],
  ['activity', 'activity', '', false],
  ['agent-section', 'agents/carpool/where', '', false], // 068: a section page
];
// [name, hash, js that prepares it, selector or T.box heading, viewport width]
const CARDS = [
  ['card-ask', 'overview', ASK + ' show(S.tab); await T.wait(600);', '#ov-ask', 1100],
  ['card-quiet', 'overview', '', '#ov-silences', 1100],
  ['card-wa-numbers', 'overview', '', '#ov-whatsapp', 600], // 071: Connect WhatsApp
  ['card-update-notes', 'overview', UPDATE_NOTES, 'dialog.ask', 900],
  ['card-checklist', 'overview', START, '#ov-checklist', 1100, fakeChecklist('chat')],
  ['card-start-model', 'overview', START, '#ov-checklist', 1100, fakeChecklist('provider')],
  ['card-find', 'chats', "await openFind(); await T.wait(600); const i = document.querySelector('#palette input'); i.value = 'ge'; i.dispatchEvent(new Event('input')); await T.wait(200);", '#palette', 1100],
  ['card-search', 'chats', "await openFind(); await T.wait(600); const i = document.querySelector('#palette input'); i.value = 'cornavin'; i.dispatchEvent(new Event('input')); await T.wait(200); [...document.querySelectorAll('#palette li')].at(-1).click(); await T.until('.pal-msg'); await T.wait(300);", '#palette', 1100], // 070: Search messages
  ['card-review', 'agents/carpool/review', '', '.ap-sec', 600], // 070: Review & teach
  ['card-ai-diff', 'agents/carpool', AI_DIFF, 'dialog.ask', 1100],
  ['card-test-as', 'agents/carpool/test', TEST_AS, '#test-console', 1100],
  ['card-caps', 'usage', '', 'box:Monthly spending caps', 1100],
  ['card-photos-voice', 'models/abilities', '', 'box:Photos & voice', 1100],
  ['card-fallback', 'models/fallback', 'T.openAll(document.querySelector("#fallback"));', '#fallback', 1100],
  ['card-agent-app', 'models/codex', '', '#prov-codex', 1100], // 074: an agent app's sign-in steps
  ['card-chat-fallback', 'chats/120363041122330003%40g.us', "document.querySelector('button[aria-label^=\"Model fallback\"]')?.click(); await T.until('#chat-fallback select'); await T.wait(400);", '#chat-fallback', 600],
  ['card-owner-assistant', 'settings/owner-assistant', 'T.openAll(T.box("Owner assistant"));', 'box:Owner assistant', 900],
  ['card-owner-agent', 'agents/owner-assistant', '', '.ap-card', 900], // 059: the owner assistant's own editor
  ['card-privacy', 'settings/privacy-notice', '', 'box:Privacy notice', 900],
  ['card-web-access', 'settings/web-access', '', 'box:Web address & access', 900],
  ['card-small-server', 'server', '', 'box:This server', 1100],
  ['card-small-mode', 'settings/small-mode', '', '#small-mode', 900],
  ['card-health', 'server', 'T.openAll(document.querySelector("#health"));', '#health', 1100], // 069: Server → Health (073: its details open)
  ['card-person', 'contacts/41790000004', '', '.person-page', 600], // 073: a person's page
  ['card-usage-breakdown', 'usage', '', 'box:Breakdown', 900], // 073: Usage breakdown rows
  ['card-updates', 'settings/updates', '', 'box:Updates', 900], // 073: Settings → Updates
  ['card-assistants', 'settings/assistants', '', 'box:Connected AI assistants', 900],
  ['card-logging', 'settings/logging', '', 'box:Activity log', 600],
  ['card-mcp', 'agents/carpool/tools', '', '.ap-sec', 600],
  ['card-registry', 'agents/carpool/tools', "await T.click('Browse tool services', 'button', 1500);", 'dialog.dlg', 900],
  ['card-people', 'agents/carpool/people', '', '.ap-sec', 600],
  ['card-quick', 'agents/carpool/quick', '', '.ap-sec', 600],
  ['card-quick-test', 'agents/carpool/test', "const i = document.querySelector('#test-console input[placeholder^=\"Ask the\"]'); i.value = '!rides'; await T.click('Send', 'button', 900); i.value = 'where is the pick-up point in Geneva?'; await T.click('Send', 'button', 900);", '#test-console', 1100],
  // 072: a chat's sections, each its own page
  ['card-wa-group', 'chats/120363041122330003%40g.us/group', "await T.until('.wa-card input'); await T.wait(600);", '.ap-sec', 900],
  ['card-memory', 'chats/120363041122330003%40g.us/memory', '', '.ap-sec', 900],
  ['card-messages', 'chats/120363041122330003%40g.us/messages', "await T.until('.msg-ans .rv-acts'); await T.wait(300);", '.ap-sec', 900],
  ['card-chat-page', 'chats/120363041122330003%40g.us', '', '.chat-page', 900], // 068: a chat's page
];

const { base } = await startDemo({ small: true });
console.log(`Demo panel on ${base}`);
await sleep(4000); // let uptime and metrics look lived-in
const cdp = await launch();
const login = `fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ${JSON.stringify(DEMO_PASSWORD)} }) }).then((r) => r.status)`;
const img = join(opt.out, 'img'); const vid = join(opt.out, 'video');
mkdirSync(img, { recursive: true }); mkdirSync(vid, { recursive: true });

async function open(page, hash, js, checklist) {
  await page.goto(`${base}/#${hash}`);
  await sleep(2200);
  if (checklist) await page.call(FAKE_CHECKLIST, checklist);
  if (js) await page.evaluate(`(async () => { ${PRELUDE} ${PANEL} ${js} })()`);
  await sleep(500);
}
const capture = async (page, file, clip, quality = 80) => {
  const { data } = await page.send('Page.captureScreenshot', { format: 'webp', quality, ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('✓', file);
};

// pages
for (const [phone, size] of [[false, { width: 1440, height: 900, scale: 1 }], [true, { width: 393, height: 852, scale: 2 }]]) {
  const page = await newPage(cdp, { ...size, scheme: opt.scheme });
  await page.goto(base); await page.evaluate(login);
  for (const [name, hash, js, both] of PAGES) {
    if ((phone && !both) || !want(name)) continue;
    await open(page, hash, js);
    await capture(page, join(img, `${name}-${phone ? 'mobile' : 'desktop'}.webp`), null, phone ? 72 : 80);
  }
  await page.close();
}

// cards
/** A string as a JS literal that is safe to embed in evaluated code (escapes <, >, / and line separators too). */
const jsLiteral = (v) => JSON.stringify(String(v)).replace(/[<>/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

for (const width of [...new Set(CARDS.map((c) => c[4]))]) {
  const page = await newPage(cdp, { width, height: 900, scale: 2, scheme: opt.scheme });
  await page.goto(base); await page.evaluate(login);
  for (const [name, hash, js, sel, w, checklist] of CARDS) {
    if (w !== width || !want(name)) continue;
    try {
      await open(page, hash, js, checklist);
      const find = sel.startsWith('box:') ? `T.box(${jsLiteral(sel.slice(4))})` : `document.querySelector(${jsLiteral(sel)})`;
      const r = await page.evaluate(`(() => { ${PRELUDE} const e = ${find}; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`);
      if (!r) { console.log('✗', name, 'not found'); continue; }
      // @2x, at most 1600 px wide (the page already renders at device scale 2)
      await capture(page, join(img, `${name}.webp`), { ...r, height: Math.min(r.height, 1500), scale: Math.min(1, 800 / r.width) }, 72);
    } catch (e) { console.log('✗', name, e.message); }
  }
  await page.close();
}

// videos: frames at ~8 fps while a script runs in the page, joined by ffmpeg with their real timing
const VIDEOS = [
  // 071, 072: the website's hero: Overview with Ask, a chat's page and its Messages, an agent and its Review, Models, Server Health, then a message search
  ['tour', 'overview', `${ASK} show('overview'); await T.wait(3200);
    for (const t of ['chats', 'chats/120363041122330003%40g.us', 'chats/120363041122330003%40g.us/messages', 'agents/carpool', 'agents/carpool/review', 'models', 'server']) { location.hash = t; await T.wait(2300); }
    document.querySelector('#health')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); await T.wait(1800);
    await openFind(); await T.wait(500); const i = document.querySelector('#palette input'); await T.type(i, 'cornavin'); await T.wait(300); [...document.querySelectorAll('#palette li')].at(-1).click(); await T.wait(2600);`, 25000],
  ['chat-on', 'chats/120363041122330006%40g.us', `await T.wait(1200);
    const sel = document.querySelector('.chat-page select'); if (sel) { sel.focus(); await T.wait(600); sel.value = [...sel.options].find((o) => /family/i.test(o.textContent))?.value || sel.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }`, 6500],
];
if (!opt['no-video']) {
  const page = await newPage(cdp, { width: 1280, height: 800, scale: 1, scheme: opt.scheme });
  await page.goto(base); await page.evaluate(login);
  for (const [name, hash, js, ms] of VIDEOS) {
    if (!want(name)) continue;
    await open(page, hash, name === 'tour' ? `${ASK} show(S.tab); await T.wait(600);` : ''); // the hero poster shows Ask too
    await capture(page, join(vid, `${name}-poster.webp`), null, 70);
    const dir = mkdtempSync(join(tmpdir(), 'duniya-frames-'));
    await page.evaluate(`(async () => { ${PRELUDE} ${PANEL} window.__done = false; try { ${js} } finally { window.__done = true; } })(); 0`);
    const frames = []; const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
      const f = join(dir, `${String(frames.length).padStart(4, '0')}.jpg`); writeFileSync(f, Buffer.from(data, 'base64'));
      frames.push([f, Date.now()]); await sleep(90);
    }
    const list = frames.map(([f, t], i) => `file '${f}'\nduration ${(((frames[i + 1]?.[1] ?? t + 125) - t) / 1000).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1)[0]}'\n`;
    writeFileSync(join(dir, 'list.txt'), list);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', 'fps=12,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-movflags', '+faststart', '-an', join(vid, `${name}.mp4`)]);
    rmSync(dir, { recursive: true, force: true });
    console.log('✓', join(vid, `${name}.mp4`));
  }
  await page.close();
}
cdp.close();
process.exit(0);
