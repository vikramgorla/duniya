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
// (Models, Settings, Backups) and the plan-usage meters.
const FIRST_BUDGET = 59_800; // 067: +0.2 KB for the Overview hint when a plan is at 80 %+. #136: +0.6 KB for the quiet copy icon (copy/done icons) and plain tool phrases in old activity entries. 066: +6 KB (with the 065 change logs merged) for the Ask conversation (thinking, live tool chips, streaming markdown, Stop), plain-word activity rows, and recovery after the phone suspends the app (deadlines, Retry, pull to refresh)
const TOTAL_BUDGET = 160_000; // 067: +1.2 KB for plan usage (plans.js: Plan usage on the provider page and per account, Plans and credit on Usage). #136 and 066: same reasons as the first screen

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
