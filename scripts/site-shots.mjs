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
import { startDemo, DEMO_PASSWORD } from './demo-panel.mjs';
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
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && e.offsetParent);
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
const ASK = `S.ask = { q: '', busy: false, reply: 'This week in your chats:\\n• Morges ↔ Geneva rides: Marc drives Fridays at 07:40 (2 seats left); Sophie gets a lift back with Mia on Thursday.\\n• Class 4B parents: museum trip forms are due Monday 24 Nov; Lea can drive 3 children.\\n• Family ❤️: Diwali dinner Saturday 19:00 at Ravi & Priya’s.\\nThe Book club and Rue du Midi neighbours chats are off, so I can’t see them.',
  confirms: [{ code: 'H4M9', preview: 'Turn off the agent “Office colleagues” (1 chat). It stops answering until you switch it on again.' }] };`;
const CHECKLIST = "drawChecklist(document.querySelector('#ov-checklist'), { done: 3, total: 5, complete: false, dismissed: false, steps: [['provider', 'Connect an AI model provider', true, '#models', 'OpenRouter, ChatGPT, Copilot, Anthropic…'], ['whatsapp', 'Link a WhatsApp number', true, '#overview/whatsapp', 'Scan the QR code with a spare number.'], ['agent', 'Create an agent', true, '#agents', 'Start from a template or describe it.'], ['chat', 'Switch a chat on', false, '#chats', 'Every chat starts Off. Switch on the groups and people your agent should answer.'], ['reply', 'Get a first reply', false, '#agents', 'Write the trigger in the group, or try the test console.']].map(([id, title, done, href, hint]) => ({ id, title, done, href, hint })) });";
const AI_DIFF = "const ta = document.querySelector('#main textarea'); ta.value = 'Shorter replies, make Lea an organizer, weather before rides'; await T.click('Draft', 'button', 100); await T.until('.dreview, .note.bad'); document.querySelector('.dskip')?.click(); await T.wait(400);";
const TEST_AS = "const sel = document.querySelector('select[aria-label=\"Test as role\"]'); sel.value = 'organizer'; sel.dispatchEvent(new Event('change')); await T.wait(1200); const i = document.querySelector('#test-console input[placeholder^=\"Ask the\"]'); if (i) { i.value = 'Who drives to Geneva on Friday?'; await T.click('Send', 'button', 1800); }";

// [name, hash, js before the shot, phone too?]
const PAGES = [
  ['overview', 'overview', ASK + ' show(S.tab); await T.wait(600);', true],
  ['agents', 'agents', '', true],
  ['chats', 'chats', '', true],
  ['models', 'models', '', true],
  ['usage', 'usage', '', true],
  ['server', 'server', '', false],
  ['backups', 'backups', '', false],
  ['activity', 'activity', '', false],
  ['agent-editor', 'agents/carpool', '', false],
];
// [name, hash, js that prepares it, selector or T.box heading, viewport width]
const CARDS = [
  ['card-ask', 'overview', ASK + ' show(S.tab); await T.wait(600);', '#ov-ask', 1100],
  ['card-quiet', 'overview', '', '#ov-silences', 1100],
  ['card-checklist', 'overview', CHECKLIST + ' await T.wait(300);', '#ov-checklist', 1100],
  ['card-ai-diff', 'agents/carpool', AI_DIFF, '.dreview', 1100],
  ['card-test-as', 'agents/carpool/test', TEST_AS, '#test-console', 1100],
  ['card-caps', 'usage', '', 'box:Monthly spending caps', 1100],
  ['card-photos-voice', 'models', '', 'box:Photos & voice', 1100],
  ['card-fallback', 'models', 'T.openAll(document.querySelector("#fallback"));', '#fallback', 1100],
  ['card-chat-fallback', 'chats', "[...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Geneva rides'))?.querySelector('button[aria-label^=\"Model fallback\"]')?.click(); await T.until('#chat-fallback select'); await T.wait(400);", '#chat-fallback', 600],
  ['card-owner-assistant', 'settings', 'T.openAll(T.box("Owner assistant"));', 'box:Owner assistant', 900],
  ['card-privacy', 'settings', '', 'box:Privacy notice', 900],
  ['card-web-access', 'settings', '', 'box:Web address & access', 900],
  ['card-small-server', 'server', '', 'box:This server', 1100],
  ['card-assistants', 'settings', '', 'box:Connected AI assistants', 900],
  ['card-logging', 'settings', '', 'box:Activity log', 600],
  ['card-mcp', 'agents/carpool', 'T.openAll(T.box("Tool services"));', 'box:Tool services', 600],
  ['card-wa-actions', 'agents/carpool', 'T.openAll(T.box("WhatsApp actions"));', 'box:WhatsApp actions', 600],
  ['card-people', 'agents/carpool', '', 'box:People & roles', 600],
  ['card-wa-group', 'chats', "[...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Geneva rides'))?.querySelector('button')?.click(); await T.until('.wa-card input'); await T.wait(600);", '.wa-card', 900],
  ['card-memory', 'chats', "[...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Geneva rides'))?.querySelector('button')?.click(); await T.wait(1800);", 'box:Memory', 900],
];

