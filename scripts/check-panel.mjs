// `npm run check:panel` (063): the panel's native ES modules (src/panel/public/app/) fit together and stay small.
//  1. Every module parses and links: each `import { x } from './y.js'` names an export y.js really has (the same check
//     the browser makes, done here with node:vm, nothing is run). Needs --experimental-vm-modules (see package.json).
//  2. Screens loaded on demand — import('./y.js').then((m) => m.x…) and const { x } = await import('./y.js') — name
//     exports y.js has.
//  3. Budgets (brotli, what a browser downloads): the first screen (the shell, styles.css and every module the entry
//     and Overview import) and all of the panel's code. Raising one is a decision: say why in the PR.
//  4. No browser dialogs (064): confirm(), alert() and prompt() are never called; the panel asks with its own dialog
//     (core.js#ask), which works the same on phones and desktops, can be styled and is accessible.
// Also run by scripts/ci-checks.mjs. Exit code 1 on any problem.
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliCompressSync, constants as zc } from 'node:zlib';
import { FIRST_SCREEN, staticClosure } from '../src/panel/module-graph.js';

// Budgets in brotli bytes: the sizes when 063 set them plus ~10 %. 064 raised the first screen to 51 KB for what every
// screen needs from the start: one design-token set, the phone tab bar, skeletons, empty states, avatars, the panel's
// own confirmation dialog, and accessibility (switch roles, labelled fields, focus handling); then 53 KB for the ⋯ row
// menu and the display names shared with the server (names.js). The total rose to 152 KB for the list → page layout
// (Models, Settings, Backups).
const FIRST_BUDGET = 62_600; // 081: +0.1 KB: Modules in the settings search and the style of list rows that end in a status (registrations, orders). Before: 62_500; #178: +0.1 KB: the People list redraws when people are added in the background, and the message Delete style. Before: 62_400; 078: +0.2 KB for the People styles in the one stylesheet (person page rows, timeline, the People · Households · Lists switch) and the People tab; the Contacts styles removed. Before: 62_200; // 073: +0.8 KB for Overview's one-line update row, why-quiet grouped by chat with text-link fixes, agent rows that link to the agent and Review, and keyboard-only focus rings (the Updates page itself loads with Settings); activity no longer loads the chat list for names. Before: 61_400; // 072: +0.8 KB for one chat's Activity (#activity/chat=…, its chip and empty state) and the styles of a chat's Messages (answers in their agent's colour, the marked answer), the open Activity entry and Pending rows; the entry's links and rating load on demand (answers.js). Before: 60_600; // #146: −0.2 KB, the Overview plan hint removed. Before: 60_800; // 068: +0.9 KB for the list → page anatomy shared by Agents, Chats, Contacts and Models (rows with a switch, an item's page, section pages with one save bar, the ? help link, an opaque header); old card and row rules removed. Before: 59_800. #136: +0.6 KB for the quiet copy icon (copy/done icons) and plain tool phrases in old activity entries. 066: +6 KB (with the 065 change logs merged) for the Ask conversation (thinking, live tool chips, streaming markdown, Stop), plain-word activity rows, and recovery after the phone suspends the app (deadlines, Retry, pull to refresh)
const TOTAL_BUDGET = 206_300; // 083: +4.3 KB for Surveys (surveys.js, loaded on the first visit to People → Surveys: the list, the editor with questions of four kinds, results per question with bars, answers per person, CSV) and Campaigns in sending.js (the step editor with waits and surveys, stop rules, a campaign's page with per-step progress); New message and New campaign share one audience form. Before: 201_800; 082: +5.3 KB for Lists and sending (sending.js, loaded on the first visit to People → Sending: the history, New message with the audience, purpose, agent and the preview with samples and who is skipped, a run's page with progress, pause / resume / stop and who got what), Send reminders on Orders, Message registered people and the automatic payment reminders dialog on an event, and live updates of a run over the existing event stream. Before: 196_500; 081: +6.8 KB for Events and Orders (events.js, loaded on the first visit to People → Events or Orders: event list and page with registrations, waiting list, duties, CSV; orders with filters, totals per event, an order's lines and payments), Settings → Modules with the ways to pay, module sections on person and household pages, and module tools with all/none ticks in the agent editor (the WhatsApp ticks generalised, not copied). Before: 189_500; 080: +1.3 KB for Settings → Sending pace (presets, custom ranges with field errors, the read receipts switch, today's new chats and the list estimate). Before: 188_200; #178: +0.4 KB for deleting a stored message (button, confirm, style). Before: 187_800; 079: +2 KB for People and agents: the people-and-lists picker for roles and shared lists, People access in the agent editor, a person's Consent and the agents that can see them, Hide / Show again, the Source and Hidden filters; Erase and the names line removed from the panel. Before: 185_800; // 078: +5.5 KB for People (the list with search and filters, a person's page with Family and ties, Notes and timeline, Tags and lists, Merge with undo, Export and Erase; Households and Lists as list → page; people in Find anything); the Contacts screen (2 KB) removed. Before: 179_800; // 077: +1.6 KB for the Telegram page (connect with the one-time token page, the bot card with Add to a group, what the bot sees and how to change it, its direct-message agent, Replace token and Disconnect) and Telegram wording on a chat's page (channels.js and chats.js load on visit). Before: 178_200; // 076: +0.5 KB for wake words as tags (add / remove one by one) and the In groups choice. Before: 177_600; // #165: +0.4 KB for all/none ticks per role and Everyone: all tools in tool lists. Before: 177_000; // 075: +2.8 KB for Settings → Channels and the WhatsApp page (status, on/off with its confirm, memory used, the numbers moved from Overview), Overview's short WhatsApp card, the Getting started Show the QR code button and the Health rows per channel (channels.js loads with Settings). Before: 174_200; // 074: +1 KB for two agent-app provider pages (Claude Code: setup-token steps and paste; Codex: device sign-in with the code, copy and live finish) and the measured memory line on agent-app pages. Before: 173_200; // 073: +3.2 KB for a person's page (their direct chat and groups), Settings → Updates, the Usage breakdown rows with the Set price dialog, the shorter Server (summary lines, Logs on demand) and Find anything contacts; the Usage tables, the per-row contact controls and dead styles removed. Before: 170_000; // 072: +4.6 KB for the usability pass: a chat's page with sections (Messages, Memory, WhatsApp group, Activity) and the messages opened at one answer, one answer row with 👍 / 👎 / Teach shared by Review, Messages and Activity (answers.js), Change with AI usable away from the agent page, Pending rows with names and links, Usage links; the old Messages & memory card and the Recent messages block removed. Before: 165_000; // 070: +2.5 KB for Search messages (Find anything results, the chat page opened at the search) and the agent page Review section (answers, 👍/👎, Teach with the AI helper); dead .ptags styles removed. Before: 162_300; // #146: −2.1 KB, plan usage removed (plans.js, the meters on Models and Usage). Before: 164_400; // 069: +1.6 KB for Server → Health (sizes, what is kept since when, last clean-up, disk/clock/queue warnings, the owner's retention form) and contacts paged from the server (Show more). Before: 162_600; // 068: +2.5 KB for the agent page (sections, one save model with Undo), the chat page, the More account row and the provider page actions; the old editor and chat rows removed. Before: 160_000. #136 and 066: same reasons as the first screen

