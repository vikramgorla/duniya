// @ts-check
// The panel's static files (058, 063): the HTML shell, its native ES modules and stylesheet (public/app/), the web app
// manifest and icons. Read once at start, compressed once, served from memory with an ETag (staticFile).
//
// Every file under /app/ gets a content-hash URL (?v=<hash>, cached for good). The shell carries an import map from
// each module's plain path to its hashed URL, so a module's relative imports (`./core.js`) reach the same hashed URL
// and a release only re-downloads the files that changed. The import map is the shell's only inline script: its
// sha256 goes into the shell's Content-Security-Policy instead of 'unsafe-inline'. The modules the first screen needs
// (main.js and Overview, with their static imports) are announced with <link rel=modulepreload>, so they download in
// parallel instead of one import level after the other; every other screen loads on its first visit (core.js#show).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CSP, staticFile } from './http.js';
import { FIRST_SCREEN, staticClosure } from './module-graph.js';
import { REPO } from '../core/config.js';

const PUBLIC = resolve(import.meta.dirname, 'public');
const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml' };

export function panelAssets() {
  const files = [
    ...readdirSync(resolve(PUBLIC, 'app')).map((f) => `app/${f}`),
    'manifest.webmanifest', 'page.css', 'page.js', ...readdirSync(resolve(PUBLIC, 'icons')).map((f) => `icons/${f}`),
  ];
  const sources = new Map(files.map((f) => [f, readFileSync(resolve(PUBLIC, f))]));
  const assets = Object.fromEntries(files.map((f) => [`/${f}`, staticFile(sources.get(f), { 'content-type': TYPES[f.split('.').pop()] })]));
  const url = (f) => `/${f}?v=${assets[`/${f}`].version}`;

  const modules = files.filter((f) => f.startsWith('app/') && f.endsWith('.js'));
  const importMap = JSON.stringify({ imports: Object.fromEntries(modules.map((f) => [`/${f}`, url(f)])) });
  const first = staticClosure(FIRST_SCREEN, (f) => sources.get(`app/${f}`));
  // 084: the repository for the panel's guide and release links (a validated slug: safe in an attribute)
  const head = [`<meta name="duniya-repo" content="${REPO.url}">`, `<script type="importmap">${importMap}</script>`, ...first.map((f) => `<link rel="modulepreload" href="${url(`app/${f}`)}">`)].join('\n');
  const html = readFileSync(resolve(PUBLIC, 'index.html'), 'utf8')
    .replace('<!--modules-->', () => head)
    .replace(/ (src|href)="(\/[a-z0-9/.-]+\.[a-z]+)"/g, (m, attr, f) => (assets[f] ? ` ${attr}="${url(f.slice(1))}"` : m));
  const hash = createHash('sha256').update(importMap).digest('base64');
  const csp = CSP.replace("script-src 'self' 'unsafe-inline'", `script-src 'self' 'sha256-${hash}'`);
  const shell = staticFile(Buffer.from(html), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'x-frame-options': 'DENY' });
  return { shell, assets };
}
