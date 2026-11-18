// @ts-check
// Media job queue (043, issue #48). Heavy work — a photo or voice-note turn (download, transcription, the model call,
// a voice reply), image creation, a voice reply to a text message — runs here instead of inside the message
// handler, so a small server never does several at once and nobody has to resend:
//  - jobs are kept in SQLite (chat, message id, kind, created_at, attempts; the payload never holds photo bytes, only
//    the WhatsApp media reference), so a restart picks them up again;
//  - workers: 1 on small servers, 2 on medium, 3 on large; jobs of one chat run in order, one at a time;
//  - a job that hasn't started after ~10 s gets a ⏳ reaction on the person's message (removed when done); after
//    ~60 s one short "I'm on it" line, once per message;
//  - a job older than the max age (15 min) is answered with a short apology instead of a stale reply;
//  - only when the queue is really full does enqueue() refuse ({ code: 'overloaded' }) — the caller says so once, and
//    (069) the owner hears about it at most once an hour: the newest work is refused, waiting work is never dropped.
// Text-only replies never come here.
import { db, kvGet, kvSet } from './db.js';
import { activity } from './events.js';
import { isChatEnabled } from './chat-prefs.js';
import { serverSize } from './resources.js';
import { silenceReason } from './silences.js';
import { sendOwnerAlert } from './owner-alerts.js';

const TENANT = 'default';
db.exec(`
  CREATE TABLE IF NOT EXISTS media_jobs (
    id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, chat TEXT NOT NULL, msg_id TEXT, sender_jid TEXT, kind TEXT NOT NULL,
    agent TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'queued', started_at INTEGER, signaled INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS media_jobs_state ON media_jobs(state, id);
`);

const timing = { tickMs: 1000, signalMs: 10000, noteMs: 60000, maxAgeMs: Math.max(1, Number(process.env.MEDIA_JOB_MAX_AGE_MIN) || 15) * 60000 };
/** Tests: shorter waits. */
export const setQueueTiming = (t) => Object.assign(timing, t);
const LIMITS = { small: { workers: 1, max: 20 }, medium: { workers: 2, max: 40 }, large: { workers: 3, max: 80 } };
export const queueLimits = () => LIMITS[serverSize().size];
export const MAX_ATTEMPTS = 2;

const handlers = new Map(); // kind -> { run(payload, job), stale?(payload, job), failed?(payload, job, err) }
let channel = null;
const active = new Map(); // job id -> chat
let ticker = null;

export function registerJobHandler(kind, h) { handlers.set(kind, h); }
export function setQueueChannel(ch) { channel = ch; }

