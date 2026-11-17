// First-load measurement of the panel (063): the seeded demo panel in headless Chrome on throttled networks.
// Reports what a signed-in owner downloads before Overview is drawn and how long that takes, cold (empty cache) and
// warm (a second visit), also with a phone-speed CPU. Needs Chrome (CHROME_PATH); no network beyond 127.0.0.1.
//
//   npm run measure:load            → a table: profile, cold/warm, bytes, requests, first render (median of 3 runs)
import { startDemo, DEMO_PASSWORD } from './demo-panel.mjs';
import { launch, newPage } from './cdp.mjs';

const PROFILES = [
  { name: '1.6 Mbps / 150 ms', down: 1.6e6 / 8, up: 750e3 / 8, latency: 150 },
  { name: '10 Mbps / 40 ms', down: 10e6 / 8, up: 5e6 / 8, latency: 40 },
  { name: '10 Mbps / 40 ms, phone CPU (4× slower)', down: 10e6 / 8, up: 5e6 / 8, latency: 40, cpu: 4 },
];
const RUNS = 3;
// Marks the moment the Overview hero card exists (constant source, installed before every navigation).
const MARK = `new MutationObserver((_, o) => { if (document.querySelector('#main .console')) { window.__firstRender = performance.now(); o.disconnect(); } })
  .observe(document, { childList: true, subtree: true });`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const { base } = await startDemo();
const cdp = await launch();
const page = await newPage(cdp, { width: 1440, scheme: 'light' });
await page.send('Network.enable');
// Plain http on 127.0.0.1: Chrome only offers brotli over HTTPS. Ask for it like it does on a real (HTTPS) panel.
await page.send('Network.setExtraHTTPHeaders', { headers: { 'accept-encoding': 'br, gzip' } });
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MARK });
await page.goto(base);
await page.call(`async function (password) {
  const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });
  return r.status;
}`, DEMO_PASSWORD);

let bytes = 0; let requests = 0;
cdp.on((m) => { if (m.method === 'Network.loadingFinished') { bytes += m.params.encodedDataLength; requests++; } });

async function visit() {
  bytes = 0; requests = 0;
  await page.send('Page.navigate', { url: 'about:blank' });
  await sleep(100);
  await page.send('Page.navigate', { url: `${base}/#overview` });
  let t = null;
  for (let i = 0; i < 600 && t == null; i++) { await sleep(50); t = await page.evaluate('window.__firstRender ?? null').catch(() => null); }
  await sleep(300); // the requests that finished with the first render
  return { ms: Math.round(t), bytes, requests };
}

const rows = [];
for (const p of PROFILES) {
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up });
  await page.send('Emulation.setCPUThrottlingRate', { rate: p.cpu || 1 });
  for (const mode of ['cold', 'warm']) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      if (mode === 'cold') { await page.send('Network.clearBrowserCache'); await page.send('Network.setCacheDisabled', { cacheDisabled: false }); } else await visit(); // warm: fill the cache first
      runs.push(await visit());
    }
    rows.push({ profile: p.name, mode, ms: median(runs.map((r) => r.ms)), kb: Math.round(median(runs.map((r) => r.bytes)) / 1024), requests: median(runs.map((r) => r.requests)) });
  }
}
console.table(rows);
cdp.close();
process.exit(0);
