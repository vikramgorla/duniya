// Diagrams as images (#74): renders every docs/diagrams/<name>.mmd (Mermaid source) to docs/diagrams/<name>.svg.
// GitHub's Mermaid renderer fails on some diagrams ("Unable to render rich display") and the GitHub mobile app shows
// Mermaid as code, so the docs embed committed SVGs instead of ```mermaid blocks.
//
// The SVGs are pure SVG text (no <foreignObject>, `htmlLabels: false`), so they render inside <img> everywhere
// (Safari/iOS, the GitHub app); they use a system font stack only (no external requests) and the Constellation look:
// ink text and lines, porcelain nodes, lime decisions, on a solid white rounded card that stays readable in dark mode.
// Each SVG carries `<!-- src-sha256: … -->`, the hash of its source; `scripts/ci-checks.mjs` fails when they differ.
//
// Usage: `npm run docs:diagrams [-- name …] [--grid out.png]`. Needs Chrome (CHROME_PATH) and npm: the Mermaid browser
// bundle is fetched with `npm pack` into a temporary directory outside the repository and checked against a pinned
// integrity hash, so Mermaid is not a dependency of the project. MERMAID_JS=/path/to/mermaid.min.js skips the download.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
export const DIAGRAMS = join(root, 'docs', 'diagrams');
const MERMAID_VERSION = '11.17.2';
const MERMAID_INTEGRITY = 'sha512-V6K3C8EBdEsPFZXSKMJe6ppQOENxuHARr9GvHX4hh47lAbhMRD9qf4oEK7LoaRQxULMa80/qt5gHO73aCleBBg==';
const MAX_WIDTH = 900;
const FONT = 'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Helvetica Neue", Arial, sans-serif';
const INK = '#101216', PORCELAIN = '#f2f1ec', LIME = '#c6f432', HAIRLINE = '#dddbd3';

/** sha256 of a diagram source (line endings normalised). */
export const srcHash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
export const hashInSvg = (svg) => (svg.match(/<!-- src-sha256: ([0-9a-f]{64}) -->/) || [])[1];

/** README.md and docs/**\/*.md (not the website). */
function mdFiles() {
  const out = [join(root, 'README.md')];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== 'site') walk(p); } else if (e.endsWith('.md')) out.push(p);
    }
  };
  walk(join(root, 'docs'));
  return out;
}

/** CI check: every .mmd has an up-to-date .svg (hash), no orphan SVGs, no foreignObject, no ```mermaid in the docs. */
export function checkDiagrams() {
  const problems = [];
  const files = existsSync(DIAGRAMS) ? readdirSync(DIAGRAMS) : [];
  const sources = files.filter((f) => f.endsWith('.mmd'));
  for (const f of sources) {
    const svgFile = join(DIAGRAMS, f.replace(/\.mmd$/, '.svg'));
    const rel = relative(root, svgFile);
    if (!existsSync(svgFile)) { problems.push(`${rel} is missing: run npm run docs:diagrams`); continue; }
    const svg = readFileSync(svgFile, 'utf8');
    if (hashInSvg(svg) !== srcHash(readFileSync(join(DIAGRAMS, f), 'utf8'))) problems.push(`${rel} is out of date with ${f}: run npm run docs:diagrams`);
    if (/<foreignObject/i.test(svg)) problems.push(`${rel} contains <foreignObject> (does not render inside <img>)`);
  }
  for (const f of files.filter((x) => x.endsWith('.svg'))) {
    if (!sources.includes(f.replace(/\.svg$/, '.mmd'))) problems.push(`docs/diagrams/${f} has no source ${f.replace(/\.svg$/, '.mmd')}`);
  }
  for (const file of mdFiles()) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((l, i) => { if (/^\s*(```|~~~)\s*mermaid\b/.test(l)) problems.push(`${relative(root, file)}:${i + 1}: a \`\`\`mermaid block; put the source in docs/diagrams/<name>.mmd and embed the SVG (docs/development.md)`); });
  }
  return { problems, count: sources.length };
}

