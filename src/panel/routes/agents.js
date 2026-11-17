// @ts-check
// Panel routes: agents (create, edit, import/export, AI draft, people, tool services and their sign-in, test console, schedules) and shared agent memory.
import { agentView, createAgent, deleteAgent, exportAgent, getAgent, importAgent, isBuiltin, listAgents, listTemplates, loadAgents, templateConfig, updateAgent } from '../../core/agents.js';
import { draftAgent } from '../../core/ai-builder.js';
import { isChatEnabled } from '../../core/chat-prefs.js';
import { chatLabels } from '../../core/chat-names.js';
import { personInfo } from '../../core/contacts.js';
import { digits, fail } from '../../core/config.js';
import { deleteNote, getNote, listNotes, namesInChat } from '../../core/db.js';
import { activity } from '../../core/events.js';
import { installPackage, installedInfo, localServiceCheck } from '../../core/mcp-local.js';
import { GLOBAL_SCOPE, OAUTH_ROLES, disconnect as disconnectOAuth, finishSignIn, listConnections, probeServer, startSignIn } from '../../core/mcp-oauth.js';
import { mcpConnection, resetMcpPool } from '../../core/mcp.js';
import { personView, tagsInChat } from '../../core/member-tags.js';
import { builtinAnswer, todayText } from '../../core/quick.js';
import { stripTriggers } from '../../core/router.js';
import { handleConfirmCommand, runAgent } from '../../core/runner.js';
import { listAnswers, rateAnswer, reviewCounts } from '../../core/review.js';
import { runSchedule } from '../../core/scheduler.js';
import { interpolate } from '../../core/store.js';
import { oauthClientOf, organizerConnection } from '../../core/tools.js';
import { isGroup as isGroupChat } from '../../channels/index.js';
import { isHttps, resultPage, send } from '../http.js';

// Local tool services run third-party code on this server: only owners may add or change them.
const localSig = (cfg) => JSON.stringify(Object.entries(cfg?.mcpServers || {}).filter(([, v]) => v?.type === 'local')
  .map(([k, v]) => [k, String(v.package || '').trim(), v.args || [], v.env || {}, !!v.allowScripts]).sort());
