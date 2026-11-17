// A tiny DevTools-protocol client for headless Chrome/Chromium (no dependencies).
// Used by scripts/check-responsive.mjs and scripts/site-shots.mjs.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const c = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean);
  const hit = c.find((p) => existsSync(p));
  if (!hit) { console.error('No Chrome or Chromium found. Set CHROME_PATH=/path/to/chrome and run again.'); process.exit(2); }
  return hit;
}
export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'duniya-chrome-'));
  const proc = spawn(findChrome(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  // Only a local DevTools endpoint written by the Chrome we just started.
  if (!/^\d{2,5}$/.test(port) || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(path)) throw new Error('Unexpected DevToolsActivePort content');
  const ws = new WebSocket(`ws://127.0.0.1:${Number(port)}/devtools/browser/${path.split('/').pop()}`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map(); const listeners = new Set();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data); const w = waiting.get(msg.id);
    if (w) { waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); } else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const i = ++id; waiting.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  /** Protocol events (e.g. Network.loadingFinished) of every page: on((msg) => …). */
  const on = (fn) => listeners.add(fn);
  return { send, on, close: () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); } };
}
/** A page at `width` (phones < 600 px get touch + mobile emulation). Optional `height` and `scale` (device pixel ratio). */
export async function newPage(cdp, { width, scheme, height, scale = 1 }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const phone = width < 600;
  await s('Emulation.setDeviceMetricsOverride', { width, height: height || (phone ? 800 : 900), deviceScaleFactor: scale, mobile: phone });
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
  /** Runs a constant function source with plain JSON arguments: data never becomes code. */
  const call = async (fn, ...args) => {
    const { result } = await s('Runtime.evaluate', { expression: 'window' });
    const r = await s('Runtime.callFunctionOn', { objectId: result.objectId, functionDeclaration: fn, arguments: args.map((value) => ({ value })), awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { evaluate, call, goto, shot, send: s, close: () => cdp.send('Target.closeTarget', { targetId }) };
}

