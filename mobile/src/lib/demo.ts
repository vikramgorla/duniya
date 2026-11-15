// Demo data (027): "Look around first" on the Connect screen and the web export used for screenshots. Everything is
// made up and stays on the phone; changes are kept in memory until the app is closed.
import type { ApiClient } from './api-core';
import { ApiError } from './api-core';
import type { Activity, Bot, Chat, Pending, Status, StoredMessage } from './types';

const now = Date.now();
const min = 60_000;
const bots: Bot[] = [
  { id: 'carpool', name: 'Carpool helper', description: 'Plans who drives the kids to school and to football.', enabled: true, needs: [], localTools: [], missingPlugins: [], updatedAt: now - 3 * 86400_000,
    config: { name: 'Carpool helper', description: 'Plans who drives the kids to school and to football.', model: 'auto', enabled: true, triggers: ['!carpool', '@carpool'], dm: 'members',
      prompt: 'You coordinate the school carpool for four families in WhatsApp.\n\n- Keep a weekly plan of who drives when.\n- When someone cannot drive, ask the group who can swap.\n- Be brief and friendly; reply in English or French.',
      mcpServers: { calendar: { url: 'https://calendar.example.com/mcp', auth: 'oauth' } }, tools: { participant: ['calendar:list_*'], organizer: ['calendar:*'], deny: [] },
      organizers: ['41790000001', '41790000003'], chats: ['g2@g.us'], memory: { enabled: true },
      schedules: [{ id: 'monday-plan', at: '07:30', days: 'mon', enabled: true, prompt: 'Post this week’s driving plan.' }] } },
  { id: 'family', name: 'Family events', description: 'Birthdays, Diwali plans and the summer trip.', enabled: true, needs: [], localTools: [], missingPlugins: [], updatedAt: now - 86400_000,
    config: { name: 'Family events', description: 'Birthdays, Diwali plans and the summer trip.', model: 'anthropic:auto', enabled: true, triggers: ['!family'], dm: 'organizers',
      prompt: 'You help a big family plan get-togethers. Remember dates, who brings what, and remind people kindly.', tools: { participant: [], organizer: [], deny: [] }, organizers: ['41790000001'], chats: ['g1@g.us'], memory: { enabled: true } } },
  { id: 'neighbours', name: 'Neighbours', description: 'Building notices, parcels and the shared garden.', enabled: false, needs: [], localTools: [], missingPlugins: [], updatedAt: now - 9 * 86400_000,
    config: { name: 'Neighbours', description: 'Building notices, parcels and the shared garden.', model: 'auto', enabled: false, triggers: ['!house'], dm: 'off', prompt: 'You help neighbours in one building.', tools: { participant: [], organizer: [], deny: [] }, organizers: [], chats: [], memory: { enabled: false } } },
];
const chats: Chat[] = [
  { id: 'g1@g.us', name: 'Gorla family', size: 23, isGroup: true, number: 'main', numberLabel: 'Main', bot: 'family', model: 'inherit', logging: 'inherit' },
  { id: 'g2@g.us', name: 'School carpool', size: 8, isGroup: true, number: 'main', numberLabel: 'Main', bot: 'carpool', model: 'inherit', logging: 'inherit' },
  { id: 'g3@g.us', name: 'Building Rue du Midi', size: 31, isGroup: true, number: 'main', numberLabel: 'Main', bot: '', model: 'inherit', logging: 'inherit' },
  { id: '41790000003@s.whatsapp.net', name: 'Anu', isGroup: false, phone: '41790000003', number: 'main', numberLabel: 'Main', bot: '', model: 'inherit', logging: 'inherit', lastAt: now - 40 * min },
];
let pending: Pending[] = [
  { code: 'K7Q2', bot: 'carpool', tool: 'calendar:event_update', chat: 'g2@g.us', requester: 'Anu', summary: 'Move Thursday football pickup from 17:00 to 17:30 and make Rupa the driver', expires: now + 7 * min },
];
const acts: Activity[] = [
  { id: 9, ts: now - 2 * min, type: 'confirm.created', bot: 'carpool', chat: 'g2@g.us', summary: 'Waiting for an organizer: move Thursday pickup to 17:30 (K7Q2)' },
  { id: 8, ts: now - 3 * min, type: 'message.out', bot: 'carpool', chat: 'g2@g.us', summary: 'I can move Thursday’s pickup to 17:30 with Rupa driving. An organizer needs to confirm.' },
  { id: 7, ts: now - 3 * min, type: 'tool.call', bot: 'carpool', chat: 'g2@g.us', summary: 'calendar:event_update_preview · 412 ms' },
  { id: 6, ts: now - 4 * min, type: 'message.in', bot: 'carpool', chat: 'g2@g.us', summary: 'Anu: @carpool can we do 17:30 on Thursday? Rupa can drive' },
  { id: 5, ts: now - 52 * min, type: 'message.out', bot: 'family', chat: 'g1@g.us', summary: 'Diwali dinner is on Saturday at 19:00 at Rupa’s. 14 people so far.' },
  { id: 4, ts: now - 53 * min, type: 'message.in', bot: 'family', chat: 'g1@g.us', summary: 'Vedika: !family when is the Diwali dinner?' },
  { id: 3, ts: now - 3 * 3600_000, type: 'schedule.run', bot: 'carpool', chat: 'g2@g.us', summary: 'monday-plan posted' },
  { id: 2, ts: now - 5 * 3600_000, type: 'channel.status', bot: null, chat: null, summary: 'WhatsApp: open' },
  { id: 1, ts: now - 26 * 3600_000, type: 'config', bot: 'neighbours', chat: null, summary: 'Neighbours switched off (admin)' },
];
const messages: StoredMessage[] = [
  { id: 4, ts: now - 2 * min, name: 'Carpool helper', text: 'I can move Thursday’s pickup to 17:30 with Rupa driving. An organizer needs to confirm.', fromBot: true },
  { id: 3, ts: now - 4 * min, name: 'Anu', sender: '41790000003', text: '@carpool can we do 17:30 on Thursday? Rupa can drive', fromBot: false, addressed: true },
  { id: 2, ts: now - 30 * min, name: 'Rupa', sender: '41790000002', text: 'Football is 30 min later this week', fromBot: false },
  { id: 1, ts: now - 31 * min, name: 'Vik', sender: '41790000001', text: 'Who has the booster seat?', fromBot: false },
];
const usageRow = (key: string, calls: number, input: number, output: number, cost: number | null) => ({ key, calls, input, output, cost, unpriced: cost == null ? calls : 0, plan: 0 });
const usage: Record<string, ReturnType<typeof usageRow>[]> = {
  bot: [usageRow('carpool', 212, 640_000, 52_000, 1.84), usageRow('family', 133, 410_000, 39_000, 1.21), usageRow('', 18, 90_000, 21_000, 0.31)],
  model: [usageRow('anthropic:claude-sonnet-5-5', 251, 880_000, 80_000, 3.02), usageRow('anthropic:claude-haiku-5-5', 112, 260_000, 32_000, 0.34)],
};
let paused = false;
let updateRunning: { target: string; startedAt: number } | null = null;

