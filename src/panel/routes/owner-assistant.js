// @ts-check
// Owner assistant (044): Settings → Owner assistant (link per signed-in user; 059: everything else is the built-in
// agent record, edited in the agent editor), the Ask box on Overview, and the
// privacy notice settings.
import {
  linkStatus, listLinks, startLink, confirmLink, unlink, ask, resolveConfirm, ownerHistory,
} from '../../core/owner-assistant.js';
import { noticeSettings, setNoticeSettings } from '../../core/privacy-notice.js';
import { OWNER_AGENT_ID } from '../../core/agents.js';
import { weeklyText, weeklyData } from '../../core/weekly.js';

export function ownerAssistantRoutes(route, { channel }) {
  const numbers = async () => (((await channel.status?.()) || {}).numbers || []).filter((n) => n.me)
    .map((n) => ({ id: n.id, label: n.label, phone: String(n.me).split(/[:@]/)[0] }));

  route('GET', '/api/owner-assistant', async (req, res, body, q, p, user) => ({
    agent: OWNER_AGENT_ID, link: linkStatus(user.id), role: user.role,
    sendTo: await numbers().catch(() => []),
    ...(user.role === 'owner' ? { links: listLinks() } : {}),
  }), { role: 'viewer' });
  // 059: the weekly summary as its schedule would send it now (counts and costs only); "Run now" sends it.
  route('GET', '/api/owner-assistant/weekly-preview', async () => ({ text: weeklyText(), data: weeklyData() }));
  route('POST', '/api/owner-assistant/link', async (req, res, body, q, p, user) => startLink(user), { role: 'viewer' });
  route('POST', '/api/owner-assistant/link/confirm', async (req, res, body, q, p, user) => confirmLink(user), { role: 'viewer' });
  route('DELETE', '/api/owner-assistant/link', async (req, res, body, q, p, user) => ({ ok: unlink(user.id, user.username) }), { role: 'viewer' });
  route('DELETE', '/api/owner-assistant/links/:userId', async (req, res, body, q, p, user) => {
    if (!unlink(Number(p.userId), user.username)) return [404, { error: 'Not linked' }];
    return { ok: true };
  }, { role: 'owner' });

  // Ask box (Overview): same assistant and tools, with the panel user's role. Changes need the Confirm button.
  route('POST', '/api/owner/ask', async (req, res, body, q, p, user) => ask({ user, text: body.question, source: 'panel', surface: 'panel' }), { role: 'viewer' });
  // #66: the same question, answered as a stream of newline-delimited JSON events (fetch + ReadableStream in the panel,
  // expo/fetch in the app): { type: 'step' | 'text' | 'done' | 'error' | 'ping', … }. POST + JSON keeps the CSRF guard;
  // application/x-ndjson is not compressed by the bundled Caddy config, so events are flushed as they come.
  route('POST', '/api/owner/ask/stream', async (req, res, body, q, p, user) => {
    if (!String(body.question || '').trim()) return [400, { error: 'Ask a question' }];
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' });
    const write = (e) => { if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(e)}\n`); };
    const ping = setInterval(() => write({ type: 'ping' }), 15000);
    try {
      const out = await ask({ user, text: body.question, source: 'panel', surface: 'panel', onEvent: write });
      write({ type: 'done', reply: out.reply, confirms: out.confirms });
    } catch (e) {
      write({ type: 'error', error: e.message || 'Something went wrong', status: e.status || 400 });
    } finally { clearInterval(ping); res.end(); }
    return null;
  }, { role: 'viewer' });
  route('POST', '/api/owner/ask/confirm', async (req, res, body, q, p, user) => {
    const out = await resolveConfirm({ user, code: body.code, cancel: !!body.cancel, surface: 'panel' });
    if (out === undefined) return [404, { error: 'This code is unknown or expired (10 minutes). Ask again.' }];
    return { reply: out };
  }, { role: 'viewer' });
  route('GET', '/api/owner/ask/history', async (req, res, body, q, p, user) => ownerHistory(user.id, 'panel', q.get('limit') || 20), { role: 'viewer' });

  // Privacy notice (posted once when a group is switched on; DMs see it once in the first reply).
  route('GET', '/api/privacy-notice', async () => noticeSettings(), { role: 'viewer' });
  route('PUT', '/api/privacy-notice', async (req, res, body, q, p, user) => setNoticeSettings(body, user.username), { role: 'admin' });
}
