// @ts-check
// Panel routes: pending confirmations, secrets, usage & prices, server metrics & maintenance, channels and WhatsApp
// numbers, restart.
import { getAgent, listAgents } from '../../core/agents.js';
import { restartSoon } from '../../core/config.js';
import { healthView, setRetention } from '../../core/retention.js';
import { dropPending, listPending, takePending } from '../../core/db.js';
import { activity } from '../../core/events.js';
import { withChatNames } from '../../core/chat-names.js';
import { globalServers } from '../../core/global-mcp.js';
import { applyPending } from '../../core/runner.js';
import { referencedSecrets } from '../../core/schema.js';
import { getSetting, listSecrets, setSecret, updateSettings } from '../../core/store.js';
import { logs as sysLogs, metricsHistory, opsStatus, osUpdates, requestOp, snapshot as sysSnapshot } from '../../core/system.js';
import { PLAN_PROVIDERS, listPrices, setPrice, usageReport } from '../../core/usage.js';

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function systemRoutes(route, { channel } = {}) {
  // ---------- pending ----------
  route('GET', '/api/pending', async () => withChatNames(listPending(), channel)); // 073: chat names, never ids
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
  route('GET', '/api/usage', async (req, res, body, q) => {
    const groupBy = q.get('groupBy') || 'agent';
    const r = usageReport({ from: periodFrom(q.get('period')), groupBy, agent: q.get('agent') || '', chat: q.get('chat') || '' });
    return groupBy === 'chat' ? { ...r, rows: await withChatNames(r.rows, channel, 'key') } : r; // 073: chat names, never ids
  });
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

  // ---------- channels (075): which channels exist, on/off (off = connections closed, adapter dropped) ----------
  route('GET', '/api/channels', async () => channel.channels());
  route('PUT', '/api/channels/:id', async (req, res, body, q, p, user) => channel.setEnabled(p.id, !!body.enabled, user.username), { role: 'owner' });
  // ---------- WhatsApp ----------
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
      const list = (getSetting('whatsappNumbers', null) || [{ id: 'main', label: 'Main' }]).map((n) => (n.id === p.id ? { ...n, dmAgent: String(body.dmAgent || '') } : n));
      updateSettings({ whatsappNumbers: list });
    }
    if (body.label) await channel.renameNumber?.(p.id, body.label);
    return { ok: true };
  });
  route('DELETE', '/api/whatsapp/numbers/:id', async (req, res, body, q, p) => channel.removeNumber(p.id), { role: 'owner' });

  // ---------- system ----------
  // 069: Server → Health: database size, oldest kept data, retention, last clean-up, disk, queue, clock
  route('GET', '/api/server/health', async () => ({ ...healthView(), channels: await channel.channels() })); // 075: memory per channel
  route('PUT', '/api/server/retention', async (req, res, body, q, p, user) => {
    const next = setRetention(body);
    activity('config', { summary: `Keep stored messages ${next.messagesDays} days (at most ${next.messagesPerChat} per chat), usage detail ${next.usageDays} days (${user.username})` });
    return { ...healthView(), channels: await channel.channels() };
  }, { role: 'owner' });
  route('POST', '/api/system/restart', async () => { restartSoon(300); return { ok: true }; }, { role: 'owner' });
}
