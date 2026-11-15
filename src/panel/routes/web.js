// Panel routes for Web address & access (031). Owner only.
import { webState, checkDomain, buildRequest, applyWeb, refreshCloudflareRanges, requestViaCloudflare as viaCloudflare } from '../../core/webaccess.js';
import { clientIp } from '../http.js';

const OWNER = { role: 'owner' };

export function webRoutes(route) {
  route('GET', '/api/web', async (req) => webState(req, { clientIp }), OWNER);
  route('POST', '/api/web/check', async (req, res, body) => checkDomain(body.domain), OWNER);
  route('POST', '/api/web/preview', async (req, res, body, q, p, user) => {
    const { cfg, preview } = await buildRequest({ ...body, myIp: clientIp(req) }, { by: user.username });
    return { config: cfg, caddyfile: preview };
  }, OWNER);
  route('PUT', '/api/web', async (req, res, body, q, p, user) => applyWeb(body, { user, ip: clientIp(req), viaCloudflare: viaCloudflare(req) }), OWNER);
  route('POST', '/api/web/cloudflare/refresh', async () => {
    const r = await refreshCloudflareRanges();
    return { v4: r.v4.length, v6: r.v6.length, changed: r.changed };
  }, OWNER);
}
