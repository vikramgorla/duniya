import http from 'node:http';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { env, ROOT, DATA_DIR } from '../core/config.js';
import {
  listSecrets, setSecret, getSettings, updateSettings, interpolate, countUsers, createUser, listUsers, updateUser,
  deleteUser, authenticate, sessionUser, deleteSession, getUser,
} from '../core/store.js';
import {
  listAgents, getAgent, agentView, createAgent, updateAgent, deleteAgent, bindChat, loadAgents, agentForChat,
  listTemplates, templateConfig, exportAgent, importAgent, listPlugins,
} from '../core/agents.js';
import { referencedSecrets } from '../core/schema.js';
import { listActivity, listPending, dropPending, takePending, deleteNote, getNote, namesInChat, listMessages, listNotes } from '../core/db.js';
import { bus, activity, loggingSettings, resetLoggingCache, LOG_CATEGORIES } from '../core/events.js';
import { allChatPrefs, setChatPrefs, seenChats, ignoredCounts, enabledChats, isChatEnabled } from '../core/chat-prefs.js';
import { runAgent, handleConfirmCommand, applyPending } from '../core/runner.js';
import { runSchedule } from '../core/scheduler.js';
import { resetMcpPool, mcpConnection } from '../core/mcp.js';
import { listContacts, saveContact, removeContact, getContact } from '../core/contacts.js';
import { memoryView, maybeSummarize, eraseChatMemory } from '../core/memory.js';
import { humanCode } from '../core/crypto.js';
import { organizerConnection, oauthClientOf } from '../core/tools.js';
import { draftAgent } from '../core/ai-builder.js';
import { setWhatsAppChannel, whatsappToolCatalog, isGroupChat } from '../core/whatsapp-tools.js';
import { usageReport, listPrices, setPrice, PLAN_PROVIDERS } from '../core/usage.js';
import { installPackage, installedInfo } from '../core/mcp-local.js';
import { snapshot as sysSnapshot, metricsHistory, osUpdates, logs as sysLogs, opsStatus, requestOp } from '../core/system.js';

// Local tool services run third-party code on this server: only owners may add or change them.
const localSig = (cfg) => JSON.stringify(Object.entries(cfg?.mcpServers || {}).filter(([, v]) => v?.type === 'local')
  .map(([k, v]) => [k, String(v.package || '').trim(), v.args || [], v.env || {}, !!v.allowScripts]).sort());
function guardLocal(user, before, after) {
  if (user?.role !== 'owner' && localSig(after) !== localSig(before)) {
    throw Object.assign(new Error('Only the owner can add or change local tool services (they run code on this server)'), { status: 403 });
  }
}
import {
  CSP, clientIp, isHttps, cookie, send, setSessionCookie, limiter, uploadAllowed, setSetupCode, checkSetupCode,
} from './http.js';
import { googleRoutes, googleReady } from './routes/google.js';
import { webRoutes } from './routes/web.js';
import { domainCheckResponse } from '../core/webaccess.js';
import { passwordLoginAllowed } from '../core/google-signin.js';
import { createAdminMcp } from './admin-mcp.js';
import { validateAccess } from '../core/admin-oauth.js';
import { baseUrl, minuteLimiter } from './http-util.js';
import { mobileRoutes } from './routes/mobile.js';
import { toolServiceRoutes } from './routes/tool-services.js';
import { ownerAlertRoutes } from './routes/owner-alerts.js';
import { mediaRoutes } from './routes/media.js';
import { serverSize } from '../core/resources.js';
import { queueStats } from '../core/media-queue.js';
import { insightRoutes } from './routes/insights.js';
import { ownerAssistantRoutes } from './routes/owner-assistant.js';
import { setOwnerToolRunner } from '../core/owner-assistant.js';
import { maybePostNotice, setChatNoticeOff, noticePostedAt } from '../core/privacy-notice.js';
import { TOOLS as ADMIN_TOOLS } from './admin-tools.js';
import { globalServers } from '../core/global-mcp.js';
import { probeServer, startSignIn, finishSignIn, listConnections, disconnect as disconnectOAuth, OAUTH_ROLES, GLOBAL_SCOPE } from '../core/mcp-oauth.js';

const PUBLIC = resolve(import.meta.dirname, 'public');
const startedAt = Date.now();
const ROLE_RANK = { viewer: 1, admin: 2, owner: 3 };
const SETUP_FILE = resolve(DATA_DIR, 'setup-code.txt');

// ---------- first owner ----------
export function bootstrapAuth() {
  if (countUsers() > 0) { rmSync(SETUP_FILE, { force: true }); return; }
  if (env.adminPassword) {
    try {
      createUser({ username: 'admin', role: 'owner', password: env.adminPassword });
      activity('system', { summary: 'Owner "admin" created from ADMIN_PASSWORD' });
      return;
    } catch (e) {
      console.error(`ADMIN_PASSWORD not usable (${e.message}); falling back to a setup code`);
    }
  }
  // Create the code file only if it does not exist yet ('wx'), then read whatever is there (no check-then-write race).
  try { writeFileSync(SETUP_FILE, humanCode(10), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const setupCode = readFileSync(SETUP_FILE, 'utf8').trim();
  setSetupCode(setupCode);
  console.log(`\n  First-run setup code: ${setupCode}\n  Open the admin panel and enter it to create the owner account.\n`);
}

// ---------- helpers ----------
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 2e6) throw new Error('Body too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
const PKG_VERSION = (() => { try { return `v${JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version}`; } catch { return ''; } })();
const gitVersion = () => new Promise((r) => execFile('git', ['log', '-1', '--format=%h'], { cwd: ROOT }, (e, out) => r([PKG_VERSION, e ? '' : out.trim()].filter(Boolean).join(' · ') || 'unknown')));
const loginLimit = limiter(5);
const rateLimitLogin = (ip) => loginLimit(ip);

// ---------- who is calling: session cookie (panel) or OAuth bearer token (mobile app, 027) ----------
// A bearer token must be one issued for this server's /api resource (not the admin MCP's /mcp); it acts as the panel
// user who approved it, with that user's current role. When an Authorization header is sent, only the token counts.
const bearerOf = (req) => (/^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization || '')) || [])[1];
const bearerLimit = minuteLimiter(300);
export function requestUser(req) {
  const token = bearerOf(req);
  if (token) {
    const a = validateAccess(token, `${baseUrl(req)}/api`);
    const user = a && getUser(a.user.id);
    return user ? { user, via: 'bearer', client: a.client, tokenHash: a.tokenHash } : { invalid: true, via: 'bearer' };
  }
  const user = sessionUser(cookie(req, 'duniya_session'));
  return user ? { user, via: 'session' } : { via: 'none' };
}