const { base } = await startDemo({ small: true });
console.log(`Demo panel on ${base}`);
await sleep(4000); // let uptime and metrics look lived-in
const cdp = await launch();
const login = `fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: ${JSON.stringify(DEMO_PASSWORD)} }) }).then((r) => r.status)`;
const img = join(opt.out, 'img'); const vid = join(opt.out, 'video');
mkdirSync(img, { recursive: true }); mkdirSync(vid, { recursive: true });

async function open(page, hash, js) {
  await page.goto(`${base}/#${hash}`);
  await sleep(2200);
  if (js) await page.evaluate(`(async () => { ${PRELUDE} ${js} })()`);
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
  for (const [name, hash, js, sel, w] of CARDS) {
    if (w !== width || !want(name)) continue;
    try {
      await open(page, hash, js);
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
  ['tour', 'overview', `for (const t of ['overview', 'chats', 'agents', 'models', 'usage', 'server', 'activity']) { location.hash = t; await T.wait(2100); }`, 15500],
  ['chat-on', 'chats', `const row = () => [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Book club'));
    row().scrollIntoView({ block: 'center' }); await T.wait(1200); row().querySelector('input[type=checkbox]').click(); await T.wait(1500);
    const sel = row()?.querySelector('select'); if (sel) { sel.focus(); await T.wait(600); sel.value = [...sel.options].find((o) => /family/i.test(o.textContent))?.value || sel.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }`, 6500],
  ['ai-create', 'agents', `const ta = document.querySelector('#main textarea'); await T.wait(500);
    await T.type(ta, 'A helper for our running club that posts Sunday’s run every Saturday evening');
    await T.click('Draft', 'button', 200); await T.until('.dreview, .note.bad'); await T.wait(900);
    for (let y = 0; y < 900; y += 30) { scrollBy(0, 30); await T.wait(60); }`, 12000],
  ['test-console', 'agents/school', `const i = document.querySelector('input[placeholder^="Ask the"]'); i.scrollIntoView({ block: 'center' }); await T.wait(600);
    await T.type(i, 'When are the museum trip forms due?'); await T.click('Send', 'button', 100);`, 7000],
];
if (!opt['no-video']) {
  const page = await newPage(cdp, { width: 1280, height: 800, scale: 1, scheme: opt.scheme });
  await page.goto(base); await page.evaluate(login);
  for (const [name, hash, js, ms] of VIDEOS) {
    if (!want(name)) continue;
    await open(page, hash, '');
    await capture(page, join(vid, `${name}-poster.webp`), null, 70);
    const dir = mkdtempSync(join(tmpdir(), 'duniya-frames-'));
    await page.evaluate(`(async () => { ${PRELUDE} window.__done = false; try { ${js} } finally { window.__done = true; } })(); 0`);
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