const PUBLIC = resolve(import.meta.dirname, '../src/panel/public');
const APP = resolve(PUBLIC, 'app');

export async function checkPanel() {
  const problems = [];
  const names = readdirSync(APP).filter((f) => f.endsWith('.js'));
  const text = new Map(names.map((f) => [f, readFileSync(resolve(APP, f), 'utf8')]));
  const context = vm.createContext({});
  const modules = new Map();
  for (const f of names) {
    try { modules.set(f, new vm.SourceTextModule(text.get(f), { context, identifier: `app/${f}` })); } catch (e) { problems.push(`app/${f}: ${e.message}`); }
  }
  for (const [f, m] of modules) {
    if (m.status !== 'unlinked') continue; // linked already as an import of an earlier module
    try {
      await m.link((spec) => {
        const target = modules.get(spec.replace(/^\.\//, ''));
        if (!/^\.\/[a-z0-9-]+\.js$/.test(spec) || !target) throw new Error(`imports ${spec}, which is not a panel module`);
        return target;
      });
    } catch (e) { problems.push(`app/${f}: ${e.message}`); }
  }
  const exportsOf = (f) => (modules.get(f)?.status === 'linked' ? new Set(Reflect.ownKeys(modules.get(f).namespace)) : null);
  for (const [f, src] of text) {
    const lazy = [...src.matchAll(/import\('\.\/([a-z0-9-]+\.js)'\)\.then\(\(m\) => m\.(\w+)/g)].map(([, t, n]) => [t, [n]])
      .concat([...src.matchAll(/const \{ ([\w, ]+) \} = await import\('\.\/([a-z0-9-]+\.js)'\)/g)].map(([, n, t]) => [t, n.split(/,\s*/)]));
    for (const [t, wanted] of lazy) {
      const ex = exportsOf(t);
      if (!text.has(t)) problems.push(`app/${f}: loads ./${t}, which does not exist`);
      else if (ex) for (const n of wanted) if (!ex.has(n)) problems.push(`app/${f}: loads ./${t} for ${n}, which it does not export`);
    }
  }
  // 4. browser dialogs: calls only (comments and method calls such as installPrompt.prompt() are fine)
  const scripts = [...text].concat([['../page.js', readFileSync(resolve(PUBLIC, 'page.js'), 'utf8')]]);
  for (const [f, src] of scripts) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/(?<![.\w$])(confirm|alert|prompt)\s*\(/g)) problems.push(`app/${f}: calls ${m[1]}(): ask with the panel's own dialog instead (core.js ask())`);
  }
  const br = (s) => brotliCompressSync(Buffer.from(s), { params: { [zc.BROTLI_PARAM_QUALITY]: 9 } }).length;
  const first = staticClosure(FIRST_SCREEN, (f) => text.get(f) || '');
  const css = readFileSync(resolve(APP, 'styles.css'), 'utf8');
  const shell = readFileSync(resolve(PUBLIC, 'index.html'), 'utf8');
  const firstBytes = br(shell) + br(css) + first.reduce((n, f) => n + br(text.get(f) || ''), 0);
  const totalBytes = br(shell) + br(css) + names.reduce((n, f) => n + br(text.get(f)), 0);
  if (firstBytes > FIRST_BUDGET) problems.push(`The first screen is ${firstBytes} bytes (brotli), over its ${FIRST_BUDGET}-byte budget. Load what Overview does not need on demand (import()), or raise FIRST_BUDGET in scripts/check-panel.mjs with a reason in the PR.`);
  if (totalBytes > TOTAL_BUDGET) problems.push(`The panel is ${totalBytes} bytes (brotli), over its ${TOTAL_BUDGET}-byte budget. Remove what your change replaces, reuse existing helpers, or raise TOTAL_BUDGET in scripts/check-panel.mjs with a reason in the PR.`);
  return { problems, modules: names.length, first: first.length, firstBytes, totalBytes, FIRST_BUDGET, TOTAL_BUDGET };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await checkPanel();
  for (const p of r.problems) console.log(`::error::Panel: ${p}`);
  console.log(`Panel: ${r.modules} modules; first screen ${r.first} modules, ${r.firstBytes} of ${r.FIRST_BUDGET} bytes; all ${r.totalBytes} of ${r.TOTAL_BUDGET} bytes (brotli)`);
  process.exit(r.problems.length ? 1 : 0);
}