function guardLocal(user, before, after) {
  if (user?.role !== 'owner' && localSig(after) !== localSig(before)) {
    throw fail('Only the owner can add or change local tool services (they run code on this server)', 403);
  }
}

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function agentRoutes(route, { channel } = {}) {
  // ---------- agents ----------
  route('GET', '/api/templates', async () => listTemplates());
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
  route('GET', '/api/agents/:id', async (req, res, body, q, p) => { const b = getAgent(p.id); return b ? { ...agentView(b), ...(isBuiltin(p.id) ? {} : { review: reviewCounts(p.id) }) } : [404, { error: 'Not found' }]; });
  // 070: Review & teach. The agent's answers with the message that asked (admins, like stored messages; private chats
  // left out); the first page of a look is recorded in Activity. Ratings: 1, -1 or 0 (clear).
  route('GET', '/api/agents/:id/review', async (req, res, body, q, p, user) => {
    const b = getAgent(p.id);
    if (!b || isBuiltin(p.id)) return [404, { error: 'Not found' }];
    const rows = listAnswers(p.id, { before: q.get('before'), only: q.get('only') || '', limit: 21 });
    const names = await chatLabels(rows.map((r) => r.chat), channel);
    if (!q.get('before')) activity('config', { agent: p.id, summary: `Answers of ${b.name} reviewed by ${user.username}` });
    return {
      counts: reviewCounts(p.id), more: rows.length > 20,
      answers: rows.slice(0, 20).map(({ question: qn, ...r }) => ({ ...r, chatName: names.get(r.chat),
        question: qn && { text: qn.text, ts: qn.ts, name: personInfo({ phone: qn.sender, jid: qn.senderJid, fallbackName: qn.name }).label } })),
    };
  }, { role: 'admin' });
  route('PUT', '/api/agents/:id/review/:msg', async (req, res, body, q, p, user) => {
    if (!getAgent(p.id) || isBuiltin(p.id)) return [404, { error: 'Not found' }];
    return { ...rateAnswer(p.id, p.msg, body.rating, user.username), counts: reviewCounts(p.id) };
  }, { role: 'admin' });
  route('PUT', '/api/agents/:id', async (req, res, body, q, p, user) => {
    const before = getAgent(p.id);
    if (body.mcpServers !== undefined) guardLocal(user, before, body);
    // 059: where owner alerts go is the owner's choice (as under the old Settings → Owner alerts)
    if (body.alerts !== undefined && user.role !== 'owner' && digits(body.alerts?.to || '') !== (before?.alerts?.to || '')) return [403, { error: 'Only the owner can change where alerts go', field: 'alerts.to' }];
    const { agent, warnings } = await updateAgent(p.id, body, user.username);
    return { ...agentView(agent), warnings };
  });
  route('DELETE', '/api/agents/:id', async (req, res, body, q, p, user) => { deleteAgent(p.id, user.username); return { ok: true }; });
  route('POST', '/api/agents/:id/duplicate', async (req, res, body, q, p, user) => {
    const src = getAgent(p.id);
    if (!src) return [404, { error: 'Not found' }];
    const { id, updatedAt, ...config } = src;
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
      throw fail(e.code === 'no_model' ? 'Connect a model provider first (Models).' : e.message, e.status || 400);
    }
  });
  async function peopleOf(agent) {
    const suggest = agent.organizers.length === 0;
    const groups = [];
    for (const chat of agent.chats.filter(isGroupChat)) {
      let members = []; let error = '';
      try { members = await channel.groupMembers?.(chat) || []; } catch (e) { error = e.message; }
      const names = namesInChat(chat);
      const tags = tagsInChat(chat);
      groups.push({
        chat, name: (await chatLabels([chat], channel)).get(chat), error,
        members: members.map((m) => ({
          // 057: one resolver — own name > address book > business > profile > number; hidden numbers never as digits
          ...personView({ phone: m.phone, jid: m.jid, fallbackName: names[m.phone] }, chat, tags), admin: m.admin,
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
      return { server, package: v.package, blocked: localServiceCheck().reason || null, installed: i ? { name: i.name, version: i.version, at: i.at } : null };
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
    const back = agentId === GLOBAL_SCOPE ? '/#settings' : agentId ? `/#agents/${encodeURIComponent(agentId)}` : '/';
    return resultPage(res, { ok, title: ok ? 'Connected' : 'Sign-in did not complete', message: msg, back, autoMs: 1000 });
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
    if (isBuiltin(agent)) return [400, { error: 'Try the owner assistant in the Ask box on Overview or in your WhatsApp chat' }]; // 059
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
    const chatName = isGroup ? await channel.chatName?.(pick).catch(() => '') : '';
    // 054: the same built-in answers WhatsApp gets (quick reply, !help, FAQ); the console shows which path answered.
    const stripped = stripTriggers(agent, text);
    const built = builtinAnswer(agent, { texts: [text, stripped], question: stripped, role, faqAllowed: true,
      values: { name: 'Panel admin', group: chatName || (isGroup ? 'the group' : 'this chat'), date: todayText(agent.timezone) } });
    if (built) {
      activity('message.out', { agent: agent.id, chat, summary: `${built.text} (${built.label})` });
      return { reply: built.text, path: built.kind, answeredBy: built.label, role, chat: pick || 'new', ...(pick ? { chatOn: isChatEnabled(pick) } : {}) };
    }
    const ctx = { agent, role, chat, senderName: 'Panel admin', requester: 'panel', text, isGroup, source: 'panel',
      contextChat: pick, chatName };
    const reply = await runAgent(ctx);
    activity('message.out', { agent: agent.id, chat, summary: reply || '(no reply)' });
    return { reply, path: 'model', usage: ctx.usage, model: ctx.model, answeredBy: ctx.answeredBy || '', fallback: ctx.fallback || null, role, chat: pick || 'new', ...(pick ? { chatOn: isChatEnabled(pick) } : {}) };
  });
  route('POST', '/api/agents/:id/schedules/:sid/run', async (req, res, body, q, p) => {
    const agent = getAgent(p.id);
    const s = agent?.schedules.find((x) => x.id === decodeURIComponent(p.sid));
    if (!s) return [404, { error: 'Not found' }];
    return runSchedule(agent, s, channel, { force: true });
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
}
