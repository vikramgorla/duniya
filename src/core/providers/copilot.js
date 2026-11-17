// GitHub Copilot via the official Copilot SDK (018). The SDK runs GitHub's Copilot runtime as a child process
// (JSON-RPC over stdio, ~60 MB RSS idle) and has its own session/agent API — it is not OpenAI-compatible, and we
// never call Copilot's HTTP API directly. Our provider contract is stateless (one model step per chat() call,
// Anthropic-style blocks); the SDK is stateful (a session runs the whole tool loop). This adapter bridges the two:
//  - a call without pending tool results opens a session (system prompt replaces the CLI persona; only our tools
//    are available — no shell, files or web), sends the conversation, and waits for the next step;
//  - when the model calls our tools, the SDK invokes their handlers; we hold those calls open and return them as
//    tool_use blocks; the next chat() call carrying the matching tool_result blocks answers them, and we wait again;
//  - when the session goes idle we return the final text and delete the session.
// The runtime is started on first use and stopped by the upkeep tick when idle (agent apps, 074), so it costs nothing
// when unused; each conversation holds one agent-app slot (one at a time on small servers).
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { getSecret, setSecret, onSecretChange } from '../store.js';
import { DATA_DIR, fail } from '../config.js';
import { netEnv } from '../mcp-local.js';
import { appDir, installApp, startCheck, acquireSlot, registerResident, touchResident, forgetResident } from './apps.js';

export const id = 'copilot';
export const SECRET = 'COPILOT_GITHUB_TOKEN';
const STEP_TIMEOUT_MS = 180000;
const ABANDONED_MS = 5 * 60000;
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export const configured = (secret = SECRET) => !!getSecret(secret);

/** Fine-grained PATs (github_pat_…) and OAuth user tokens (gho_/ghu_) work; classic PATs (ghp_) do not. */
export function checkToken(token) {
  const t = String(token || '').trim();
  if (!t) throw fail('Paste a GitHub token', 400, { field: 'token' });
  if (/^ghp_/.test(t)) throw fail('Classic tokens (ghp_…) don’t work with Copilot. Create a fine-grained token (github_pat_…) with the link in step 2.', 400, { field: 'token' });
  if (!/^(github_pat_|gho_|ghu_)[A-Za-z0-9_]{10,}$/.test(t)) throw fail('That doesn’t look like a GitHub token. It should start with github_pat_', 400, { field: 'token' });
  return t;
}

// ---------- client (injectable for tests) ----------
// The SDK (~220 MB with its runtime) is not part of the app: it is downloaded into DATA_DIR/apps/copilot the first
// time someone connects Copilot (074: the agent apps' on-demand install), and loaded from there. (A dev checkout may
// also have it in node_modules.) Its runtime is about 60 MB RSS idle (measured, SDK 1.0.34).
export const SDK_SPEC = '@github/copilot-sdk@1.0.34';
const SDK_DIR = appDir('copilot');
function sdkEntry() {
  const pkgDir = join(SDK_DIR, 'node_modules', '@github', 'copilot-sdk');
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const exp = pkg.exports?.['.'] ?? pkg.exports;
    const rel = (typeof exp === 'string' ? exp : exp?.import?.default ?? exp?.import ?? exp?.default) || pkg.module || pkg.main || 'index.js';
    return join(pkgDir, typeof rel === 'string' ? rel : 'index.js');
  } catch { return null; }
}
export const sdkInstalled = () => !!sdkEntry() && existsSync(sdkEntry());
/** Download the official Copilot SDK into DATA_DIR (once). */
export const installSdk = () => installApp({ id: 'copilot', name: 'GitHub Copilot', spec: SDK_SPEC, ready: sdkInstalled });
async function loadSdk() {
  try { return await import('@github/copilot-sdk'); } catch { /* not in node_modules: use the downloaded copy */ }
  if (!sdkInstalled()) await installSdk();
  return import(pathToFileURL(sdkEntry()).href);
}

