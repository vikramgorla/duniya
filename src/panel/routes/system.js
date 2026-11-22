// @ts-check
// Panel routes: pending confirmations, secrets, usage & prices, server metrics & maintenance, channels and WhatsApp
// numbers, restart.
import { getAgent, listAgents } from '../../core/agents.js';
import { restartSoon } from '../../core/config.js';
import { healthView, setRetention } from '../../core/retention.js';
import { dropPending, listPending, takePending } from '../../core/db.js';
import { activity, bus } from '../../core/events.js';
import { withChatNames } from '../../core/chat-names.js';
import { globalServers } from '../../core/global-mcp.js';
import { applyPending } from '../../core/runner.js';
import { referencedSecrets } from '../../core/schema.js';
import { CHANNELS } from '../../channels/index.js';
import { getSetting, listSecrets, setSecret, updateSettings } from '../../core/store.js';
import { logs as sysLogs, metricsHistory, opsStatus, osUpdates, requestOp, snapshot as sysSnapshot } from '../../core/system.js';
import { PLAN_PROVIDERS, listPrices, setPrice, smartReport, usageReport } from '../../core/usage.js';

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function systemRoutes(route, { channel } = {}) {
  // ---------- pending ----------
  route('GET', '/api/pending', async () => withChatNames(listPending())); // 073: chat names, never ids
  route('DELETE', '/api/pending/:code', async ({ params, user }) => {
    dropPending(params.code); activity('confirm.cancelled', { summary: `${params.code} (panel, ${user.username})` }); return { ok: true };
  });
  route('POST', '/api/pending/:code/apply', async ({ params }) => {
    const row = takePending(params.code);
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
  route('PUT', '/api/secrets', async ({ body, user }) => {
    const tokenOf = CHANNELS.find((c) => c.secret?.name === body.name)?.secret; // 077: a channel's token is checked before it is stored
    if (tokenOf && body.value && !tokenOf.pattern.test(String(body.value).trim())) return [400, { error: tokenOf.hint, field: 'value' }];
    setSecret(String(body.name || ''), String(body.value || '').trim());
    activity('system', { summary: `Secret ${body.value ? 'set' : 'removed'}: ${body.name} (by ${user.username})` });
    return { ok: true };
  });

  // ---------- usage & cost (023) ----------
  const periodFrom = (pr) => ({ '1d': Date.now() - 86400000, '7d': Date.now() - 7 * 86400000, '30d': Date.now() - 30 * 86400000, '90d': Date.now() - 90 * 86400000, all: 0 }[pr || '30d'] ?? Date.now() - 30 * 86400000);
  route('GET', '/api/usage', async ({ query }) => {
    const groupBy = query.get('groupBy') || 'agent';
    const r = usageReport({ from: periodFrom(query.get('period')), groupBy, agent: query.get('agent') || '', chat: query.get('chat') || '' });
    return groupBy === 'chat' ? { ...r, rows: withChatNames(r.rows, 'key') } : r; // 073: chat names, never ids
  });
  // 088: Smart model choice: answers per tier, cost per answer, and what the strong model alone would have cost
  route('GET', '/api/usage/smart', async ({ query }) => smartReport({ from: periodFrom(query.get('period')), agent: query.get('agent') || '' }));
  route('GET', '/api/usage/summary', async ({ query }) => {
    const from = periodFrom(query.get('period'));
    const by = (g) => Object.fromEntries(usageReport({ from, groupBy: g }).rows.map((r) => [r.key, r]));
    return { period: query.get('period') || '30d', agent: by('agent'), chat: by('chat'), provider: by('provider'), account: by('account'), model: by('model'), prices: listPrices(), plans: PLAN_PROVIDERS };
  });
  route('PUT', '/api/usage/prices', async ({ body, user }) => {
    const out = setPrice(String(body.model || ''), { input: body.input, output: body.output });
    activity('config', { summary: `Price for ${body.model}: ${out ? `$${out.in} in / $${out.out} out per 1M tokens` : 'removed'} (${user.username})` });
    return { model: body.model, price: out };
  });

  // ---------- server metrics & maintenance (011) ----------
  route('GET', '/api/system', async () => sysSnapshot());
  route('GET', '/api/system/history', async () => metricsHistory());
  route('GET', '/api/system/os-updates', async ({ query }) => osUpdates({ refresh: query.get('refresh') === '1' }), { role: 'admin' });
  route('GET', '/api/system/logs', async ({ query }) => sysLogs(query.get('unit') || 'whatsapp-agent-duniya', query.get('lines')), { role: 'admin' });
  route('GET', '/api/system/ops', async () => opsStatus(), { role: 'owner' });
  route('POST', '/api/system/ops', async ({ body, user }) => requestOp(String(body.action || ''), user.username), { role: 'owner' });

  // ---------- channels (075): which channels exist, on/off (off = connections closed, adapter dropped) ----------
  route('GET', '/api/channels', async () => channel.channels());
  // admins may switch a channel on (the first-run Link WhatsApp); only the owner switches one off
  route('PUT', '/api/channels/:id', async ({ body, params, user }) => {
    if (!body.enabled && user.role !== 'owner') return [403, { error: 'Only the owner can switch a channel off' }];
    return channel.setEnabled(params.id, !!body.enabled, user.username);
  }, { role: 'admin' });
  // 077: where the Telegram bot's direct messages go ('' = the default agent)
  route('PUT', '/api/channels/telegram/settings', async ({ body, user }) => {
    const dmAgent = String(body.dmAgent || '');
    if (dmAgent && !listAgents().some((a) => a.id === dmAgent)) return [400, { error: 'Unknown agent', field: 'dmAgent' }];
    updateSettings({ telegram: { ...getSetting('telegram', {}), dmAgent } });
    bus.emit('status');
    activity('config', { summary: `Telegram direct messages go to ${listAgents().find((a) => a.id === dmAgent)?.name || 'the default agent'} (${user.username})` });
    return { dmAgent };
  }, { role: 'admin' });
  // ---------- WhatsApp ----------
  route('POST', '/api/whatsapp/pair', async ({ body }) => ({ code: await channel.pair(body.phone, body.number) }));
  route('POST', '/api/whatsapp/logout', async ({ body }) => { await channel.logout(body.number); return { ok: true }; });
  route('POST', '/api/whatsapp/restart', async ({ body }) => { await channel.restart(body.number); return { ok: true }; });
  // more numbers (012)
  route('POST', '/api/whatsapp/numbers', async ({ body }) => {
    if (!channel.addNumber) return [400, { error: 'Not supported' }];
    return [201, await channel.addNumber({ id: body.id, label: body.label })];
  }, { role: 'owner' });
  route('PUT', '/api/whatsapp/numbers/:id', async ({ body, params }) => {
    if (body.dmAgent !== undefined) {
      const list = (getSetting('whatsappNumbers', null) || [{ id: 'main', label: 'Main' }]).map((n) => (n.id === params.id ? { ...n, dmAgent: String(body.dmAgent || '') } : n));
      updateSettings({ whatsappNumbers: list });
    }
    if (body.label) await channel.renameNumber?.(params.id, body.label);
    return { ok: true };
  });
  route('DELETE', '/api/whatsapp/numbers/:id', async ({ params }) => channel.removeNumber(params.id), { role: 'owner' });

  // ---------- system ----------
  // 069: Server → Health: database size, oldest kept data, retention, last clean-up, disk, queue, clock
  route('GET', '/api/server/health', async () => ({ ...healthView(), channels: await channel.channels() })); // 075: memory per channel
  route('PUT', '/api/server/retention', async ({ body, user }) => {
    const next = setRetention(body);
    activity('config', { summary: `Keep stored messages ${next.messagesDays} days (at most ${next.messagesPerChat} per chat), usage detail ${next.usageDays} days (${user.username})` });
    return { ...healthView(), channels: await channel.channels() };
  }, { role: 'owner' });
  route('POST', '/api/system/restart', async () => { restartSoon(300); return { ok: true }; }, { role: 'owner' });
}