function mermaidBundle() {
  if (process.env.MERMAID_JS) return readFileSync(process.env.MERMAID_JS, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'duniya-mermaid-'));
  try {
    const [info] = JSON.parse(execFileSync('npm', ['pack', `mermaid@${MERMAID_VERSION}`, '--json', '--silent', '--pack-destination', dir], { encoding: 'utf8', cwd: dir }));
    const tgz = join(dir, basename(info.filename));
    const got = `sha512-${createHash('sha512').update(readFileSync(tgz)).digest('base64')}`;
    if (got !== MERMAID_INTEGRITY) throw new Error(`mermaid@${MERMAID_VERSION} integrity mismatch (${got})`);
    execFileSync('tar', ['xzf', tgz, '-C', dir, 'package/dist/mermaid.min.js']);
    return readFileSync(join(dir, 'package', 'dist', 'mermaid.min.js'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  htmlLabels: false,
  fontFamily: FONT,
  flowchart: { htmlLabels: false, wrappingWidth: 420, curve: 'basis', padding: 14, nodeSpacing: 34, rankSpacing: 44, diagramPadding: 8, useMaxWidth: false },
  sequence: { useMaxWidth: false, actorFontFamily: FONT, noteFontFamily: FONT, messageFontFamily: FONT, mirrorActors: false },
  themeVariables: {
    fontFamily: FONT, fontSize: '15px', background: '#ffffff',
    primaryColor: PORCELAIN, primaryBorderColor: INK, primaryTextColor: INK, secondaryColor: PORCELAIN, tertiaryColor: '#ffffff',
    lineColor: INK, textColor: INK, edgeLabelBackground: '#ffffff', nodeTextColor: INK,
    actorBkg: PORCELAIN, actorBorder: INK, actorTextColor: INK, actorLineColor: '#8a8c93', signalColor: INK, signalTextColor: INK,
    noteBkgColor: LIME, noteBorderColor: INK, noteTextColor: INK,
  },
  themeCSS: `.node polygon { fill: ${LIME}; } .edgeLabel rect, .labelBkg { fill: #ffffff; opacity: 1; } .edgeLabel text, .edgeLabel tspan { fill: #3b3d44; }`,
};

/** In the page: render one diagram, add the card background, padding, size and the source hash. */
const RENDER = (name, src, hash) => `(async () => {
  const { svg } = await mermaid.render(${JSON.stringify(`d-${name}`)}, ${JSON.stringify(src)});
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const NS = 'http://www.w3.org/2000/svg', pad = 18;
  const [x, y, w, h] = el.getAttribute('viewBox').split(/[\\s,]+/).map(Number);
  const W = Math.ceil(w + 2 * pad), H = Math.ceil(h + 2 * pad);
  el.setAttribute('viewBox', [Math.floor(x - pad), Math.floor(y - pad), W, H].join(' '));
  el.setAttribute('width', W); el.setAttribute('height', H);
  el.removeAttribute('style');
  for (const r of el.querySelectorAll('g.node > rect, g.node rect.basic, g.actor rect, rect.actor')) { if (!Number(r.getAttribute('rx'))) { r.setAttribute('rx', 8); r.setAttribute('ry', 8); } }
  const bg = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ x: Math.floor(x - pad) + 0.5, y: Math.floor(y - pad) + 0.5, width: W - 1, height: H - 1, rx: 16, fill: '#ffffff', stroke: '${HAIRLINE}' })) bg.setAttribute(k, v);
  el.insertBefore(bg, el.firstChild);
  el.insertBefore(document.createComment(' src-sha256: ${hash} '), el.firstChild);
  el.insertBefore(document.createComment(' Generated from docs/diagrams/${name}.mmd by npm run docs:diagrams; do not edit. '), el.firstChild);
  return { svg: new XMLSerializer().serializeToString(el), width: W, height: H };
})()`;

/** Load every SVG through <img> (as in the docs), count ink pixels, and save a grid screenshot on a dark page. */
async function verify(cdp, newPage, names, gridFile) {
  const page = await newPage(cdp, { width: 1500, height: 900, scheme: 'dark' });
  const items = names.map((n) => ({ n, url: `data:image/svg+xml;base64,${readFileSync(join(DIAGRAMS, `${n}.svg`)).toString('base64')}` }));
  await page.goto('about:blank');
  const results = await page.evaluate(`(async () => {
    const items = ${JSON.stringify(items)};
    document.body.style.cssText = 'margin:0;padding:24px;background:#0d1117;font:14px sans-serif;color:#e6edf3;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start';
    const out = [];
    for (const { n, url } of items) {
      const img = new Image(); img.src = url; await img.decode().catch(() => {});
      const fig = document.createElement('figure'); fig.style.cssText = 'margin:0;display:flex;flex-direction:column;gap:6px';
      const cap = document.createElement('figcaption'); cap.textContent = n + ' (' + img.naturalWidth + ' x ' + img.naturalHeight + ', shown at phone width 343 px and at ' + Math.min(720, img.naturalWidth) + ' px)';
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:16px;align-items:flex-start';
      const phone = img.cloneNode(); phone.style.width = Math.min(343, img.naturalWidth) + 'px';
      img.style.width = Math.min(720, img.naturalWidth) + 'px';
      row.append(phone, img); fig.append(cap, row); document.body.append(fig);
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      let ink = 0; const d = g.getImageData(0, 0, c.width || 1, c.height || 1).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) ink++;
      out.push({ n, w: img.naturalWidth, h: img.naturalHeight, ink: ink / ((c.width * c.height) || 1) });
    }
    return out;
  })()`);
  if (gridFile) await page.shot(gridFile);
  await page.close();
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const gi = args.indexOf('--grid');
  const gridFile = gi >= 0 ? resolve(args.splice(gi, 2)[1]) : null;
  const all = readdirSync(DIAGRAMS).filter((f) => f.endsWith('.mmd')).map((f) => f.replace(/\.mmd$/, '')).sort();
  const names = args.length ? args : all;
  const unknown = names.filter((n) => !all.includes(n));
  if (unknown.length) { console.error(`No docs/diagrams/${unknown[0]}.mmd`); process.exit(2); }
  const { launch, newPage } = await import('./cdp.mjs');
  const bundle = mermaidBundle();
  const cdp = await launch();
  let failed = false;
  try {
    const page = await newPage(cdp, { width: 1400, height: 900, scheme: 'light' });
    await page.goto('about:blank');
    await page.evaluate(`${bundle}\n;document.fonts.load('15px Inter').then(() => true)`);
    const hasInter = await page.evaluate(`document.fonts.check('15px Inter') && (() => { const c = document.createElement('canvas').getContext('2d'); c.font = '15px Inter'; const a = c.measureText('Wide label text').width; c.font = '15px monospace'; return a !== c.measureText('Wide label text').width; })()`);
    if (!hasInter) console.log('Warning: the Inter font is not installed; labels are measured with a fallback font and may be clipped on other systems.');
    await page.evaluate(`mermaid.initialize(${JSON.stringify(CONFIG)}); true`);
    for (const name of names) {
      const src = readFileSync(join(DIAGRAMS, `${name}.mmd`), 'utf8');
      const { svg, width, height } = await page.evaluate(RENDER(name, src, srcHash(src)));
      if (/<foreignObject/i.test(svg)) { failed = true; console.log(`${name}: contains <foreignObject>`); }
      if (/(?:@import|url\(\s*['"]?(?:https?:)?\/\/)/i.test(svg)) { failed = true; console.log(`${name}: references an external resource`); }
      writeFileSync(join(DIAGRAMS, `${name}.svg`), `${svg}\n`);
      console.log(`${name}.svg  ${width} x ${height}${width > MAX_WIDTH ? `  (wider than ${MAX_WIDTH}: consider flowchart TD or shorter labels)` : ''}`);
    }
    await page.close();
    for (const r of await verify(cdp, newPage, names, gridFile)) {
      if (!r.w || r.ink < 0.002) { failed = true; console.log(`${r.n}: does not show readable content inside <img> (ink ${(r.ink * 100).toFixed(2)} %)`); }
    }
    if (gridFile) console.log(`Grid screenshot: ${gridFile}`);
  } finally { cdp.close(); }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