async function defaultFactory({ token }) {
  const sdk = await loadSdk();
  const baseDirectory = join(DATA_DIR, 'copilot');
  mkdirSync(baseDirectory, { recursive: true, mode: 0o700 });
  const client = new sdk.CopilotClient({
    gitHubToken: token, useLoggedInUser: false, mode: 'empty', baseDirectory, workingDirectory: baseDirectory, logLevel: 'error',
    // Scrubbed environment: never the app's own secrets or settings.
    env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: baseDirectory, COPILOT_TELEMETRY_DISABLED: 'true', ...netEnv() },
  });
  client.approveAll = sdk.approveAll;
  return client;
}
let factory = defaultFactory;
/** Tests: replace how the SDK client is made (no runtime, no network). Pass null to restore. */
export function setClientFactory(fn) { stopClient(); factory = fn || defaultFactory; }

// 042: one runtime per connected Copilot account (each account's token lives in its own secret).
const clients = new Map(); // secret -> { token, started: Promise }
// 074: the runtime stays up between turns as a "resident" agent app; the upkeep tick stops it when idle (2 minutes on
// small servers, 10 otherwise), when memory gets tight, or when another app needs the slot on a small server.
const touch = () => touchResident('copilot');
/** Stop one account's runtime (or all of them). */
export function stopClient(secret) {
  if (!secret) forgetResident('copilot');
  for (const [k, c] of [...conversations]) {
    if (secret && c.secret !== secret) continue;
    c.abandon('Copilot connection closed');
    conversations.delete(k);
  }
  for (const [k, c] of [...clients]) {
    if (secret && k !== secret) continue;
    clients.delete(k);
    c.started.then((cl) => cl.stop?.()).catch(() => {});
  }
}
onSecretChange((n) => { if (clients.has(n)) stopClient(n); });

async function client(secret = SECRET) {
  const token = getSecret(secret);
  if (!token) throw Object.assign(new Error('GitHub Copilot is not connected (Models)'), { code: 'no_model' });
  let cur = clients.get(secret);
  if (!cur || cur.token !== token) {
    if (cur) stopClient(secret);
    if (!clients.size) startCheck('GitHub Copilot', 150);
    const started = (async () => { const cl = await factory({ token }); await cl.start?.(); return cl; })();
    registerResident('copilot', { idle: () => !conversations.size, stop: () => stopClient() });
    cur = { token, started };
    clients.set(secret, cur);
    started.catch(() => { if (clients.get(secret)?.started === started) clients.delete(secret); });
  }
  touch();
  return cur.started;
}

export const friendlyError = (e) => {
  const m = String(e?.message || e);
  if (/quota|usage limit|rate.?limit|exhausted/i.test(m)) return Object.assign(new Error(`GitHub Copilot usage limit reached: ${m.slice(0, 200)}`), { code: 'copilot_limit' });
  if (/Authentication failed|Not authenticated|401|403|Bad credentials/i.test(m)) {
    return Object.assign(new Error(`GitHub didn’t accept the token for Copilot. Check that it has the “Copilot requests” permission (if “Read” fails, try “Read and write”) and that this account has Copilot. (${m.slice(0, 160)})`), { code: e?.code });
  }
  return e instanceof Error ? e : new Error(m);
};

// ---------- models ----------
async function listModelsFor(secret) {
  try {
    const cl = await client(secret);
    const res = await cl.rpc.models.list({});
    return (res?.models || res || [])
      .filter((m) => m?.id && m.policy?.state !== 'disabled')
      .map((m) => ({ id: m.id, label: m.name || m.id, ...(m.billing?.multiplier != null ? { multiplier: m.billing.multiplier } : {}) }));
  } catch (e) { throw friendlyError(e); }
}

/** Signed-in GitHub login, when the runtime reports it. */
export async function account(secret = SECRET) {
  try { const cl = await client(secret); const s = await cl.getAuthStatus?.(); return s?.login || ''; } catch { return ''; }
}

export function disconnect(secret = SECRET) { setSecret(secret, ''); stopClient(secret); }

// ---------- chat bridge ----------
const conversations = new Map(); // tool_use id -> Conversation (one entry per open tool call)

const blocksOf = (m) => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || []);
const textOf = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : JSON.stringify(x))).join('\n') : JSON.stringify(c ?? ''));