function status(): Status {
  return {
    user: { id: 1, username: 'vik', email: '', role: 'owner' },
    channel: { id: 'main', label: 'Main', status: 'open', me: '41790000099:1@s.whatsapp.net', since: now - 5 * 3600_000,
      numbers: [{ id: 'main', label: 'Main', status: 'open', me: '41790000099:1@s.whatsapp.net', since: now - 5 * 3600_000 }, { id: 'shop', label: 'Shop', status: 'reconnecting', since: now - 6 * min }] },
    settings: { paused }, version: 'v1.9.0 · demo', uptimeSec: 5 * 3600 + 120, memoryMb: 182, node: 'v22.23.4',
    bots: bots.map((b) => ({ id: b.id, name: b.name, enabled: b.enabled, chats: b.config.chats?.length || 0 })), pending: pending.length,
  };
}

async function route(method: string, path: string, body: any): Promise<unknown> {
  const u = new URL(path, 'https://demo');
  const p = u.pathname;
  let m: RegExpExecArray | null;
  if (method === 'GET') {
    if (p === '/api/status') return status();
    if (p === '/api/bots') return bots;
    if ((m = /^\/api\/bots\/([^/]+)$/.exec(p))) return bots.find((b) => b.id === decodeURIComponent(m![1]));
    if (p === '/api/chats') return chats;
    if ((m = /^\/api\/chats\/([^/]+)\/messages$/.exec(p))) return decodeURIComponent(m[1]) === 'g2@g.us' ? messages : [];
    if (p === '/api/activity') return acts;
    if (p === '/api/pending') return pending;
    if (p === '/api/usage') {
      const g = u.searchParams.get('groupBy') || 'bot'; const rows = usage[g] || usage.bot;
      const total = rows.reduce((a, r) => ({ ...a, calls: a.calls + r.calls, input: a.input + r.input, output: a.output + r.output, cost: (a.cost || 0) + (r.cost || 0) }), usageRow('', 0, 0, 0, 0));
      return { from: now - 30 * 86400_000, to: now, groupBy: g, total, rows };
    }
    if (p === '/api/system') return { host: 'duniya-demo', os: 'Ubuntu 24.04 LTS', uptimeSec: 12 * 86400, cpus: 2, load: [0.12, 0.2, 0.18], cpu: 7, memory: { total: 1024 ** 3, used: 0.58 * 1024 ** 3, available: 0.42 * 1024 ** 3, swapTotal: 2 * 1024 ** 3, swapUsed: 0.1 * 1024 ** 3 }, disks: [{ path: '/', total: 45 * 1024 ** 3, used: 9.2 * 1024 ** 3, free: 35.8 * 1024 ** 3 }], app: { rss: 182 * 1024 ** 2, node: 'v22.23.4' }, rebootRequired: false };
    if (p === '/api/updates') return { settings: { mode: 'notify', channel: 'stable', at: '04:00' }, status: { current: 'v1.9.0', latest: updateRunning ? 'v1.9.0' : 'v1.9.1', available: !updateRunning, target: 'v1.9.1', checkedAt: now - 2 * 3600_000 }, install: 'native', running: updateRunning };
    if (p === '/api/models') return { models: [{ ref: 'anthropic:claude-sonnet-5-5', provider: 'anthropic', label: 'Anthropic · Claude Sonnet 5.5' }, { ref: 'anthropic:claude-haiku-5-5', provider: 'anthropic', label: 'Anthropic · Claude Haiku 5.5' }], defaultModel: 'auto', resolvedDefault: 'anthropic:claude-sonnet-5-5' };
    if (p === '/api/session') return { authed: true, user: status().user };
  }
  if (method === 'PUT' && (m = /^\/api\/bots\/([^/]+)$/.exec(p))) {
    const b = bots.find((x) => x.id === decodeURIComponent(m![1]));
    if (!b) throw new ApiError('Not found', 404);
    Object.assign(b.config, body); if ('enabled' in body) b.enabled = !!body.enabled; if (body.name) b.name = body.name; if ('description' in body) b.description = body.description;
    return { ...b, warnings: [] };
  }
  if (method === 'POST' && p === '/api/settings') { paused = !!body.paused; return status().settings; }
  if (method === 'POST' && p === '/api/chats/bind') { const c = chats.find((x) => x.id === body.chat); if (c) c.bot = body.bot || ''; return { ok: true }; }
  if (method === 'PUT' && (m = /^\/api\/chats\/([^/]+)\/prefs$/.exec(p))) { const c = chats.find((x) => x.id === decodeURIComponent(m![1])); if (c && body.model) c.model = body.model; return { model: c?.model, logging: c?.logging }; }
  if ((m = /^\/api\/pending\/([^/]+)(\/apply)?$/.exec(p))) { pending = pending.filter((x) => x.code !== m![1]); return m[2] ? { result: 'Applied (demo)' } : { ok: true }; }
  if (method === 'POST' && p === '/api/updates/apply') { updateRunning = { target: 'v1.9.1', startedAt: Date.now() }; setTimeout(() => { updateRunning = null; }, 8000); return { started: true, running: updateRunning }; }
  if (method === 'POST' && p === '/api/updates/check') return { current: 'v1.9.0', latest: 'v1.9.1', available: true };
  if (method === 'POST' && p === '/api/ai/bot-draft') {
    const b = bots.find((x) => x.id === body.botId);
    const after = `${b?.config.prompt || ''}\n- ${String(body.request || '').trim()}`;
    return { summary: 'Added your request to the instructions.', questions: [], changes: [{ field: 'prompt', before: b?.config.prompt, after }], proposed: { ...b?.config, prompt: after }, warnings: [], model: 'demo' };
  }
  throw new ApiError('Not available in the demo', 400);
}

export const demoApi: ApiClient = {
  get: (p) => route('GET', p, null) as any, post: (p, b) => route('POST', p, b ?? {}) as any,
  put: (p, b) => route('PUT', p, b ?? {}) as any, del: (p) => route('DELETE', p, null) as any,
};