export function startPanel({ channel, extend = [] }) {
  bootstrapAuth();
  setWhatsAppChannel(channel);
  const routes = [];
  /** opts.role: minimum role (default: viewer for GET, admin otherwise). opts.public: no auth. */
  /** opts.raw: the handler reads the (binary) request body itself; see uploadAllowed() for the CSRF guard. */
  /** opts.bearer: false = panel session only (not the mobile app's token); raw uploads are always session only. */
  const route = (method, pattern, handler, opts = {}) => routes.push({
    method, handler, public: !!opts.public, raw: !!opts.raw, bearer: opts.bearer !== false && !opts.raw,
    role: opts.role || (method === 'GET' ? 'viewer' : 'admin'),
    re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  });

  // ---------- session / setup ----------
  route('GET', '/api/session', async (req) => {
    const { user = null } = requestUser(req);
    return { authed: !!user, user, needsSetup: countUsers() === 0, google: googleReady(), passwordLogin: passwordLoginAllowed() };
  }, { public: true });
  route('POST', '/api/setup', async (req, res, body) => {
    if (countUsers() > 0) return [409, { error: 'Already set up' }];
    if (rateLimitLogin(clientIp(req))) return [429, { error: 'Too many attempts, wait a minute' }];
    if (!checkSetupCode(body.code)) return [403, { error: 'Wrong setup code (see the server log or installer output)' }];
    const user = createUser({ username: body.username || 'admin', email: body.email, role: 'owner', password: body.password });
    rmSync(SETUP_FILE, { force: true }); setSetupCode(null);
    activity('system', { summary: `Owner "${user.username}" created via setup` });
    setSessionCookie(req, res, user.id);
    return { ok: true, user };
  }, { public: true });
  route('POST', '/api/login', async (req, res, body) => {
    const ip = clientIp(req);
    if (rateLimitLogin(ip)) return [429, { error: 'Too many attempts, wait a minute' }];
    if (!passwordLoginAllowed()) { activity('system', { summary: `Password sign-in refused for "${body.username || 'admin'}" from ${ip} (only Google allowed)` }); return [403, { error: 'Password sign-in is switched off. Use Sign in with Google.' }]; }
    const user = authenticate(body.username || 'admin', String(body.password || ''));
    if (!user) { activity('system', { summary: `Panel login failed for "${body.username || 'admin'}" from ${ip}` }); return [401, { error: 'Wrong username or password' }]; }
    setSessionCookie(req, res, user.id);
    activity('system', { summary: `Panel login: ${user.username} from ${ip}` });
    return { ok: true, user };
  }, { public: true });
  route('POST', '/api/logout', async (req, res) => {
    deleteSession(cookie(req, 'duniya_session'));
    res.setHeader('set-cookie', 'duniya_session=; Path=/; Max-Age=0');
    return { ok: true };
  }, { role: 'viewer' });
  route('POST', '/api/password', async (req, res, body, q, p, user) => {
    // Accounts created from a Google invite have no password yet: they may set one (a fallback if Google is off).
    if (user.hasPassword && !authenticate(user.username, String(body.current || ''))) return [400, { error: 'Current password is wrong' }];
    updateUser(user.id, { password: String(body.next || '') });
    activity('system', { summary: `Password changed: ${user.username}` });
    return { ok: true };
  }, { role: 'viewer', bearer: false });

  // ---------- Sign in with Google, invites (019) ----------
  googleRoutes(route);
  webRoutes(route); // web address & access (031)

  // ---------- users (owner) ----------
  route('GET', '/api/users', async () => listUsers(), { role: 'owner' });
  route('POST', '/api/users', async (req, res, body, q, p, user) => {
    if (!passwordLoginAllowed()) return [400, { error: 'Password sign-in is switched off: invite this person with Google instead (Users → Invite).' }];
    const u = createUser(body); activity('system', { summary: `User ${u.username} (${u.role}) added by ${user.username}` }); return u;
  }, { role: 'owner' });
  route('PUT', '/api/users/:id', async (req, res, body, q, p, user) => {
    const u = updateUser(p.id, body); activity('system', { summary: `User ${u.username} updated by ${user.username}` }); return u;
  }, { role: 'owner' });
  route('DELETE', '/api/users/:id', async (req, res, body, q, p, user) => {
    deleteUser(p.id); activity('system', { summary: `User #${p.id} removed by ${user.username}` }); return { ok: true };
  }, { role: 'owner' });

  // ---------- overview ----------
  route('GET', '/api/status', async (req, res, body, q, p, user) => ({
    user, enabledChats: enabledChats().length,
    channel: await channel.status(),
    settings: getSettings(),
    version: await gitVersion(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    server: serverSize(), // small-server guardrails (043): size class, RAM, free memory, CPUs
    mediaQueue: queueStats(),
    node: process.version,
    agents: listAgents().map((b) => ({ id: b.id, name: b.name, enabled: b.enabled, chats: b.chats.length })),
    pending: listPending().length,
  }));
  route('POST', '/api/settings', async (req, res, body, q, p, user) => {
    const patch = {};
    if ('paused' in body) patch.paused = !!body.paused;
    if ('defaultDmAgent' in body) patch.defaultDmAgent = String(body.defaultDmAgent || '');
    activity('system', { summary: `Settings by ${user.username}: ${JSON.stringify(patch)}` });
    return updateSettings(patch);
  });

  // ---------- activity ----------
  route('GET', '/api/activity', async (req, res, body, q) => listActivity({ limit: q.get('limit'), agent: q.get('agent') || '', chat: q.get('chat') || '', before: Number(q.get('before') || 0) }));
  route('GET', '/api/events', async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    const onAct = (a) => res.write(`data: ${JSON.stringify(a)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    bus.on('activity', onAct);
    req.on('close', () => { bus.off('activity', onAct); clearInterval(ping); });
    return null;
  });

  // ---------- agents ----------
  route('GET', '/api/templates', async () => listTemplates());
  route('GET', '/api/plugins', async () => listPlugins());
  route('GET', '/api/agents', async () => listAgents().map(agentView));
  route('POST', '/api/agents', async (req, res, body, q, p, user) => {
    const base = body.template ? templateConfig(body.template) : {};
    guardLocal(user, {}, { ...base, ...(body.config || {}) });
    const { agent, warnings } = await createAgent({ id: body.id, config: { ...base, ...(body.config || {}) }, by: user.username });
    return [201, { ...agentView(agent), warnings }];
  });
  route('POST', '/api/agents/import', async (req, res, body, q, p, user) => {
    guardLocal(user, {}, body?.config);
    const { agent, warnings } = await importAgent(body, user.username);
    return [201, { ...agentView(agent), warnings }];
  });
  route('POST', '/api/agents/reload', async () => { await loadAgents(); await resetMcpPool(); activity('system', { summary: 'Agents reloaded' }); return listAgents().map(agentView); });
  route('GET', '/api/agents/:id', async (req, res, body, q, p) => { const b = getAgent(p.id); return b ? agentView(b) : [404, { error: 'Not found' }]; });
  route('PUT', '/api/agents/:id', async (req, res, body, q, p, user) => {
    const before = getAgent(p.id);
    if (body.mcpServers !== undefined) guardLocal(user, before, body);
    const { agent, warnings } = await updateAgent(p.id, body, user.username);
    return { ...agentView(agent), warnings };
  });
  route('DELETE', '/api/agents/:id', async (req, res, body, q, p, user) => { deleteAgent(p.id, user.username); return { ok: true }; });
  route('POST', '/api/agents/:id/duplicate', async (req, res, body, q, p, user) => {
    const src = getAgent(p.id);
    if (!src) return [404, { error: 'Not found' }];
    const { hooks, id, updatedAt, ...config } = src;
    guardLocal(user, {}, config);
    const { agent } = await createAgent({ id: body.id, config: { ...config, name: `${config.name} (copy)`, chats: [] }, by: user.username });
    return [201, agentView(agent)];
  });
  route('GET', '/api/agents/:id/export', async (req, res, body, q, p) => {
    const doc = exportAgent(p.id);
    send(res, 200, JSON.stringify(doc, null, 2), { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${p.id}.agent.json"` });
    return null;
  });
  // ---------- people & roles (015) ----------
  // Members of the agent's groups with their role. When no organizers are set yet, WhatsApp group admins are suggested.
  route('GET', '/api/agents/:id/people', async (req, res, body, q, p) => {
    const agent = getAgent(p.id);
    if (!agent) return [404, { error: 'Not found' }];
    return peopleOf(agent);
  });
  // ---------- AI helper (016) ----------
  route('POST', '/api/ai/agent-draft', async (req, res, body, q, p, user) => {
    const agent = body.agentId ? getAgent(String(body.agentId)) : null;
    if (body.agentId && !agent) return [404, { error: 'Agent not found' }];
    const people = agent ? (await peopleOf(agent)).groups.flatMap((g) => g.members.filter((m) => m.phone).map((m) => ({ group: g.name, name: m.name, phone: m.phone, groupAdmin: m.admin }))) : [];
    try {
      const r = await draftAgent({ agent, request: body.request, model: String(body.model || 'auto'), people, by: user.username });
      return { ...r, names: Object.fromEntries(people.filter((x) => x.name).map((x) => [x.phone, x.name])) };
    } catch (e) {
      throw Object.assign(new Error(e.code === 'no_model' ? 'Connect a model provider first (Models).' : e.message), { status: e.status || 400 });
    }
  });
  async function peopleOf(agent) {
    const suggest = agent.organizers.length === 0;
    const groups = [];
    for (const chat of agent.chats.filter((c) => !/@(s\.whatsapp\.net|lid)$/.test(c))) {
      let members = []; let error = '';
      try { members = await channel.groupMembers?.(chat) || []; } catch (e) { error = e.message; }
      const names = namesInChat(chat);
      groups.push({
        chat, name: (await channel.chatName?.(chat).catch(() => '')) || chat, error,
        members: members.map((m) => ({
          phone: m.phone, admin: m.admin, name: names[m.phone] || '',
          role: m.phone && agent.organizers.includes(m.phone) ? 'organizer' : suggest && m.admin && m.phone ? 'organizer' : 'participant',
          suggested: suggest && m.admin && !!m.phone,
        })).sort((a, b) => (b.admin - a.admin) || (a.name || a.phone).localeCompare(b.name || b.phone)),
      });
    }
    return { suggested: suggest, organizers: agent.organizers, participants: agent.participants, groups };
  }

  // ---------- tool service sign-in (009) ----------
  route('POST', '/api/agents/:id/probe', async (req, res, body) => {
    const url = interpolate(String(body.url || '')).trim();
    if (!url) return [400, { error: 'Enter the tool service URL first' }];
    return probeServer(url);
  });
  route('GET', '/api/agents/:id/local', async (req, res, body, q, p) => {
    const agent = getAgent(p.id);
    if (!agent) return [404, { error: 'Not found' }];
    return Object.entries(agent.mcpServers || {}).filter(([, v]) => v.type === 'local').map(([server, v]) => {
      const i = installedInfo(v.package, v.allowScripts);
      return { server, package: v.package, installed: i ? { name: i.name, version: i.version, at: i.at } : null };
    });
  });
  route('POST', '/api/agents/:id/local/:server/install', async (req, res, body, q, p, user) => {
    const srv = getAgent(p.id)?.mcpServers?.[p.server];
    if (!srv || srv.type !== 'local') return [404, { error: 'Save the agent with this local tool service first' }];
    const i = await installPackage(srv.package, { allowScripts: srv.allowScripts, fresh: !!body.fresh, by: user.username });
    await resetMcpPool();
    return { name: i.name, version: i.version, at: i.at };
  }, { role: 'owner' });
  route('GET', '/api/agents/:id/connections', async (req, res, body, q, p) => listConnections(p.id));
  route('POST', '/api/agents/:id/connections/:server/:role', async (req, res, body, q, p, user) => {
    const agent = getAgent(p.id);
    const srv = agent?.mcpServers?.[p.server];
    if (!srv) return [404, { error: 'Save the agent with this tool service first' }];
    if (srv.auth !== 'oauth') return [400, { error: 'This tool service is not set to Sign in' }];
    if (!OAUTH_ROLES.includes(p.role)) return [400, { error: 'Unknown role' }];
    const url = interpolate(srv.url);
    if (!url) return [400, { error: 'The tool service URL is empty' }];
    const redirectUri = `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}/oauth/mcp/callback`;
    return startSignIn({ agentId: agent.id, server: p.server, role: p.role, url, redirectUri, by: user.username, client: oauthClientOf(interpolate(srv)) });
  });
  route('DELETE', '/api/agents/:id/connections/:server/:role', async (req, res, body, q, p, user) => {
    disconnectOAuth(p.id, p.server, p.role, user.username);
    return { ok: true };
  });
  // The browser comes back here from the service. SameSite=Strict means no session cookie on this cross-site
  // navigation: the single-use state proves the sign-in was started by an admin; the page then returns to the panel.
  route('GET', '/oauth/mcp/callback', async (req, res, body, q) => {
    let ok = true; let msg; let agentId;
    try {
      const r = await finishSignIn({ state: q.get('state'), code: q.get('code'), error: q.get('error'), errorDescription: q.get('error_description') });
      agentId = r.agentId; msg = `Connected ${r.server} for ${r.role}s.`;
    } catch (e) { ok = false; msg = e.message; agentId = e.agentId || ''; }
    const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const back = agentId === GLOBAL_SCOPE ? '/#settings' : agentId ? `/#agents/${encodeURIComponent(agentId)}` : '/';
    const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${ok ? 'Connected' : 'Sign-in failed'}</title>
<body style="font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f4f6f5;color:#14201b">
<div style="background:#fff;border:1px solid #e3e8e5;border-radius:16px;padding:28px;max-width:440px;text-align:center">
<div style="font-size:40px">${ok ? '✅' : '⚠️'}</div><h2 style="margin:8px 0">${ok ? 'Connected' : 'Sign-in did not complete'}</h2>
<p style="color:#5b6a63">${esc(msg)}</p><p><a href="${esc(back)}" id=b style="color:#128c7e;font-weight:600">Back to the panel</a></p></div>
${ok ? `<meta http-equiv=refresh content="1;url=${esc(back)}">` : ''}`;
    send(res, ok ? 200 : 400, html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP });
    return null;
  }, { public: true });

  route('POST', '/api/agents/:id/discover', async (req, res, body, q, p) => {
    let url; let token;
    if (body.auth === 'oauth' || body.type === 'local') {
      const agent = getAgent(p.id);
      const saved = agent?.mcpServers?.[body.server];
      if (!saved || (body.type === 'local' ? saved.type !== 'local' : saved.auth !== 'oauth')) {
        return [400, { error: body.type === 'local' ? 'Save the agent with this local tool service first' : 'Save the agent and connect the tool service first' }];
      }
      const tools = await organizerConnection(agent, body.server).listTools();
      return tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 300) }));
    }
    if (body.url) { url = interpolate(String(body.url)); token = interpolate(String(body.token || '')); } else {
      const agent = getAgent(p.id);
      const srv = agent?.mcpServers?.[body.server];
      if (!srv) return [404, { error: 'Unknown tool service' }];
      url = interpolate(srv.url); token = interpolate(srv.tokens?.organizer || '');
    }
    if (!url) return [400, { error: 'URL is empty (is its secret set?)' }];
    const headers = interpolate(body.headers && typeof body.headers === 'object' ? body.headers : {});
    const tools = await mcpConnection(url, { token, headers }).listTools();
    return tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 300) }));
  });
  route('POST', '/api/agents/:id/test', async (req, res, body, q, p) => {
    const agent = getAgent(p.id);
    if (!agent) return [404, { error: 'Not found' }];
    const role = body.role === 'organizer' ? 'organizer' : 'participant';
    // #37 "Test as…": a chat of this agent (its memory, type and model) or a new direct chat; never sent to WhatsApp.
    const pick = body.chat && body.chat !== 'new' ? String(body.chat) : '';
    if (pick && !agent.chats.includes(pick)) return [400, { error: 'Choose one of this agent’s chats, or a new direct chat', field: 'chat' }];
    const isGroup = pick ? isGroupChat(pick) : false;
    const chat = pick ? `panel:${p.id}:${pick}` : `panel:${p.id}`;
    const text = String(body.text || '').slice(0, 4000);
    const confirm = await handleConfirmCommand({ agent, text, role, chat });
    if (confirm !== undefined) return { reply: confirm };
    activity('message.in', { agent: agent.id, chat, summary: `Panel test (${role}${pick ? ` in ${pick}` : ''}): ${text}` });
    const ctx = { agent, role, chat, senderName: 'Panel admin', requester: 'panel', text, isGroup, source: 'panel',
      contextChat: pick, chatName: isGroup ? await channel.chatName?.(pick).catch(() => '') : '' };
    const reply = await runAgent(ctx);
    activity('message.out', { agent: agent.id, chat, summary: reply || '(no reply)' });
    return { reply, usage: ctx.usage, model: ctx.model, answeredBy: ctx.answeredBy || '', fallback: ctx.fallback || null, role, chat: pick || 'new', ...(pick ? { chatOn: isChatEnabled(pick) } : {}) };
  });
  route('POST', '/api/agents/:id/schedules/:sid/run', async (req, res, body, q, p) => {
    const agent = getAgent(p.id);
    const s = agent?.schedules.find((x) => x.id === decodeURIComponent(p.sid));
    if (!s) return [404, { error: 'Not found' }];
    return runSchedule(agent, s, channel, { force: true });
  });

  // ---------- chats + memory ----------
  route('GET', '/api/chats', async () => {
    const groups = (await channel.listChats()).map((c) => ({ ...c, isGroup: true }));
    const owner = new Map(listAgents().flatMap((b) => b.chats.map((c) => [c, b.id])));
    const prefs = allChatPrefs();
    const numbers = new Map(((await channel.status()).numbers || []).map((n) => [n.id, n.label]));
    const known = new Set(groups.map((c) => c.id));
    // 1:1 chats the numbers have seen (name and number only) and any bound chat we can't see right now
    const people = seenChats({ groups: false }).filter((c) => !known.has(c.id)).map((c) => ({ id: c.id, name: c.name || `+${c.phone}`, phone: c.phone, number: c.number, isGroup: false, lastAt: c.lastAt }));
    for (const c of people) known.add(c.id);
    const missing = [...owner.keys()].filter((c) => !known.has(c)).map((id) => ({ id, name: '(not a member / offline)', size: 0, isGroup: !/@(s\.whatsapp\.net|lid)$/.test(id) }));
    return [...groups, ...people, ...missing].map((c) => {
      const number = c.number || (c.id.includes('#') ? c.id.split('#')[0] : 'main');
      return { ...c, number, numberLabel: numbers.get(number) || number, agent: owner.get(c.id) || '', model: prefs[c.id]?.model || 'inherit', logging: prefs[c.id]?.logging || 'inherit',
        fallback: prefs[c.id]?.fallback || { mode: 'inherit', chain: [] }, enabled: !!prefs[c.id]?.enabled, ignored: ignoredCounts.get(c.id) || 0,
        private: !!prefs[c.id]?.private, noticeOff: !!prefs[c.id]?.noticeOff, noticePostedAt: c.isGroup ? noticePostedAt(c.id) : null };
    });
  });
  route('PUT', '/api/chats/:chat/prefs', async (req, res, body, q, p, user) => {
    const chat = decodeURIComponent(p.chat);
    const wasOn = isChatEnabled(chat);
    // 044: "private to members" and the privacy-notice opt-out are recorded like every chat setting.
    if (body.noticeOff !== undefined) setChatNoticeOff(chat, !!body.noticeOff, user.username);
    if (body.private !== undefined) {
      setChatPrefs(chat, { private: !!body.private });
      activity('config', { chat, summary: `Chat ${body.private ? 'marked private to members — hidden from the owner assistant' : 'no longer private to members'} (${user.username})` });
    }
    const out = setChatPrefs(chat, { model: body.model, logging: body.logging, enabled: body.enabled, fallback: body.fallback });
    if (body.enabled !== undefined) {
      ignoredCounts.delete(chat); activity('config', { chat, summary: `Chat switched ${out.enabled ? 'ON — agents may answer here' : 'OFF — agents ignore it'} (${user.username})` });
      if (out.enabled && !wasOn) await maybePostNotice(chat, channel); // privacy notice (044): groups only, once
    } else if (body.private !== undefined || body.noticeOff !== undefined) { /* recorded above */ } else activity('config', { chat, summary: `Chat settings: model ${out.model}, logging ${out.logging}, fallback ${out.fallback.mode}${out.fallback.chain.length ? ` (${out.fallback.chain.join(' → ')})` : ''} (${user.username})` });
    return out;
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
  route('POST', '/api/chats/bind', async (req, res, body, q, p, user) => { await bindChat(String(body.chat), body.agent || null, user.username); return { ok: true }; });
  // Stored messages of a chat (024): admins and owners only; each look is recorded.
  route('GET', '/api/chats/:chat/messages', async (req, res, body, q, p, user) => {
    const chat = decodeURIComponent(p.chat);
    const rows = listMessages(chat, { before: q.get('before'), limit: q.get('limit'), q: q.get('q') || '' });
    if (!q.get('before')) activity('config', { chat, summary: `Stored messages viewed by ${user.username}${q.get('q') ? ` (search “${String(q.get('q')).slice(0, 40)}”)` : ''}` });
    return rows;
  }, { role: 'admin' });
  // ---------- WhatsApp group tools for admins (026): same channel functions as the agents' whatsapp tools ----------
  route('GET', '/api/whatsapp/tools', async () => whatsappToolCatalog());
  const ADMIN_RANK = { superadmin: 2, admin: 1 };
  const waGroup = (p) => {
    const chat = decodeURIComponent(p.chat);
    if (!isGroupChat(chat)) throw Object.assign(new Error('This is not a WhatsApp group'), { status: 400 });
    if (typeof channel.groupInfo !== 'function') throw Object.assign(new Error('WhatsApp actions are not available'), { status: 501 });
    return chat;
  };
  const waLog = (chat, user, summary, detail) => activity('whatsapp.action', { agent: agentForChat(chat)?.id || '', chat, summary: `${summary} (panel, ${user.username})`, detail: { ...detail, by: user.username, source: 'panel' } });
  route('GET', '/api/chats/:chat/whatsapp', async (req, res, body, q, p) => {
    const chat = waGroup(p);
    const g = await channel.groupInfo(chat);
    const names = namesInChat(chat);
    return { ...g, participants: g.participants.map((m) => ({ ...m, name: names[m.phone] || '' }))
      .sort((a, b) => ((ADMIN_RANK[b.admin] || 0) - (ADMIN_RANK[a.admin] || 0)) || (a.name || a.phone || '~').localeCompare(b.name || b.phone || '~')) };
  }, { role: 'admin' });
  route('GET', '/api/chats/:chat/whatsapp/invite', async (req, res, body, q, p, user) => {
    const chat = waGroup(p);
    const r = await channel.groupInviteLink(chat);
    waLog(chat, user, 'Invite link viewed', { tool: 'group_invite_link' });
    return r;
  }, { role: 'admin' });
  route('POST', '/api/chats/:chat/whatsapp/invite/revoke', async (req, res, body, q, p, user) => {
    const chat = waGroup(p);
    const r = await channel.groupRevokeInvite(chat);
    waLog(chat, user, 'Invite link reset', { tool: 'revoke_invite_link' });
    return r;
  });
  route('PUT', '/api/chats/:chat/whatsapp', async (req, res, body, q, p, user) => {
    const chat = waGroup(p);
    const done = [];
    if (typeof body.subject === 'string') {
      if (!body.subject.trim()) return [400, { error: 'The group name cannot be empty', field: 'subject' }];
      await channel.groupSubject(chat, body.subject.trim()); done.push(`name “${body.subject.trim().slice(0, 60)}”`);
    }
    if (typeof body.description === 'string') { await channel.groupDescription(chat, body.description); done.push('description'); }
    const settings = Object.fromEntries(['announcement', 'locked', 'joinApproval'].filter((k) => typeof body[k] === 'boolean').map((k) => [k, body[k]]));
    if (Object.keys(settings).length) {
      await channel.groupSettings(chat, settings);
      const label = { announcement: 'only admins send', locked: 'only admins edit info', joinApproval: 'approve new members' };
      done.push(...Object.entries(settings).map(([k, v]) => `${label[k]} ${v ? 'on' : 'off'}`));
    }
    if (!done.length) return [400, { error: 'Nothing to change' }];
    waLog(chat, user, `Group updated: ${done.join(', ')}`, { tool: 'update_group', input: body });
    return { ok: true, changed: done };
  });
  route('GET', '/api/chats/:chat/memory', async (req, res, body, q, p) => memoryView(decodeURIComponent(p.chat)));
  route('POST', '/api/chats/:chat/memory/summarize', async (req, res, body, q, p) => {
    const chat = decodeURIComponent(p.chat);
    const summary = await maybeSummarize(chat, agentForChat(chat), { force: true });
    return { summary: summary ?? memoryView(chat).summary };
  });
  route('DELETE', '/api/chats/:chat/memory', async (req, res, body, q, p, user) => { eraseChatMemory(decodeURIComponent(p.chat), user.username); return { ok: true }; });
  // ---------- contacts (#11) ----------
  route('GET', '/api/contacts', async (req, res, body, q) => listContacts({ q: q.get('q') || '', sharedOnly: q.get('shared') === '1' }));
  route('PUT', '/api/contacts/:phone', async (req, res, body, q, p, user) => saveContact({ ...body, phone: decodeURIComponent(p.phone) }, user.username));
  route('DELETE', '/api/contacts/:phone', async (req, res, body, q, p, user) => {
    if (!getContact(decodeURIComponent(p.phone))) return [404, { error: 'Not found' }];
    removeContact(decodeURIComponent(p.phone), user.username);
    return { ok: true };
  });

  // Shared agent memory (#8): notes an agent keeps across all its chats.
  route('GET', '/api/agents/:id/memory', async (req, res, body, q, p) => {
    if (!getAgent(p.id)) return [404, { error: 'Not found' }];
    return { notes: listNotes(`agent:${p.id}`).map((n) => ({ id: n.id, text: n.text, author: n.author, role: n.role, ts: n.ts })) };
  });
  route('DELETE', '/api/notes/:id', async (req, res, body, q, p, user) => {
    const note = getNote(p.id);
    if (!note) return [404, { error: 'Not found' }];
    deleteNote(p.id);
    activity('memory.note.removed', { chat: note.chat, summary: `#${p.id} (panel, ${user.username})` });
    return { ok: true };
  });

  // ---------- pending ----------
  route('GET', '/api/pending', async () => listPending());
  route('DELETE', '/api/pending/:code', async (req, res, body, q, p, user) => {
    dropPending(p.code); activity('confirm.cancelled', { summary: `${p.code} (panel, ${user.username})` }); return { ok: true };
  });
  route('POST', '/api/pending/:code/apply', async (req, res, body, q, p) => {
    const row = takePending(p.code);
    if (!row) return [404, { error: 'Expired or not found' }];
    return { result: await applyPending(getAgent(row.agent), row) };
  });

  // ---------- secrets ----------
  route('GET', '/api/secrets', async () => {
    const stored = new Map(listSecrets().map((s) => [s.name, s.set]));
    const wanted = new Set(['ANTHROPIC_API_KEY']);
    for (const b of listAgents()) for (const s of referencedSecrets(b)) wanted.add(s);
    for (const s of referencedSecrets({ mcpServers: globalServers() })) wanted.add(s);
    return [...new Set([...stored.keys(), ...wanted])].sort().map((name) => ({
      name, set: !!stored.get(name) || !!process.env[name], usedByAgents: wanted.has(name),
    }));
  });
  route('PUT', '/api/secrets', async (req, res, body, q, p, user) => {
    setSecret(String(body.name || ''), String(body.value || ''));
    activity('system', { summary: `Secret ${body.value ? 'set' : 'removed'}: ${body.name} (by ${user.username})` });
    return { ok: true };
  });

  // ---------- usage & cost (023) ----------
  const periodFrom = (pr) => ({ '1d': Date.now() - 86400000, '7d': Date.now() - 7 * 86400000, '30d': Date.now() - 30 * 86400000, '90d': Date.now() - 90 * 86400000, all: 0 }[pr || '30d'] ?? Date.now() - 30 * 86400000);
  route('GET', '/api/usage', async (req, res, body, q) => usageReport({ from: periodFrom(q.get('period')), groupBy: q.get('groupBy') || 'agent', agent: q.get('agent') || '', chat: q.get('chat') || '' }));
  route('GET', '/api/usage/summary', async (req, res, body, q) => {
    const from = periodFrom(q.get('period'));
    const by = (g) => Object.fromEntries(usageReport({ from, groupBy: g }).rows.map((r) => [r.key, r]));
    return { period: q.get('period') || '30d', agent: by('agent'), chat: by('chat'), provider: by('provider'), account: by('account'), model: by('model'), prices: listPrices(), plans: PLAN_PROVIDERS };
  });
  route('PUT', '/api/usage/prices', async (req, res, body, q, p, user) => {
    const out = setPrice(String(body.model || ''), { input: body.input, output: body.output });
    activity('config', { summary: `Price for ${body.model}: ${out ? `$${out.in} in / $${out.out} out per 1M tokens` : 'removed'} (${user.username})` });
    return { model: body.model, price: out };
  });

  // ---------- server metrics & maintenance (011) ----------
  route('GET', '/api/system', async () => sysSnapshot());
  route('GET', '/api/system/history', async () => metricsHistory());
  route('GET', '/api/system/os-updates', async (req, res, body, q) => osUpdates({ refresh: q.get('refresh') === '1' }), { role: 'admin' });
  route('GET', '/api/system/logs', async (req, res, body, q) => sysLogs(q.get('unit') || 'whatsapp-agent-duniya', q.get('lines')), { role: 'admin' });
  route('GET', '/api/system/ops', async () => opsStatus(), { role: 'owner' });
  route('POST', '/api/system/ops', async (req, res, body, q, p, user) => requestOp(String(body.action || ''), user.username), { role: 'owner' });

  // ---------- channel control ----------
  route('POST', '/api/whatsapp/pair', async (req, res, body) => ({ code: await channel.pair(body.phone, body.number) }));
  route('POST', '/api/whatsapp/logout', async (req, res, body) => { await channel.logout(body.number); return { ok: true }; });
  route('POST', '/api/whatsapp/restart', async (req, res, body) => { await channel.restart(body.number); return { ok: true }; });
  // more numbers (012)
  route('POST', '/api/whatsapp/numbers', async (req, res, body) => {
    if (!channel.addNumber) return [400, { error: 'Not supported' }];
    return [201, await channel.addNumber({ id: body.id, label: body.label })];
  }, { role: 'owner' });
  route('PUT', '/api/whatsapp/numbers/:id', async (req, res, body, q, p) => {
    if (body.dmAgent !== undefined) {
      const list = (getSettings().whatsappNumbers || [{ id: 'main', label: 'Main' }]).map((n) => (n.id === p.id ? { ...n, dmAgent: String(body.dmAgent || '') } : n));
      updateSettings({ whatsappNumbers: list });
    }
    if (body.label) await channel.renameNumber?.(p.id, body.label);
    return { ok: true };
  });
  route('DELETE', '/api/whatsapp/numbers/:id', async (req, res, body, q, p) => channel.removeNumber(p.id), { role: 'owner' });

  // ---------- system ----------
  route('POST', '/api/system/restart', async () => { setTimeout(() => process.exit(0), 300); return { ok: true }; }, { role: 'owner' });

  // ---------- global tool services (035): Settings → Tool services ----------
  toolServiceRoutes(route);
  insightRoutes(route, { channel }); // silences (#34), first-run checklist (#36), test tools (#37)
  ownerAssistantRoutes(route, { channel }); // owner assistant, Ask box, privacy notice (044)

  // ---------- spending caps (040) and owner alerts / weekly summary (041) ----------
  ownerAlertRoutes(route, { channel });
  mediaRoutes(route); // photos & voice (043)

  // ---------- mobile app (027): Settings → Mobile app ----------
  mobileRoutes(route);

  // Other features (providers, backups, updates) add their routes with the same role gates.
  for (const fn of [].concat(extend)) fn(route, { channel });

  // ---------- admin MCP for AI assistants (017) ----------
  // Tools run these same route handlers in-process as the approving user, with the same role gates.
  const findRoute = (method, pathname) => routes.find((x) => x.method === method && x.re.test(pathname));
  const routeRole = (method, path) => {
    const r = findRoute(method, new URL(path, 'http://x').pathname);
    return r ? (r.public ? 'viewer' : r.role) : null; // null: that feature's routes are not mounted
  };
  async function invoke(user, method, path, body = {}, { host = '' } = {}) {
    const url = new URL(path, 'http://x');
    const r = findRoute(method, url.pathname);
    if (!r) throw Object.assign(new Error('Not found'), { status: 404 });
    if (!r.public && ROLE_RANK[user.role] < ROLE_RANK[r.role]) {
      throw Object.assign(new Error(user.role === 'viewer' ? 'Read-only account' : `Requires ${r.role} role`), { status: 403 });
    }
    const req = { method, url: path, headers: { host, 'content-type': 'application/json' }, socket: { remoteAddress: 'mcp' }, on() {} };
    const chunks = [];
    const res = {
      statusCode: 200, headersSent: false, setHeader() {}, on() {},
      writeHead(status) { this.statusCode = status; this.headersSent = true; return this; },
      write(c) { chunks.push(Buffer.from(c)); return true; },
      end(c) { if (c) chunks.push(Buffer.from(c)); },
    };
    let out = await r.handler(req, res, body ?? {}, url.searchParams, url.pathname.match(r.re).groups || {}, user);
    let status = 200;
    if (out === null) {
      status = res.statusCode;
      const text = Buffer.concat(chunks).toString('utf8');
      try { out = JSON.parse(text); } catch { out = text; }
    } else if (Array.isArray(out) && typeof out[0] === 'number' && out.length === 2) [status, out] = out;
    if (status >= 400) throw Object.assign(new Error(out?.error || `Failed (${status})`), { status });
    return out ?? { ok: true };
  }
  const adminMcp = createAdminMcp({ invoke, routeRole });
  setOwnerToolRunner({ invoke, routeRole, tools: ADMIN_TOOLS }); // the owner assistant runs the same tools in-process (044)
  adminMcp.panelRoutes(route);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, readFileSync(resolve(PUBLIC, 'index.html')), { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'x-frame-options': 'DENY' });
      }
      if (url.pathname === '/healthz') return send(res, 200, 'ok');
      // 036: domain reachability proof + Caddy's on-demand TLS "ask" (public, answers only one-time tokens).
      if (req.method === 'GET' && url.pathname.startsWith('/.well-known/duniya-check')) {
        const r = domainCheckResponse(url, req);
        return send(res, r.status, r.body, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      }
      if (req.method === 'GET' && (url.pathname === '/qr.js' || url.pathname === '/diff.js')) {
        return send(res, 200, readFileSync(resolve(PUBLIC, url.pathname.slice(1))), { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'max-age=3600' });
      }
      if (await adminMcp.handle(req, res, url)) return;
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Not found' });
      let user = null;
      if (!r.public) {
        const who = requestUser(req);
        if (who.via === 'bearer') {
          const meta = `${baseUrl(req)}/.well-known/oauth-protected-resource/api`;
          if (who.invalid) return send(res, 401, { error: 'Sign in again (the app\'s access expired or was revoked)' }, { 'www-authenticate': `Bearer resource_metadata="${meta}", error="invalid_token"`, 'cache-control': 'no-store' });
          if (!r.bearer) return send(res, 403, { error: 'Do this in the web panel' });
          if (bearerLimit(who.tokenHash)) return send(res, 429, { error: 'Too many requests, wait a moment' }, { 'retry-after': '20' });
        }
        user = who.user;
        if (!user) return send(res, 401, { error: 'Login required' });
        if (ROLE_RANK[user.role] < ROLE_RANK[r.role]) {
          return send(res, 403, { error: user.role === 'viewer' ? 'Read-only account' : `Requires ${r.role} role` });
        }
      }
      if (req.method !== 'GET' && r.raw) {
        if (!uploadAllowed(req)) return send(res, 415, { error: 'Uploads must come from the panel' });
      } else if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 415, { error: 'JSON required' }); // CSRF guard (with SameSite=Strict)
      }
      const body = req.method === 'GET' || r.raw ? {} : await readBody(req);
      const out = await r.handler(req, res, body, url.searchParams, url.pathname.match(r.re).groups || {}, user);
      if (out === null) return;
      if (Array.isArray(out) && typeof out[0] === 'number' && out.length === 2) return send(res, out[0], out[1]);
      return send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 400, { error: e.message, field: e.field, needsConfirm: e.needsConfirm, warnings: e.warnings, check: e.check });
    }
  });
  server.listen(env.panelPort, env.panelHost, () => {
    console.log(`Admin panel on http://${env.panelHost}:${env.panelPort}`);
  });
  return server;
}