/** A conversation the runtime does not already hold (fresh call, or after a restart) becomes one prompt. */
export function toPrompt(messages) {
  if (messages.length === 1 && messages[0].role === 'user') return textOf(blocksOf(messages[0]));
  const lines = ['Conversation so far:'];
  for (const m of messages) {
    for (const b of blocksOf(m)) {
      if (b.type === 'text') lines.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}: ${b.text}`);
      else if (b.type === 'tool_use') lines.push(`Assistant called tool ${b.name} with ${JSON.stringify(b.input ?? {})}`);
      else if (b.type === 'tool_result') lines.push(`Tool result${b.is_error ? ' (error)' : ''}: ${resultText(b.content)}`);
    }
  }
  lines.push('Continue as the assistant.');
  return lines.join('\n');
}

class Conversation {
  constructor(session, cl, toolNames, secret) {
    this.session = session; this.client = cl; this.toolNames = toolNames; this.secret = secret;
    this.pending = new Map(); // toolCallId -> { name, input, resolve }
    this.texts = []; this.expected = null; this.usage = { input_tokens: 0, output_tokens: 0 };
    this.waiter = null; this.error = null; this.idle = false; this.closed = false;
    this.timer = null;
    this.off = session.on((ev) => this.onEvent(ev));
  }
  onEvent(ev) {
    const d = ev?.data || {};
    if (ev.type === 'assistant.message' && !ev.agentId) {
      if (d.content) this.texts.push(d.content);
      if (Array.isArray(d.toolRequests) && d.toolRequests.length) this.expected = d.toolRequests.map((r) => r.toolCallId);
    } else if (ev.type === 'assistant.usage') {
      this.usage.input_tokens += d.inputTokens || 0; this.usage.output_tokens += d.outputTokens || 0;
    } else if (ev.type === 'session.error') {
      this.error = Object.assign(new Error(d.message || 'Copilot error'), { code: d.errorCode || d.errorType });
    } else if (ev.type === 'session.idle') {
      this.idle = true;
    } else return;
    this.check();
  }
  /** Called by the SDK when the model calls one of our tools: hold the call until the agent answers it. */
  toolCall(name, args, inv) {
    const callId = inv?.toolCallId || `call_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve) => {
      this.pending.set(callId, { name: this.toolNames.get(name) || name, input: args ?? {}, resolve, answered: false });
      this.check();
    });
  }
  /** Resolve the current step once the runtime is idle, failed, or all expected tool calls have arrived. */
  check() {
    if (!this.waiter) return;
    const open = [...this.pending].filter(([, p]) => !p.answered);
    if (this.error) return this.finish({ error: this.error });
    if (open.length) {
      // A short grace period lets parallel calls of the same step arrive together; if the runtime runs them one
      // at a time, the rest arrive after we answer the first, which the bridge handles the same way.
      const all = this.expected && this.expected.every((idv) => this.pending.has(idv));
      clearTimeout(this.grace);
      this.grace = setTimeout(() => this.finish({ calls: [...this.pending].filter(([, p]) => !p.answered) }), all ? 20 : 250);
      return;
    }
    if (this.idle && !open.length) this.finish({ done: true });
  }
  step() {
    return new Promise((resolve) => {
      this.waiter = resolve;
      this.timer = setTimeout(() => this.finish({ error: new Error('Copilot did not answer in time') }), STEP_TIMEOUT_MS);
      this.timer.unref?.();
      this.check();
    });
  }
  finish(out) {
    const w = this.waiter; if (!w) return;
    this.waiter = null; clearTimeout(this.timer); clearTimeout(this.grace);
    const text = this.texts.join('\n').trim(); this.texts = []; this.expected = null;
    const usage = this.usage; this.usage = { input_tokens: 0, output_tokens: 0 };
    w({ ...out, text, usage });
  }
  answer(callId, block) {
    const p = this.pending.get(callId); if (!p || p.answered) return false;
    p.answered = true; this.idle = false;
    const text = resultText(block.content);
    p.resolve(block.is_error ? { textResultForLlm: text, resultType: 'failure', error: text.slice(0, 500) } : text);
    return true;
  }
  armAbandon() {
    clearTimeout(this.abandonTimer);
    this.abandonTimer = setTimeout(() => this.abandon('No answer from the agent'), ABANDONED_MS);
    this.abandonTimer.unref?.();
  }
  abandon(reason) {
    for (const [, p] of this.pending) if (!p.answered) { p.answered = true; p.resolve({ textResultForLlm: reason, resultType: 'failure', error: reason }); }
    this.close();
  }
  close() {
    if (this.closed) return; this.closed = true;
    this.release?.();
    clearTimeout(this.abandonTimer); clearTimeout(this.timer); clearTimeout(this.grace);
    for (const idv of this.pending.keys()) if (conversations.get(idv) === this) conversations.delete(idv);
    try { this.off?.(); } catch { /* ignore */ }
    const sid = this.session.sessionId;
    Promise.resolve(this.session.disconnect?.()).catch(() => {}).then(() => this.client.deleteSession?.(sid)).catch(() => {});
  }
}

