// Panel routes for Web address & access (031, 036). Owner only.
import {
  webState, checkDomain, preview, addDomain, confirmSwitch, finishSwitch, cancelSwitch, setAccess, confirmAccess, revertAccess, refreshRanges,
} from '../../core/webaccess.js';
import { clientIp } from '../http.js';

const OWNER = { role: 'owner' };

export function webRoutes(route) {
  route('GET', '/api/web', async (req) => webState(req, { clientIp }), OWNER);
  route('POST', '/api/web/check', async (req, res, body) => checkDomain(body.domain), OWNER);
  route('POST', '/api/web/preview', async (req, res, body) => ({ caddyfile: await preview(body) }), OWNER);
  // Domain change in steps: add next to the current address → confirm from the new address → turn the old one off.
  route('POST', '/api/web/domain', async (req, res, body, q, p, user) => addDomain(body.domain, { user }), OWNER);
  route('POST', '/api/web/domain/confirm', async (req, res, body, q, p, user) => confirmSwitch(req, { user }), OWNER);
  route('POST', '/api/web/domain/finish', async (req, res, body, q, p, user) => finishSwitch({ user }), OWNER);
  route('POST', '/api/web/domain/cancel', async (req, res, body, q, p, user) => cancelSwitch({ user }), OWNER);
  // Access rules: stricter rules are a trial that must be confirmed through them.
  route('PUT', '/api/web/access', async (req, res, body, q, p, user) => setAccess(body, { user, ip: clientIp(req), req }), OWNER);
  route('POST', '/api/web/access/confirm', async (req, res, body, q, p, user) => confirmAccess(req, { user }), OWNER);
  route('POST', '/api/web/access/undo', async (req, res, body, q, p, user) => ({ ok: revertAccess(`undone by ${user.username}`) }), OWNER);
  route('POST', '/api/web/ranges/refresh', async (req, res, body) => refreshRanges(String(body.provider || '')), OWNER);
}
