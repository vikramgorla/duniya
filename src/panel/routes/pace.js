// @ts-check
// Settings → Sending pace (080): read receipts, typing, gaps, the daily cap of new chats and sending hours (pace.js).
import { paceStatus, setPaceSettings } from '../../core/pace.js';

export function paceRoutes(route) {
  route('GET', '/api/pace', async () => paceStatus(), { role: 'viewer' });
  route('PUT', '/api/pace', async (req, res, body, q, p, user) => setPaceSettings(body, user.username), { role: 'admin' });
}
