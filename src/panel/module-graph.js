// The panel's module graph (063), shared by the server (assets.js: import map, modulepreload) and the checks
// (scripts/check-panel.mjs: budgets). Pure: reads sources it is given, no I/O.

/** The modules whose static imports make up the first screen: the entry and Overview, the landing screen. */
export const FIRST_SCREEN = ['main.js', 'overview.js'];

/** Static `import … from './x.js'` targets of a module. Dynamic import() is left out on purpose: those load later. */
const importsOf = (src) => [...String(src).matchAll(/^import [^'\n]* from '\.\/([a-z0-9-]+\.js)';$/gm)].map((m) => m[1]);

/** Every module reachable through static imports from `roots`; `source(name)` returns a module's text. */
export function staticClosure(roots, source) {
  const seen = new Set();
  const walk = (f) => { if (seen.has(f)) return; seen.add(f); for (const d of importsOf(source(f))) walk(d); };
  roots.forEach(walk);
  return [...seen];
}