const count = () => db.prepare('SELECT COUNT(*) AS n FROM media_jobs WHERE tenant_id = ?').get(TENANT).n;
/** 069: the queue refused work: record it and tell the owner, at most once an hour. */
function queueFull(now = Date.now()) {
  if (now - (Number(kvGet('health:queueFullAt')) || 0) < 3600000) return;
  kvSet('health:queueFullAt', now);
  const text = `Photos & voice: ${queueLimits().max} requests are waiting, so new ones are refused for now and people are asked to send them again in a few minutes. The queue empties by itself; on a busy server consider a bigger one.`;
  activity('error', { summary: text });
  sendOwnerAlert(`Duniya: ${text}`, { kind: 'queue' }).catch(() => {});
}
/** Queue a job. Throws { code: 'overloaded' } when the queue is full. Returns the job id. */
export function enqueue({ kind, chat, msgId = '', senderJid = '', agent = '', payload = {} }) {
  if (!handlers.has(kind)) throw new Error(`No handler for media job "${kind}"`);
  if (count() >= queueLimits().max) { queueFull(); throw Object.assign(new Error('The media queue is full'), { code: 'overloaded' }); }
  const r = db.prepare('INSERT INTO media_jobs (tenant_id, chat, msg_id, sender_jid, kind, agent, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(TENANT, chat, msgId || '', senderJid || '', kind, agent || '', JSON.stringify(payload), Date.now());
  setImmediate(pump);
  return Number(r.lastInsertRowid);
}

export function queueStats() {
  const rows = db.prepare('SELECT state, COUNT(*) AS n, MIN(created_at) AS oldest FROM media_jobs WHERE tenant_id = ? GROUP BY state').all(TENANT);
  const by = Object.fromEntries(rows.map((r) => [r.state, r]));
  return { queued: by.queued?.n || 0, running: by.running?.n || 0, oldest: Math.min(by.queued?.oldest || Infinity, by.running?.oldest || Infinity) === Infinity ? null : Math.min(by.queued?.oldest || Infinity, by.running?.oldest || Infinity), ...queueLimits() };
}

/** What a queued turn needs to run later, even after a restart (no media bytes, no raw message object). */
export const packMsg = (m) => ({ channel: m.channel, chat: m.chat, number: m.number, isGroup: m.isGroup, phone: m.phone, senderJid: m.senderJid, senderName: m.senderName,
  msgId: m.msgId, ts: m.ts, text: m.text, caption: m.caption || '', quoted: m.quoted || '', mentioned: !!m.mentioned, replyToAgent: !!m.replyToAgent,
  mediaInfo: m.mediaInfo || null, mediaRef: m.mediaRef || '', personId: m.personId || '' });
export function unpackMsg(ch, p) {
  return { ...p, raw: null, fetchMedia: () => ch.downloadMedia(p.chat, p.mediaRef, p.mediaInfo?.size || 0) };
}
/** How a reply quotes the message it answers: the raw message when we have it, else its key (queued turns). */
export const quoteOf = (msg) => (msg.raw ? { quoted: msg.raw } : msg.msgId ? { quote: { msgId: msg.msgId, fromMe: false, participant: msg.isGroup ? msg.senderJid : undefined, text: msg.text } } : {});

const del = (id) => db.prepare('DELETE FROM media_jobs WHERE id = ?').run(id);
const parse = (job) => { try { return JSON.parse(job.payload); } catch { return {}; } };
const ref = (job) => ({ msgId: job.msg_id, fromMe: false, participant: job.sender_jid || undefined });
// Jobs run only for chats that are on, except jobs for the owner assistant's own chat (059, payload.owner): it answers
// its linked user whether that chat is on or off, like its text replies.
const chatOk = (job, payload = parse(job)) => !!payload.owner || isChatEnabled(job.chat);

async function finish(job) {
  if (job.signaled >= 1 && job.msg_id) await channel?.react?.(job.chat, ref(job), '').catch(() => {}); // take the ⏳ back
}

async function runOne(job) {
  const h = handlers.get(job.kind);
  const payload = parse(job);
  try {
    if (!h || !chatOk(job, payload)) { del(job.id); await finish(job); return; } // chat switched off meanwhile: drop quietly
    if (Date.now() - job.created_at > timing.maxAgeMs) {
      del(job.id);
      await finish(job);
      silenceReason('stale', { chat: job.chat, agent: job.agent });
      await h.stale?.(payload, job);
      return;
    }
    await h.run(payload, job);
    del(job.id);
    await finish(job);
  } catch (e) {
    const again = job.attempts < MAX_ATTEMPTS && !e.permanent && Date.now() - job.created_at < timing.maxAgeMs;
    activity('error', { agent: job.agent, chat: job.chat, summary: `Media job ${job.kind} failed${again ? ' (will retry)' : ''}: ${e.message}` });
    if (again) db.prepare("UPDATE media_jobs SET state = 'queued' WHERE id = ?").run(job.id);
    else { del(job.id); await finish(job); await h?.failed?.(payload, job, e).catch(() => {}); }
  }
}

/** Start as many jobs as the server allows: oldest first, one per chat at a time. */
export function pump() {
  if (!handlers.size) return;
  const { workers } = queueLimits();
  if (active.size >= workers) return;
  const busyChats = new Set(active.values());
  for (const job of db.prepare("SELECT * FROM media_jobs WHERE tenant_id = ? AND state = 'queued' ORDER BY id LIMIT 100").all(TENANT)) {
    if (active.size >= workers) break;
    if (busyChats.has(job.chat)) continue;
    busyChats.add(job.chat);
    active.set(job.id, job.chat);
    db.prepare("UPDATE media_jobs SET state = 'running', started_at = ?, attempts = attempts + 1 WHERE id = ?").run(Date.now(), job.id);
    runOne({ ...job, attempts: job.attempts + 1 }).finally(() => { active.delete(job.id); setImmediate(pump); });
  }
}

/** ⏳ on messages whose job hasn't started after ~10 s; one "I'm on it" line after ~60 s. */
async function signals() {
  if (!channel) return;
  const now = Date.now();
  for (const job of db.prepare("SELECT * FROM media_jobs WHERE tenant_id = ? AND state = 'queued' AND signaled < 2 AND created_at <= ? ORDER BY id LIMIT 50").all(TENANT, now - timing.signalMs)) {
    if (!chatOk(job)) continue;
    if (job.signaled === 0) {
      db.prepare('UPDATE media_jobs SET signaled = 1 WHERE id = ?').run(job.id);
      if (job.msg_id) await channel.react?.(job.chat, ref(job), '⏳').catch(() => {});
    }
    if (now - job.created_at >= timing.noteMs) {
      db.prepare('UPDATE media_jobs SET signaled = 2 WHERE id = ?').run(job.id);
      const ahead = db.prepare("SELECT COUNT(*) AS n FROM media_jobs WHERE tenant_id = ? AND id < ?").get(TENANT, job.id).n;
      await channel.send(job.chat, `I’m on it${ahead ? ` — ${ahead === 1 ? 'one request is' : 'a few requests are'} ahead of yours` : ''}.`, job.msg_id ? { quote: { ...ref(job), text: '' } } : undefined).catch(() => {});
    }
  }
}

/** Start the workers. Jobs a restart interrupted are queued again (they keep their attempt count). */
export function startQueue() {
  db.prepare("UPDATE media_jobs SET state = 'queued' WHERE tenant_id = ? AND state = 'running'").run(TENANT);
  for (const id of active.keys()) active.delete(id);
  if (!ticker) {
    ticker = setInterval(() => { signals().catch(() => {}); pump(); }, timing.tickMs);
    ticker.unref?.();
  }
  setImmediate(pump);
}
export function stopQueue() { clearInterval(ticker); ticker = null; }
/** Tests: run the signal check now. */
export const checkSignals = signals;
/** Tests / shutdown: wait until nothing is queued or running. */
export async function drain(ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    pump();
    if (!count() && !active.size) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}
