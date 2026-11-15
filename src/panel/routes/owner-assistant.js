// Owner assistant (044): Settings → Owner assistant (link per signed-in user, model), the Ask box on Overview, and the
// privacy notice settings.
import {
  ownerSettings, setOwnerSettings, linkStatus, listLinks, startLink, confirmLink, unlink, ask, resolveConfirm, ownerHistory,
} from '../../core/owner-assistant.js';
import { noticeSettings, setNoticeSettings } from '../../core/privacy-notice.js';

export function ownerAssistantRoutes(route, { channel }) {
  const numbers = async () => (((await channel.status?.()) || {}).numbers || []).filter((n) => n.me)
    .map((n) => ({ id: n.id, label: n.label, phone: String(n.me).split(/[:@]/)[0] }));

  route('GET', '/api/owner-assistant', async (req, res, body, q, p, user) => ({
    settings: ownerSettings(), link: linkStatus(user.id), role: user.role,
    sendTo: await numbers().catch(() => []),
    ...(user.role === 'owner' ? { links: listLinks() } : {}),
  }), { role: 'viewer' });
  route('POST', '/api/owner-assistant/link', async (req, res, body, q, p, user) => startLink(user), { role: 'viewer', bearer: false });
  route('POST', '/api/owner-assistant/link/confirm', async (req, res, body, q, p, user) => confirmLink(user), { role: 'viewer', bearer: false });
  route('DELETE', '/api/owner-assistant/link', async (req, res, body, q, p, user) => ({ ok: unlink(user.id, user.username) }), { role: 'viewer' });
  route('DELETE', '/api/owner-assistant/links/:userId', async (req, res, body, q, p, user) => {
    if (!unlink(Number(p.userId), user.username)) return [404, { error: 'Not linked' }];
    return { ok: true };
  }, { role: 'owner' });
  route('PUT', '/api/owner-assistant/settings', async (req, res, body, q, p, user) => setOwnerSettings({ model: body.model }, user.username), { role: 'admin' });

  // Ask box (Overview, mobile app): same assistant and tools, with the panel user's role. Changes need the Confirm button.
  route('POST', '/api/owner/ask', async (req, res, body, q, p, user) => ask({ user, text: body.question, source: 'panel', surface: 'panel' }), { role: 'viewer' });
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