async function run(conv) {
  const r = await conv.step();
  if (r.error) { conv.close(); throw friendlyError(r.error); }
  const content = r.text ? [{ type: 'text', text: r.text }] : [];
  if (r.calls?.length) {
    for (const [callId, p] of r.calls) { content.push({ type: 'tool_use', id: callId, name: p.name, input: p.input }); conversations.set(callId, conv); }
    conv.armAbandon();
    return { content, stop_reason: 'tool_use', usage: r.usage };
  }
  conv.close();
  return { content, stop_reason: 'end_turn', usage: r.usage };
}

async function chatFor(secret, { model, system, messages, tools = [], onWait }) {
  // Continuing a conversation: the last user turn answers tool calls the runtime is waiting for.
  const last = messages.at(-1);
  const results = last?.role === 'user' ? blocksOf(last).filter((b) => b.type === 'tool_result') : [];
  const conv = results.length && conversations.get(results[0].tool_use_id);
  if (conv && !conv.closed) {
    clearTimeout(conv.abandonTimer);
    for (const b of results) { conv.answer(b.tool_use_id, b); conversations.delete(b.tool_use_id); }
    touch();
    return run(conv);
  }

  const release = await acquireSlot('copilot', 'GitHub Copilot', { onWait });
  let cl;
  try { cl = await client(secret); } catch (e) { release(); throw friendlyError(e); }
  const toolNames = new Map(); // SDK-safe name -> our name
  const sdkTools = tools.map((t) => {
    let safe = TOOL_NAME_RE.test(t.name) ? t.name : t.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    while (toolNames.has(safe)) safe += '_';
    toolNames.set(safe, t.name);
    return { name: safe, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} }, skipPermission: true, defer: 'never' };
  });
  // eslint-disable-next-line prefer-const -- assigned after the session exists; used by the tool handlers above
  let c;
  const session = await cl.createSession({
    model,
    systemMessage: { mode: 'replace', content: system || 'You are a helpful assistant.' },
    tools: sdkTools.map((t) => ({ ...t, handler: (args, inv) => c.toolCall(t.name, args, inv) })),
    availableTools: sdkTools.length ? ['custom:*'] : [],
    includedBuiltinAgents: [],
    infiniteSessions: { enabled: false },
    enableSessionStore: false,
    onPermissionRequest: cl.approveAll || (() => ({ kind: 'approved' })),
  }).catch((e) => { release(); throw friendlyError(e); });
  c = new Conversation(session, cl, toolNames, secret);
  c.release = release;
  const done = run(c);
  try { await session.send({ prompt: toPrompt(messages) }); } catch (e) { c.close(); c.finish({ error: e }); }
  return done;
}

/** Adapter for one Copilot account (042). */
export const copilotAdapter = (secret = SECRET) => ({
  configured: () => configured(secret),
  listModels: () => listModelsFor(secret),
  chat: (args) => chatFor(secret, args),
});
export const listModels = () => listModelsFor(SECRET);
export const chat = (args) => chatFor(SECRET, args);
