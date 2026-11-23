// Renders the home-screen icons from the master mark (src/panel/public/icons/logo.svg), so
// they never drift from it (DESIGN.md, Mark). Needs Chrome (CHROME_PATH). Run: npm run brand:icons
//   icon-192.png, icon-512.png   the mark as it is (rounded tile, transparent corners): browsers, Android "any"
//   apple-touch-icon.png (180)   a full square: iOS rounds the corners itself and shows transparent ones as black
//   maskable-512.png             a full square with the robot at MASKABLE_SCALE, inside Android's safe circle
// Then copies the marks to the website (docs/site/img), which must hold the same files (ci-checks.mjs compares them).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, newPage } from './cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ICONS = resolve(ROOT, 'src/panel/public/icons');
const MASKABLE_SCALE = 0.74; // the robot and its bubbles fit Android's safe zone (a circle of 80 % of the side)
const master = readFileSync(resolve(ICONS, 'logo.svg'), 'utf8');
const square = master.replace(/<rect width="1024" height="1024" rx="\d+"/, '<rect width="1024" height="1024"');
const maskable = square.replace(/<path fill="#fff"/, `<path transform="translate(512 512) scale(${MASKABLE_SCALE}) translate(-512 -512)" fill="#fff"`);
if (square === master || maskable === square) throw new Error('logo.svg no longer has the expected tile and art: update render-icons.mjs');

const cdp = await launch();
async function render(svg, file, size) {
  const page = await newPage(cdp, { width: size, height: size, scale: 1, scheme: 'light' });
  await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const html = `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="display:block;width:${size}px;height:${size}px"></body></html>`;
  await page.goto(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await page.evaluate("document.querySelector('img').decode()");
  writeFileSync(resolve(ICONS, file), await page.capture({ format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } }));
  await page.close();
  console.log('✓', file);
}
try {
  await render(master, 'icon-192.png', 192);
  await render(master, 'icon-512.png', 512);
  await render(square, 'apple-touch-icon.png', 180);
  await render(maskable, 'maskable-512.png', 512);
} finally { cdp.close(); }
for (const f of ['logo.svg', 'logo-small.svg']) copyFileSync(resolve(ICONS, f), resolve(ROOT, 'docs/site/img', f));
console.log('✓ docs/site/img/logo.svg, logo-small.svg');
