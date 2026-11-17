// @ts-check
// Panel routes: status (Overview and the live stream), Small server mode, general settings, activity and its logging settings.
import { isBuiltin, listAgents } from '../../core/agents.js';
import { enabledChats } from '../../core/chat-prefs.js';
import { listActivity, listPending } from '../../core/db.js';
import { LOG_CATEGORIES, activity, bus, loggingSettings, resetLoggingCache } from '../../core/events.js';
import { MAX_LOAD } from '../../core/history-load.js';
import { queueStats } from '../../core/media-queue.js';
import { ratingsOf } from '../../core/review.js';
import { serverSize, setSmallServerMode, smallServerMode } from '../../core/resources.js';
import { getSettings, updateSettings } from '../../core/store.js';
import { osUpdatesCached, rebootStatus } from '../../core/system.js';
import { whatsNew } from '../../core/updates.js';
import { ROOT } from '../../core/config.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';

const PKG_VERSION = (() => { try { return `v${JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version}`; } catch { return ''; } })();
// The running version cannot change without a restart: ask git once, not on every status (058).
let versionOnce = null;
const gitVersion = () => (versionOnce ||= new Promise((r) => execFile('git', ['log', '-1', '--format=%h'], { cwd: ROOT }, (e, out) => r([PKG_VERSION, e ? '' : out.trim()].filter(Boolean).join(' · ') || 'unknown'))));
const startedAt = Date.now();
/** What Small server mode is and what it covers here (055). */
const smallModeView = () => ({ enabled: smallServerMode(), server: serverSize(),
  covers: ['On-server speech (about 900 MB minimum, one voice note at a time, only with enough free memory)',
    'Local tool services (at most 2 at once, started when first used, stopped when memory is tight)'],
  notCovered: ['GitHub Copilot sign-in (its ~400 MB download and helper do not fit next to the app; needs 2 GB)'] });

/** What Overview and the shell show (GET /api/status, the live stream, and the panel's first load with the session). */
export const statusFor = async (user, channel) => ({
  user, enabledChats: enabledChats().length,
  channel: await channel.status(),
  settings: getSettings(),
  version: await gitVersion(),
  uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  memoryMb: Math.round(process.memoryUsage().rss / 1048576),
  server: { ...serverSize(), smallMode: smallServerMode() }, // small-server guardrails (043, 055): size, RAM, CPUs, switch
  mediaQueue: queueStats(),
  node: process.version,
  agents: listAgents().filter((b) => !isBuiltin(b)).map((b) => ({ id: b.id, name: b.name, enabled: b.enabled, chats: b.chats.length })), // 059: chat agents
  pending: listPending().length,
  whatsNew: whatsNew(user), // 065: { from, to } once after an update, until this user opened or hid it
  // #96: Server tab badge — only updates that will install now (from the last check; never runs apt here)
  osUpdates: ['admin', 'owner'].includes(user?.role) ? { ...(osUpdatesCached() || { count: 0, security: 0, at: null }), restart: rebootStatus().required } : null,
});

// 069: an entry is serialized once, however many panels are open
const frames = new WeakMap();
const frameOf = (a) => { let f = frames.get(a); if (!f) { f = `data: ${JSON.stringify(a)}\n\n`; frames.set(a, f); } return f; };

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function statusRoutes(route, { channel } = {}) {
  route('GET', '/api/status', async (req, res, body, q, p, user) => statusFor(user, channel));
  // 055: Small server mode — one server-wide switch for heavier features on a small server (owner only).
  route('GET', '/api/server/small-mode', async () => smallModeView());
  route('PUT', '/api/server/small-mode', async (req, res, body, q, p, user) => {
    if (typeof body.enabled !== 'boolean') return [400, { error: 'enabled must be true or false', field: 'enabled' }];
    setSmallServerMode(body.enabled);
    activity('config', { summary: `Small server mode ${body.enabled ? 'on' : 'off'} by ${user.username}` });
    return smallModeView();
  }, { role: 'owner' });
  route('POST', '/api/settings', async (req, res, body, q, p, user) => {
    const patch = {};
    if ('paused' in body) patch.paused = !!body.paused;
    if ('defaultDmAgent' in body) patch.defaultDmAgent = String(body.defaultDmAgent || '');
    // #91: how many earlier messages to load from the phone when a chat is switched on (0 = don't)
    if ('historyLoadCount' in body) patch.historyLoadCount = Math.max(0, Math.min(MAX_LOAD, Math.round(Number(body.historyLoadCount)) || 0));
    activity('system', { summary: `Settings by ${user.username}: ${JSON.stringify(patch)}` });
    return updateSettings(patch);
  });

  // ---------- activity ----------
  // 072: a reply carries its rating (detail.msg is the stored answer), the same as in Review and the chat's messages
  route('GET', '/api/activity', async (req, res, body, q) => {
    const rows = listActivity({ limit: q.get('limit'), agent: q.get('agent') || '', chat: q.get('chat') || '', before: Number(q.get('before') || 0) });
    const rated = ratingsOf(rows.filter((r) => r.type === 'message.out' && r.detail?.msg).map((r) => r.detail.msg));
    return rated.size ? rows.map((r) => (r.type === 'message.out' && rated.has(r.detail?.msg) ? { ...r, rating: rated.get(r.detail.msg) } : r)) : rows;
  });
  // Live panel (058): activity entries as plain messages, and the status (what GET /api/status returns) as `status`
  // events: shortly after anything changed (activity or a channel state change such as a new QR) and with the
  // keep-alive every 25 s (uptime, memory). Unchanged status is not sent again, except with the keep-alive.
  route('GET', '/api/events', async (req, res, body, q, p, user) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    let last = ''; let soon = null; let closed = false;
    const pushStatus = async (always) => {
      soon = null;
      const st = await statusFor(user, channel).catch(() => null);
      if (!st || closed) return;
      const { uptimeSec, memoryMb, ...rest } = st;
      const sig = JSON.stringify(rest);
      if (!always && sig === last) return;
      last = sig;
      res.write(`event: status\ndata: ${JSON.stringify(st)}\n\n`);
    };
    const changed = () => { if (!soon) soon = setTimeout(pushStatus, 250); };
    const onAct = (a) => { res.write(frameOf(a)); changed(); };
    const ping = setInterval(() => pushStatus(true), 25000);
    bus.on('activity', onAct);
    bus.on('status', changed);
    req.on('close', () => { closed = true; bus.off('activity', onAct); bus.off('status', changed); clearInterval(ping); clearTimeout(soon); });
    return null; // the panel loads the status itself when it opens or reconnects the stream
  });
  // ---------- activity logging settings (011) ----------
  route('GET', '/api/logging', async () => ({ settings: loggingSettings(), categories: LOG_CATEGORIES }));
  route('PUT', '/api/logging', async (req, res, body, q, p, user) => {
    const cur = loggingSettings();
    const next = {
      level: ['minimal', 'normal', 'verbose'].includes(body.level) ? body.level : cur.level,
      categories: Object.fromEntries(Object.keys(LOG_CATEGORIES).map((k) => [k, body.categories?.[k] ?? cur.categories[k]]).map(([k, v]) => [k, !!v])),
      retentionDays: Math.max(1, Math.min(365, Number(body.retentionDays) || cur.retentionDays)),
      maxEntries: Math.max(500, Math.min(100000, Number(body.maxEntries) || cur.maxEntries)),
    };
    updateSettings({ logging: next });
    resetLoggingCache();
    activity('config', { summary: `Activity logging: ${next.level}, keep ${next.retentionDays} days / ${next.maxEntries} entries (${user.username})` });
    return next;
  });
}
