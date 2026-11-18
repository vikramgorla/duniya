// Demo panel: the real core + admin panel against a throwaway data directory, seeded through the app's own modules.
// Fake WhatsApp numbers (+41 79 000 00 xx), a fake local model endpoint; no provider or WhatsApp network calls.
// Used by `npm run check:responsive` and for the screenshots of the GitHub Pages site.
//
//   node scripts/demo-panel.mjs [port]      → http://127.0.0.1:8099, sign in as admin / demo-password-123
//   DEMO_EMPTY=1 node scripts/demo-panel.mjs → a fresh install: no provider, no agent, WhatsApp waiting for a scan
//                                              (“Get code” links it after a few seconds), every chat Off
import http from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
export const DEMO_PASSWORD = 'demo-password-123';

/** What the fake AI helper proposes when asked to change the car-pooling agent (shows the review's diff, #32). */
const EDIT_PROPOSAL = {
  summary: 'Replies get shorter and warmer, Lea becomes an organizer, people can ask for the weather before a ride, and the morning post moves to 06:30 with a new Sunday-evening preview.',
  changes: {
    prompt: 'You coordinate car pooling for this WhatsApp group (school runs, office commute, trips).\n\n- When someone offers a ride, save it as a note: driver, date, departure time and place, destination, free seats.\n- When someone needs a ride, save it as a note and match it with an offer; tell both people clearly.\n- Answer questions like "who drives tomorrow?" or "any seat to Geneva on Friday?" from the notes and recent messages.\n- When a ride is full, cancelled or done, update or remove the note (organizers can remove notes).\n- If rain or snow is forecast for a ride, mention it and suggest leaving 10 minutes earlier.\n- Be precise with times and places; always repeat the date as weekday + date to avoid mix-ups.\n- Keep replies very short and warm, in the language of the question. One emoji at most.',
    triggers: ['!ride', '!lift'],
    model: 'anthropic:claude-sonnet-5-5',
    organizers: ['+41790000002', '+41790000003'],
    tools: { participant: ['transport:*', 'calendar:events_list', 'weather:forecast'], organizer: ['calendar:*'], deny: [] },
    schedules: [
      { id: 'todays-rides', at: '06:30', days: 'mon,tue,wed,thu,fri', enabled: true, prompt: "Post today's rides from the notes: for each ride, driver, departure time and place, destination and who is riding. Mention seats still free. If no rides are planned today, post nothing." },
      { id: 'week-ahead', at: '19:00', days: 'sun', enabled: true, prompt: 'Post the rides planned for the coming week and ask who still needs a seat.' },
    ],
  },
};

/** Anthropic Messages SSE for a scripted answer, one word every 40 ms (the Ask box streams, #83). */
async function streamAnthropic(res, content, usage) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 0 } } });
  for (const [index, b] of content.entries()) {
    if (b.type === 'text') {
      ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const w of b.text.match(/\S+\s*/g) || []) { ev('content_block_delta', { index, delta: { type: 'text_delta', text: w } }); await new Promise((r) => setTimeout(r, 40)); }
    } else {
      ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input ?? {}) } });
    }
    ev('content_block_stop', { index });
  }
  ev('message_delta', { delta: { stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
  ev('message_stop', {});
  res.end();
}

/** Local stand-in for the Anthropic, ChatGPT and OpenRouter APIs. */
async function fakeModels() {
  const server = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = req.url;
    if (u.startsWith('/anthropic/v1/models')) {
      return json({ data: ['Sonnet', 'Haiku', 'Opus'].map((n) => ({ id: `claude-${n.toLowerCase()}-5-5`, display_name: `Claude ${n} 5.5`, type: 'model', created_at: '2026-01-01T00:00:00Z' })), has_more: false, first_id: 'a', last_id: 'c' });
    }
    if (u.startsWith('/chatgpt/models')) return json({ models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5' }, { slug: 'gpt-5.5-mini', display_name: 'GPT-5.5 mini' }] });
    if (u.startsWith('/openrouter/models')) {
      return json({ data: [
        { id: 'deepseek/deepseek-v4:free', name: 'DeepSeek V4 (free)', pricing: { prompt: '0', completion: '0' } },
        { id: 'meta-llama/llama-4-maverick:free', name: 'Llama 4 Maverick (free)', pricing: { prompt: '0', completion: '0' } },
        { id: 'mistralai/mistral-medium-4', name: 'Mistral Medium 4', pricing: { prompt: '0.0000004', completion: '0.000002' } }] });
    }
    if (u.startsWith('/anthropic/v1/messages')) {
      const body = JSON.parse(d || '{}');
      const draft = (body.tools || []).some((t) => t.name === 'propose_agent');
      const edit = draft && JSON.stringify(body.messages || []).includes('\\"mode\\": \\"edit\\"');
      await new Promise((r) => setTimeout(r, draft ? 900 : 500));
      const content = edit ? [{ type: 'tool_use', id: 'tu1', name: 'propose_agent', input: EDIT_PROPOSAL }] : draft ? [{ type: 'tool_use', id: 'tu1', name: 'propose_agent', input: {
        summary: 'A friendly helper for your running club: it keeps the weekly run schedule, answers “where do we meet?” and posts a reminder every Saturday evening.',
        changes: {
          name: 'Running club', description: 'Weekly runs, meeting points and pace groups for the club.',
          prompt: 'You help a small running club in its WhatsApp group.\n\n- Keep the weekly schedule as notes: day, time, meeting point, distance, pace groups.\n- Answer “where do we meet?” from the notes and recent messages.\n- Every Saturday at 18:00 post Sunday’s run.\n- Keep replies short and warm.',
          triggers: ['!run'], dm: 'members', model: 'auto',
          schedules: [{ id: 'sunday-run', at: '18:00', days: 'sat', enabled: true, prompt: 'Post tomorrow’s run: time, meeting point, distance and pace groups.' }],
        } } }]
        : /Geneva on Friday/.test(d) ? [{ type: 'text', text: 'Friday 21 Nov: Marc drives from Morges station at 07:40 → Geneva, 2 seats left (one is saved for Lea). Want me to add it to the shared calendar?' }]
        : [{ type: 'text', text: 'Hi! The museum trip forms are due Monday 24 Nov 📝 Lea and Marc can drive (3 seats each). Want me to start a poll for the remaining seats?' }];
      const usage = { input_tokens: 1412, output_tokens: 96 };
      if (body.stream) return streamAnthropic(res, content, usage); // #83: the Ask box asks for a token stream
      return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', usage, stop_reason: draft ? 'tool_use' : 'end_turn', content });
    }
    res.writeHead(404); res.end('{}');
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${server.address().port}`;
}

/** Local stand-in for a remote tool service (MCP) with a few weather tools. */
async function fakeToolService() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const tools = [['forecast', 'Weather forecast for a place and day (temperature, rain, wind).'], ['alerts', 'Official weather warnings for a region.'], ['sunrise', 'Sunrise and sunset times for a place.']]
    .map(([name, description]) => ({ name, description, inputSchema: { type: 'object', properties: { place: { type: 'string' } } } }));
  const server = http.createServer(async (req, res) => {
    let d = ''; for await (const c of req) d += c;
    const s = new Server({ name: 'weather', version: '1' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'Morges: 9 °C, light rain until 10:00, then dry.' }] }));
    const tr = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await s.connect(tr);
    await tr.handleRequest(req, res, d ? JSON.parse(d) : undefined);
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

/** Local stand-in for the MCP Registry (052): a few fictional entries, the same API (v0.1), no network. */
async function fakeRegistry(weatherUrl) {
  const S = (server, status = 'active') => ({ server, _meta: { 'io.modelcontextprotocol.registry/official': { status, publishedAt: '2026-10-02T09:00:00Z', isLatest: true } } });
  const entries = [
    S({ name: 'io.github.example-weather/forecast-mcp', title: 'Weather forecasts', description: 'Forecasts, warnings and sunrise times for any place. Free, no key needed.', version: '1.4.0',
      repository: { url: 'https://github.com/example-weather/forecast-mcp', source: 'github' }, remotes: [{ type: 'streamable-http', url: weatherUrl }] }),
    S({ name: 'org.example.recipes/recipes', title: 'Recipe box', description: 'Search recipes, scale ingredients and build a shopping list for a group dinner.', version: '2.1.0',
      repository: { url: 'https://github.com/example-recipes/recipes-mcp', source: 'github' },
      remotes: [{ type: 'streamable-http', url: 'https://mcp.recipes.example.org/mcp', headers: [{ name: 'Authorization', value: 'Bearer {api_key}', isRequired: true, isSecret: true, description: 'API key from your Recipe box account' }] }] }),
    S({ name: 'io.github.swiss-tools/transit', title: 'Train times', description: 'Connections, departures and delays for Swiss public transport.', version: '0.9.2',
      repository: { url: 'https://github.com/swiss-tools/transit', source: 'github' },
      packages: [{ registryType: 'npm', identifier: '@swiss-tools/transit-mcp', version: '0.9.2', transport: { type: 'stdio' } }] }),
    S({ name: 'io.github.doc-lab/pdf-tools', title: 'PDF tools', description: 'Split, merge and read PDF files.', version: '3.0.0',
      repository: { url: 'https://github.com/doc-lab/pdf-tools', source: 'github' }, packages: [{ registryType: 'pypi', identifier: 'pdf-tools-mcp', version: '3.0.0', transport: { type: 'stdio' } }] }),
    S({ name: 'io.github.quicknotes/notes-sync', title: 'Notes sync', description: 'Save and share notes between chats.', version: '0.2.0',
      remotes: [{ type: 'streamable-http', url: 'https://notes-sync.example.net/mcp' }] }),
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/v0.1/servers') {
      const q = (url.searchParams.get('search') || '').toLowerCase();
      const hits = entries.filter((e) => `${e.server.name} ${e.server.title}`.toLowerCase().includes(q));
      return json(200, { servers: hits, metadata: { count: hits.length } });
    }
    const m = url.pathname.match(/^\/v0\.1\/servers\/([^/]+)\/versions\/latest$/);
    const e = m && entries.find((x) => x.server.name === decodeURIComponent(m[1]));
    return e ? json(200, e) : json(404, { error: 'not found' });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${server.address().port}`;
}

/** 062: fake /api/checklist data (install with page.call(FAKE_CHECKLIST, data)) that makes Getting started show `next` as the current step, as on a fresh
 *  install, with Car pooling as the new agent; `done: true` shows the closing "All set" card. Screenshots only. */
export function fakeChecklist(next, { done = false } = {}) {
  const ids = ['whatsapp', 'provider', 'agent', 'chat', 'reply'];
  const titles = { whatsapp: 'Link your WhatsApp number', provider: 'Connect an AI model', agent: 'Create your first agent', chat: 'Switch a chat on', reply: 'Send a test message' };
  const hints = { whatsapp: 'Use the phone of the number your agents answer from.', provider: 'Agents need a model to think with. Paste a key, or start free with OpenRouter.',
    agent: 'Pick a template or describe it in your own words; you can change everything later.', chat: 'Every chat starts Off, so agents stay silent. Choose the group your agent should answer in.',
    reply: 'Ask your agent something here, or write to it in the chat you switched on.' };
  const n = done ? ids.length : ids.indexOf(next);
  const c = { done: n, total: ids.length, complete: done, dismissed: false, agent: { id: 'carpool', name: 'Car pooling', trigger: '!ride' },
    steps: ids.map((id, i) => ({ id, title: titles[id], hint: hints[id], href: `#${id}`, done: i < n, skipped: false })) };
  return c;
}
/** 062: installs a fakeChecklist() result in the panel (run with page.call, so the data is passed as a value, not code). */
export const FAKE_CHECKLIST = `async function (fc) {
  const { S, show, h } = await import('/app/core.js');
  const fcf = window.fetch;
  window.fetch = (u, o) => (String(u) === '/api/checklist' && (!o || !o.method || o.method === 'GET') ? Promise.resolve(new Response(JSON.stringify(fc))) : fcf(u, o));
  S.checklist = null;
  S.checklistDone = fc.complete ? { last: h('div', { class: 'chat-mini' }, h('div', { class: 'bubble me' }, 'Any seat to Geneva on Friday?'), h('div', { class: 'bubble agent' }, 'Friday 21 Nov: Marc drives from Morges station at 07:40, 2 seats left. Want me to save one for you?')) } : null;
  show(S.tab);
}`;

/** 063: the panel is ES modules, nothing is global. Page scripts of the screenshot and responsive checks (async
 *  functions) start with this to reach the shared state and the router; other functions are imported where needed. */
export const PANEL = "const { S, show, openFind } = await import('/app/core.js');";

/** Start the seeded demo panel. Returns { base, dataDir }. Call once per process (the app's modules are singletons). */
/** `small: true` pretends to run on a 1 GB / 1 CPU VM (the free-tier size), so the small-server guardrails show. */
export async function startDemo({ port = 0, dataDir = mkdtempSync(join(tmpdir(), 'duniya-demo-')), small = !!process.env.DEMO_SMALL, empty = !!process.env.DEMO_EMPTY } = {}) {
  const F = await fakeModels();
  const weatherUrl = await fakeToolService();
  const registryUrl = await fakeRegistry(weatherUrl);
  const data = join(dataDir, 'data'); const ops = join(dataDir, 'ops');
  for (const d of [data, join(ops, 'req'), join(ops, 'state')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(ops, 'helper'), `#!/bin/sh\n# duniya-ops-version: ${readFileSync(join(ROOT, 'deploy/ops/duniya-ops'), 'utf8').match(/^# duniya-ops-version: (\d+)$/m)[1]}\n`); // current maintenance helper (nothing runs it in the demo)
  // #96: OS updates from captured apt output (3 to install, snapd rolling out gradually, docker-ce on hold), the last
  // run's log (kernel installed) and a pending restart, so the Server page shows every group and the restart banner.
  const apt = join(ops, 'apt'); mkdirSync(apt, { recursive: true });
  const fx = (f) => readFileSync(join(ROOT, 'test/fixtures/apt', f), 'utf8');
  writeFileSync(join(apt, 'simulate.txt'), fx('sim-full-upgrade-phased-held.txt'));
  writeFileSync(join(apt, 'policy.txt'), fx('policy.txt'));
  writeFileSync(join(apt, 'holds.txt'), 'docker-ce\n');
  writeFileSync(join(ops, 'state', 'last.log'), fx('run-full-upgrade.log'));
  const ranAt = Date.now() - 26 * 3600000;
  writeFileSync(join(ops, 'state', 'status.json'), JSON.stringify({ action: 'os-update', state: 'done', code: 0, startedAt: ranAt - 277000, endedAt: ranAt }));
  writeFileSync(join(ops, 'reboot-required'), '*** System restart required ***\n');
  writeFileSync(join(ops, 'reboot-required.pkgs'), 'linux-image-6.8.0-1035-oracle\nlinux-base\n');
  utimesSync(join(ops, 'reboot-required'), ranAt / 1000, ranAt / 1000);
  Object.assign(process.env, {
    DATA_DIR: data, PANEL_PORT: String(port), ADMIN_PASSWORD: DEMO_PASSWORD,
    ANTHROPIC_BASE_URL: `${F}/anthropic`, OPENAI_API_BASE: `${F}/chatgpt`, OPENROUTER_API_BASE: `${F}/openrouter`,
    DUNIYA_INSTALL: 'systemd', DUNIYA_HOST: process.env.DUNIYA_HOST || 'oci', DUNIYA_OPS_HELPER: join(ops, 'helper'), DUNIYA_OPS_REQUEST_DIR: join(ops, 'req'), DUNIYA_OPS_STATE_DIR: join(ops, 'state'),
    DUNIYA_FAKE_APT: apt, DUNIYA_REBOOT_REQUIRED_FILE: join(ops, 'reboot-required'),
    UPDATE_MODE: 'notify', TZ_DEFAULT: 'Europe/Zurich', PUBLIC_URL: 'https://duniya.example.org',
    // Web address & access card with its full form (036), without network lookups.
    DUNIYA_OPS_WEBCONFIG: join(ROOT, 'deploy/ops/webconfig.mjs'), DUNIYA_PUBLIC_IP: '203.0.113.10', DUNIYA_TLS_PORT: '1', DUNIYA_FAKE_CADDY_LOG: join(ops, 'caddy.log'),
  });
  const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
  if (small) (await imp('src/core/resources.js')).setResourceProbe({ totalMb: 958, cgroupLimitMb: null, availableMb: 540, cpus: 1 });
  const store = await imp('src/core/store.js');
  // 055: the small demo has Small server mode on, so the carpool agent's local tool service is shown as allowed.
  if (small) store.updateSettings({ smallServerMode: true });
  const db = await imp('src/core/db.js');
  const agents = await imp('src/core/agents.js');
  const prefs = await imp('src/core/chat-prefs.js');
  const providers = await imp('src/core/providers/index.js');
  const system = await imp('src/core/system.js');
  await system.osUpdates(); // #96: the Server tab badge counts from the last check
  const backup = await imp('src/core/backup/index.js');
  const contacts = await imp('src/core/contacts.js');
  const pp = await imp('src/core/people.js');
  const globalMcp = await imp('src/core/global-mcp.js');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const { createHub } = await imp('src/channels/hub.js');
  const { createWhatsAppAdapter } = await imp('src/channels/whatsapp/index.js');
  // 075: the real hub and WhatsApp adapter over fake sessions (one per number)
  // 077: a fake Telegram bot (test/fake-telegram.js: a fake Bot API, no network), loaded only once its token is stored
  const { fakeBotApi } = await imp('test/fake-telegram.js');
  const { createTelegramAdapter } = await imp('src/channels/telegram/index.js');
  const bot = fakeBotApi({ me: { first_name: 'Family helper', username: 'duniya_family_bot' } });
  const createChannelHub = (factory) => createHub({ loaders: { whatsapp: async () => createWhatsAppAdapter({ factory }),
    telegram: async () => createTelegramAdapter({ fetch: bot.fetch, api: 'https://api.telegram.invalid' }) } });
  const { createRouter, createHistoryHandler } = await imp('src/core/router.js');

  if (empty) return startEmpty({ imp, createChannelHub, createRouter, createHistoryHandler });

  const now = Date.now(); const MIN = 60000; const H = 60 * MIN; const D = 24 * H;
  const P = (n) => `417900000${String(n).padStart(2, '0')}`; // +41 79 000 00 NN — obviously fake
  const people = ['Anu', 'Marc', 'Lea', 'Ravi', 'Sophie', 'Jonas', 'Priya', 'Luca', 'Mia', 'Tom', 'Nadia', 'Arjun'];
  const member = (i, admin = false) => ({ phone: P(i + 1), jid: `${P(i + 1)}@s.whatsapp.net`, admin });
  const G = (n) => `12036304112233000${n}@g.us`;
  const GROUPS = {
    main: [
      { id: G(1), name: 'Class 4B parents', size: 23, members: [0, 1, 2, 3, 4, 5].map((i) => member(i, i === 0)) },
      { id: G(2), name: 'Family ❤️', size: 9, members: [0, 3, 6, 9].map((i) => member(i, i === 3)) },
      { id: G(3), name: 'Morges ↔ Geneva rides', size: 14, members: [1, 2, 4, 5, 7, 8].map((i) => member(i, i === 1)) },
      { id: G(4), name: 'Product team', size: 11, members: [2, 4, 7, 10].map((i) => member(i, i === 10)) },
      { id: G(5), name: 'Rue du Midi neighbours', size: 31, members: [5, 8, 11].map((i) => member(i)) },
      { id: G(6), name: 'Book club', size: 7, members: [6, 8].map((i) => member(i)) },
      { id: G(7), name: 'Tuesday badminton', size: 12, members: [1, 9].map((i) => member(i)) },
    ],
    club: [
      { id: G(8), name: 'U11 football parents', size: 18, members: [3, 5, 7, 9].map((i) => member(i, i === 3)) },
      { id: G(9), name: 'Coaches', size: 5, members: [3, 11].map((i) => member(i)) },
    ],
  };
  const histories = {};
  const factory = ({ number }) => {
    const list = GROUPS[number] || [];
    const find = (jid) => list.find((g) => g.id === jid);
    return {
      id: 'whatsapp',
      async start(h, { onHistory } = {}) { histories[number] = onHistory; },
      // #91: "Load recent messages": groups answer with a few earlier messages; Family's phone never answers
      async fetchHistory(jid, count, anchor) {
        if (jid === G(2)) return 'demo';
        setTimeout(() => histories[number]?.(Array.from({ length: 12 }, (_, i) => ({ channel: 'whatsapp', chat: jid, isGroup: true, msgId: `old${i}`, ts: anchor.ts - (12 - i) * 41 * MIN,
          phone: P(1 + (i % 4)), senderJid: `${P(1 + (i % 4))}@s.whatsapp.net`, senderName: ['Anu', 'Marc', 'Léa', 'Ravi'][i % 4], fromMe: false, kind: 'text', text: jid === G(3) ? `Earlier ride plan ${i + 1}` : `Earlier message ${i + 1}`, quoted: '' })), { onDemand: true, chats: [jid] }), 1200);
        return 'demo';
      },
      async status() { return { status: 'open', me: `${number === 'main' ? P(99) : P(98)}:1@s.whatsapp.net`, since: now - 3 * D - 4 * H }; },
      async listChats() { return list.map(({ id, name, size }) => ({ id, name, size })); },
      async chatName(jid) { return find(jid)?.name || ''; },
      async groupMembers(jid) { return find(jid)?.members || []; },
      async isMember(jid, phone) { return !!find(jid)?.members.some((m) => m.phone === phone); },
      async send() { return { msgId: `out-${Date.now()}` }; },
      async typing() {},
      async lookupNumber(phone) { return { jid: `${String(phone).replace(/\D/g, '')}@s.whatsapp.net`, exists: true, lid: '' }; },
      async groupInfo(jid) {
        const g = find(jid) || {};
        return { id: jid, subject: g.name, description: 'Shared rides between Morges and Geneva. Be kind, be on time.', owner: '', size: g.size,
          announcement: false, locked: true, joinApproval: false, participants: (g.members || []).map((m) => ({ phone: m.phone, jid: m.jid, admin: m.admin ? 'admin' : null })) };
      },
      async groupInviteLink() { return { link: 'https://chat.whatsapp.com/DEMO-INVITE' }; },
      async pair() { return 'DEMO-1234'; }, async logout() {}, async restart() {}, async remove() {},
    };
  };

  // numbers, providers
  store.updateSettings({ whatsappNumbers: [{ id: 'main', label: 'Home' }, { id: 'club', label: 'Football club' }] });
  store.setSecret('ANTHROPIC_API_KEY', 'sk-ant-demo-not-a-real-key');
  store.updateSettings({ mcpRegistry: { enabled: true, baseUrl: registryUrl } }); // 052: Browse tool services, offline
  store.setSecret('CHATGPT_CREDENTIALS', JSON.stringify({ access_token: 'demo', refresh_token: 'demo', expires_at: now + 365 * D, email: 'owner@example.org', client_id: 'demo', scopes: [] }));
  providers.addOpenRouter({ key: 'sk-or-demo-not-a-real-key', freeOnly: true });
  // 074: Claude Code connected (a stand-in file where the downloaded app would be; the demo never runs it)
  const ccBin = join(data, 'apps', 'claudecode', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  mkdirSync(dirname(ccBin), { recursive: true }); writeFileSync(ccBin, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  store.setSecret('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-demo-not-a-real-token');
  // 042: a second ChatGPT account, and OpenRouter paused by its daily free limit
  store.updateSettings({ accounts: [{ id: 'chatgpt-sam', type: 'chatgpt', label: 'Sam' }] });
  store.setSecret('PROVIDER_CHATGPT_SAM_CREDENTIALS', JSON.stringify({ access_token: 'demo', refresh_token: 'demo', expires_at: now + 365 * D, email: 'sam@example.org', client_id: 'demo', scopes: [] }));
  (await imp('src/core/providers/breaker.js')).recordFailure('openrouter', { reason: 'quota', retryAfterMs: 3 * H }, { name: 'OpenRouter', message: 'Rate limit exceeded: free-models-per-day' });
  // agents from the templates
  await agents.loadAgents();
  const tpl = (f) => JSON.parse(readFileSync(join(ROOT, 'templates', f), 'utf8'));
  const mk = (id, file, patch) => agents.createAgent({ id, config: { ...tpl(file), enabled: true, ...patch }, by: 'admin' });
  await mk('school', 'school-friends.json', { chats: [G(1)], model: 'auto' });
  const TG = (n) => `tg:${bot.bot.id}#-10017000000${n}`; // 077: Telegram groups of the demo bot
  await mk('family', 'family.json', { chats: [G(2), `${P(4)}@s.whatsapp.net`, TG(1)], model: 'chatgpt:gpt-5.5', organizers: [`+${P(4)}`] });
  await mk('carpool', 'carpool.json', {
    chats: [G(3)], model: 'anthropic:claude-haiku-5-5', organizers: [`+${P(2)}`],
    mcpServers: { transport: { type: 'local', package: 'mcp-swiss@latest', args: [], env: {} }, calendar: { url: 'https://calendar.example.org/mcp', auth: 'oauth' } },
    tools: { participant: ['transport:*', 'calendar:events_list'], organizer: ['calendar:*'], deny: [] },
    // 054: built-in answers (no AI): an FAQ entry next to the template's quick replies and welcome
    faq: { items: [{ questions: ['Where do we meet in Geneva?', 'Where is the pick-up point?'], keywords: ['meeting point', 'pick-up'], answer: 'Pick-up in Geneva is at Cornavin, Rue de Lausanne exit, next to the taxi rank.' }], strictness: 'normal', wholeGroup: false },
    welcome: { enabled: true, text: 'Welcome {name} to {group}! 🚗 Type !rides to see how to offer or find a seat.', rules: 'Be on time, and cancel your seat as soon as plans change.' },
  });
  await mk('office', 'office-colleagues.json', { chats: [G(4)], model: 'auto' });
  await mk('football', 'event-planning.json', { name: 'U11 football', description: 'Match days, lifts and snack rota for the U11 team.', triggers: ['!coach'], chats: [`club#${G(8)}`], model: 'openrouter:deepseek/deepseek-v4:free' });
  await mk('neighbours', 'neighbours.json', { enabled: false, chats: [] });
  globalMcp.saveGlobalServer('weather', { url: weatherUrl, defaults: { organizer: ['*'], participant: ['forecast'] } }, 'admin');

  // chats: on/off (silent by default), direct chats seen
  for (const c of [G(1), G(2), G(3), G(4), `club#${G(8)}`, `${P(4)}@s.whatsapp.net`, TG(1)]) prefs.setChatPrefs(c, { enabled: true });
  // 077: Telegram: the bot is in two groups (Cousins on, Running club off); Ravi linked his number, so he is one person
  store.setSecret('TELEGRAM_BOT_TOKEN', bot.token);
  bot.group(TG(1).split('#')[1], { title: 'Cousins 🇮🇳', admins: [{ id: 501, first_name: 'Ravi', is_bot: false }], members: [502, 503, 504, 505] });
  bot.group(TG(2).split('#')[1], { title: 'Running club', admins: [], members: [506, 507] });
  for (const [n, title] of [[1, 'Cousins 🇮🇳'], [2, 'Running club']]) { prefs.noteChat({ chat: TG(n), number: String(bot.bot.id), isGroup: true }); (await imp('src/core/chat-names.js')).rememberGroupNames([{ id: TG(n), name: title }]); }
  (await imp('src/core/people.js')).personFor({ channel: 'telegram', externalId: '501', phone: P(4) });
  for (const [i, [name, text, fromAgent]] of [['Ravi', 'Who brings the cake on Sunday?', false], ['Priya', 'I can bake one 🎂', false], ['', 'Priya bakes the cake. I saved it as a note.', true]].entries()) {
    db.logMessage({ channel: 'telegram', chat: TG(1), agent: fromAgent ? 'family' : '', msgId: `t${i}`, sender: fromAgent ? '' : name === 'Ravi' ? P(4) : '', senderJid: fromAgent ? '' : String(501 + i), name, text, addressed: i === 0, fromAgent, ts: now - (3 - i) * 17 * MIN });
  }
  prefs.setChatPrefs(G(3), { logging: 'verbose' }); prefs.setChatPrefs(G(2), { logging: 'minimal' });
  prefs.setChatPrefs(G(3), { fallback: { mode: 'on', chain: ['chatgpt:auto', 'anthropic:claude-haiku-5-5'] } }); // #65: own chain
  prefs.ignoredCounts.set(G(5), 37); prefs.ignoredCounts.set(G(6), 12); prefs.ignoredCounts.set(G(7), 5);
  const seen = db.db.prepare('INSERT INTO chats_seen (tenant_id, chat, number, is_group, name, phone, last_at) VALUES (?, ?, ?, 0, ?, ?, ?)');
  for (const [i, name] of [[4, 'Sophie'], [7, 'Priya'], [10, 'Nadia']]) seen.run('default', `${P(i)}@s.whatsapp.net`, 'main', name, P(i), now - i * H);
  seen.run('default', `club#${P(12)}@s.whatsapp.net`, 'club', 'Coach Arjun', P(12), now - 5 * H);
  // 049: a direct chat set up before the person wrote ("Waiting for the first message")
  await (await imp('src/core/direct-chats.js')).prepareDirectChat({ phone: `+${P(9)}`, agent: 'carpool', private: true }, { by: 'admin' });

  // messages & memory of the car-pooling group
  const conv = [
    [2, 'Marc', 'I drive to Geneva Friday, leaving Morges station 07:40. 3 seats.', false, false],
    [3, 'Lea', '!ride any seat to Geneva on Friday morning?', true, false],
    [0, 'Car pooling', 'Friday 21 Nov: Marc drives from Morges station at 07:40, 3 seats. I saved a seat for you, Lea — 2 left.', false, true],
    [5, 'Sophie', 'Can someone take me back Thursday evening? Geneva Cornavin → Morges around 18:00', false, false],
    [8, 'Luca', '@Car pooling who drives tomorrow?', true, false],
    [0, 'Car pooling', 'Tomorrow (Thu 20 Nov): Luca 07:15 from Morges (full), Mia back from Cornavin at 18:10 (1 seat). Sophie, Mia could take you.', false, true],
    [9, 'Mia', 'Yes Sophie, meet at Cornavin 18:10 👍', false, false],
  ];
  let lastId = 0; const answers = [];
  conv.forEach(([p, name, text, addressed, fromAgent], i) => {
    lastId = db.logMessage({ chat: G(3), agent: fromAgent ? 'carpool' : '', msgId: `m${i}`, sender: fromAgent ? '' : P(p), name, text, addressed, fromAgent, ts: now - (conv.length - i) * 23 * MIN });
    if (fromAgent) answers.push(lastId);
  });
  // 070: Review — one answer rated good, one wrong (shows Teach)
  const review = await imp('src/core/review.js');
  review.rateAnswer('carpool', answers[0], 1, 'admin'); review.rateAnswer('carpool', answers[1], -1, 'admin');
  db.setChatMemory(G(3), 'Regular rides: Marc (Mon/Wed/Fri 07:40 Morges station → Geneva), Luca (Tue/Thu 07:15). Mia returns from Cornavin around 18:10. Lea needs Friday mornings.', lastId);
  for (const [text, author] of [['Fri 21 Nov — Marc, 07:40 Morges station → Geneva, seats: Lea + 1 free', 'Marc'], ['Thu 20 Nov — Mia, 18:10 Geneva Cornavin → Morges, seats: Sophie', 'Mia'], ['Sophie needs a ride back on Thursdays (Cornavin → Morges)', 'Sophie']]) {
    db.addNote({ chat: G(3), agent: 'carpool', text, author, role: 'participant' });
  }

  // contacts, a pending confirmation
  // 057: phone contact names for most people, a profile name only for one, and group member tags
  contacts.syncWhatsAppContacts(people.map((name, i) => (i === 5 ? { id: `${P(i + 1)}@s.whatsapp.net`, notify: `${name} 🏸` } : { id: `${P(i + 1)}@s.whatsapp.net`, name })));
  const tags = await imp('src/core/member-tags.js');
  for (const [i, label] of [[0, 'Class rep'], [2, 'Treasurer'], [4, 'Snacks']]) tags.saveMemberTag({ chat: G(1), participant: `${P(i + 1)}@s.whatsapp.net`, phone: P(i + 1), label });
  for (const [i, label] of [[1, 'Driver'], [7, 'Driver']]) tags.saveMemberTag({ chat: G(3), participant: `${P(i + 1)}@s.whatsapp.net`, phone: P(i + 1), label });
  // 078: People — everyone who wrote (WhatsApp; Jonas also on Telegram), saved people, two households with kids
  // without an app, ties, notes, tags and lists. Fake numbers only.
  const pid = people.map((name, i) => pp.personFor({ channel: 'whatsapp', externalId: `${P(i + 1)}@s.whatsapp.net`, phone: P(i + 1), name }));
  pp.personFor({ channel: 'telegram', externalId: '700100', phone: P(6), name: 'Jonas' });
  const meier = pp.createPerson({ phone: P(20), name: 'Dr. Meier (paediatrician)', shared: true }, 'admin');
  pp.addNote(meier.id, { text: 'Mon–Fri 8–12, Rue de Lausanne 14, 1110 Morges — call before 11', author: 'admin' });
  const taxi = pp.createPerson({ phone: P(21), name: 'Taxi Morges', shared: true }, 'admin');
  pp.addNote(taxi.id, { text: 'Night line', author: 'admin' });
  pp.updatePerson(pid[2], { name: 'Lea Fontaine-Bernasconi', nickname: 'Lea', birthday: '--06-14' });
  pp.addNote(pid[2], { text: 'Car-pool organizer, prefers voice notes', author: 'admin' });
  pp.addNote(pid[2], { text: 'Asked for Friday morning rides until December', by: 'agent', author: 'Carpool' });
  const kids = [['Vedika', '2016-04-23'], ['Kabir', '2019-09-02'], ['Noé', '2017-01-30']].map(([name, birthday]) => pp.createPerson({ name, birthday }, 'admin'));
  const chary = pp.saveHousehold({ name: 'Chary family', address: 'Chemin des Vignes 3, 1110 Morges' });
  for (const [id, role] of [[pid[0], 'adult'], [pid[3], 'adult'], [kids[0].id, 'kid'], [kids[1].id, 'kid']]) pp.setHouseholdMember(chary.id, id, role);
  const font = pp.saveHousehold({ name: 'Fontaine family' });
  for (const [id, role] of [[pid[2], 'adult'], [pid[1], 'adult'], [kids[2].id, 'kid']]) pp.setHouseholdMember(font.id, id, role);
  pp.addTie(pid[0], pid[3], { kind: 'partner' });
  for (const k of [kids[0], kids[1]]) { pp.addTie(pid[0], k.id, { kind: 'parent' }); pp.addTie(pid[3], k.id, { kind: 'parent' }); }
  pp.addTie(kids[0].id, kids[1].id, { kind: 'sibling' });
  pp.addTie(pid[2], kids[2].id, { kind: 'parent' }); pp.addTie(pid[1], pid[2], { kind: 'partner' });
  pp.addTie(pid[6], kids[0].id, { kind: 'custom', label: 'Godmother of', inverse: 'Goddaughter of' });
  pp.addTie(pid[3], pid[7], { kind: 'works_with' });
  for (const [i, tags] of [[0, ['parents-council']], [3, ['badminton', 'driver']], [5, ['badminton']], [7, ['driver']], [1, ['driver']], [9, ['badminton', 'neighbour']]]) pp.setTags(pid[i], tags);
  const bad = pp.saveList({ name: 'Badminton Tuesdays' });
  for (const i of [3, 5, 9, 11]) pp.setListMember(bad.id, pid[i]);
  const xmas = pp.saveList({ name: 'Christmas cards' });
  for (const id of [pid[0], pid[2], pid[6], meier.id]) pp.setListMember(xmas.id, id);
  db.addPending({ code: 'K7Q2', agent: 'carpool', server: 'calendar', confirmTool: 'confirm', confirmId: 'cf_demo_1', tool: 'events_create', chat: G(3), requester: P(2), summary: 'Add “Friday ride: Marc 07:40 Morges → Geneva” to the shared calendar', expires: now + 50 * MIN });

  // activity
  const acts = [
    [26 * H, 'system', '', '', 'Started'],
    [6 * H, 'schedule.run', 'carpool', G(3), "Posted today's rides (3 rides, 2 free seats)"],
    [5 * H, 'message.in', 'family', G(2), 'Ravi: !family what time is Diwali dinner on Saturday?'],
    [5 * H - 40000, 'model.usage', 'family', G(2), 'GPT-5.5: 1204 in / 88 out'],
    [5 * H - 30000, 'message.out', 'family', G(2), 'Saturday 22 Nov, 19:00 at Ravi & Priya’s. Bring dessert!'],
    [3 * H, 'config', '', G(5), 'Chat switched OFF — agents ignore it (admin)'],
    [2 * H, 'mcp.call', '', '', 'Claude (AI assistant): list_agents'],
    [95 * MIN, 'message.in', 'school', G(1), 'Anu: !buddy reminder for the museum trip forms?'],
    [94 * MIN, 'tool.call', 'school', G(1), 'whatsapp:send_poll — "Who can drive on the museum trip?" (3 options)'],
    [93 * MIN, 'message.out', 'school', G(1), 'Forms are due Monday 24 Nov. I started a poll for drivers 🚗'],
    [40 * MIN, 'whatsapp.vote', 'school', G(1), 'Lea voted “I can drive (3 seats)”'],
    [24 * MIN, 'message.in', 'carpool', G(3), 'Luca: @Car pooling who drives tomorrow?'],
    [23 * MIN, 'tool.call', 'carpool', G(3), 'transport:connections — Morges → Geneva, Thu 07:15'],
    [23 * MIN - 9000, 'model.usage', 'carpool', G(3), 'Claude Haiku 5.5: 2310 in / 71 out'],
    // 072: the reply points at the stored answer (its rating shows in Activity, See in messages opens it)
    [23 * MIN - 8000, 'message.out', 'carpool', G(3), 'Tomorrow (Thu 20 Nov): Luca 07:15 from Morges (full), Mia back from Cornavin at 18:10 (1 seat). Sophie, Mia could take you.', { msg: answers[1] }],
    [22 * MIN, 'whatsapp.reaction', 'carpool', G(3), 'Mia reacted 👍 to the agent'],
    [8 * MIN, 'message.in', 'football', `club#${G(8)}`, 'Arjun: !coach who brings snacks Saturday?'],
    [8 * MIN - 6000, 'message.out', 'football', `club#${G(8)}`, 'Saturday snacks: the Meier family (oranges) and Priya (water). Kick-off 10:30 in Nyon.'],
  ];
  for (const [ago, type, agent, chat, summary, detail] of acts) db.insertActivity({ ts: now - ago, type, agent, chat, summary, ...(detail ? { detail } : {}) });

  // why agents stayed quiet (#34): counters per chat + agent + reason
  const { silenceReason } = await imp('src/core/silences.js');
  const quiet = [[G(3), 'carpool', 'not_addressed', 14, 'Marc'], [G(5), '', 'chat_off', 3, 'Nadia'], [G(1), 'school', 'rate_limited', 1, 'Anu'], [`${P(10)}@s.whatsapp.net`, 'family', 'role_not_allowed', 2, 'Nadia']];
  for (const [chat, agent, reason, n, sender] of quiet) for (let i = 0; i < n; i++) silenceReason(reason, { chat, agent, sender });

  // 30 days of usage
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0); const todaySpan = now - startOfToday.getTime();
  const ins = db.db.prepare('INSERT INTO usage (ts, agent, chat, provider, model, kind, input, output, cost, priced, account, fallback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const plan = [
    ['carpool', G(3), 'anthropic', 'claude-haiku-5-5', 9, 1.0, 5.0, 'set'],
    ['school', G(1), 'anthropic', 'claude-sonnet-5-5', 5, 3.0, 15.0, 'set'],
    ['family', G(2), 'chatgpt', 'gpt-5.5', 6, 0, 0, 'plan'],
    ['office', G(4), 'anthropic', 'claude-sonnet-5-5', 4, 3.0, 15.0, 'set'],
    ['football', `club#${G(8)}`, 'openrouter', 'deepseek/deepseek-v4:free', 5, 0, 0, 'free'],
    ['family', G(2), 'chatgpt', 'gpt-5.5', 2, 0, 0, 'plan', 'chatgpt-sam', 'after ChatGPT plan (usage limit reached)'],
  ];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let day = 29; day >= 0; day--) {
    for (const [agent, chat, prov, model, perDay, pin, pout, priced, account = prov, fallback = ''] of plan) {
      const n = Math.max(1, Math.round(perDay * (0.5 + rnd() * (day < 10 ? 1.4 : 0.9))));
      for (let k = 0; k < n; k++) {
        const input = Math.round(900 + rnd() * 2600); const output = Math.round(40 + rnd() * 220);
        ins.run(day === 0 ? now - Math.round(rnd() * todaySpan) : now - day * D - Math.round(rnd() * 20 * H), agent, chat, prov, model, rnd() < 0.12 ? 'summary' : 'reply', input, output, (input * pin + output * pout) / 1e6, priced, account, fallback);
      }
    }
  }
  store.updateSettings({ modelPrices: { 'anthropic:claude-haiku-5-5': { in: 1, out: 5 }, 'anthropic:claude-sonnet-5-5': { in: 3, out: 15 } } });
  // 069: one clean-up as the upkeep tick does it, so Server → Health shows its last run
  const retention = await imp('src/core/retention.js');
  retention.retentionTick();
  retention.checkDisk(Date.now(), { free: 38 * 2 ** 30, total: 48 * 2 ** 30 }); // a healthy disk in the shots, whatever the machine taking them has
  // spending caps (040), owner alerts and weekly counters (041); 059: the alert number and character are the owner assistant's
  const budget = await imp('src/core/budget.js'); const stats = await imp('src/core/stats.js');
  budget.setCap('agent', 'carpool', { cost: 2 });
  budget.setCap('agent', 'school', { cost: 1.5, fallback: 'anthropic:claude-haiku-5-5' });
  budget.setCap('chat', G(4), { tokens: 400000 });
  await agents.updateAgent('owner-assistant', { alerts: { to: P(1) }, prompt: 'Call me Vik. Short answers in English; French is fine too.\n- Start with what needs me.\n- GIFs welcome when I ask for fun.',
    schedules: [{ id: 'weekly-summary', kind: 'weekly-summary', at: '09:00', days: 'mon' }, { id: 'morning-brief', at: '07:30', days: 'mon,tue,wed,thu,fri', prompt: 'A short morning brief: what happened overnight in my groups and what needs me today.' }] }, 'admin');
  for (let day = 13; day >= 0; day--) {
    for (const [agent, n] of [['carpool', 6], ['school', 3], ['family', 4], ['football', 2]]) {
      for (let k = 0; k < Math.round(n * (0.5 + rnd())); k++) { stats.countStat('handled', { agent }, now - day * D); stats.countStat('reply', { agent }, now - day * D); }
    }
    for (let k = 0; k < 5; k++) stats.countStat('ignored', { chat: G(6 + (k % 2)) }, now - day * D);
  }

  // backups (local only), update status, server metrics history
  backup.setPassphrase('demo passphrase for screenshots');
  backup.updateBackupSettings({ enabled: true, schedule: 'daily', at: '04:00', keep: 14 });
  await backup.runBackup({ reason: 'schedule' }); await new Promise((r) => setTimeout(r, 1100)); await backup.runBackup({ reason: 'manual' });
  db.kvSet('updates:status', JSON.stringify({ current: `v${pkg.version}`, latest: `v${pkg.version}`, available: false, target: null, channel: 'stable', checkedAt: now - 12 * MIN, lastResult: null }));
  const hist = system.metricsHistory();
  for (let i = 720; i > 0; i--) {
    const w = Math.sin(i / 40) * 0.5 + 0.5;
    hist.push({ t: now - i * 30000, cpu: 3 + w * 9 + rnd() * 6 + (i % 120 < 4 ? 30 : 0), mem: 41 + w * 4 + rnd(), swap: 2, disk: 23.4, rx: 1500 + rnd() * 9000, tx: 900 + rnd() * 5000 });
  }

  // start the panel; keep setup and sign-in noise out of the activity log
  const { providerRoutes } = await imp('src/panel/routes/providers.js');
  const { backupRoutes } = await imp('src/panel/routes/backups.js');
  const { updateRoutes } = await imp('src/panel/routes/updates.js');
  const { startPanel } = await imp('src/panel/server.js');
  const wa = createChannelHub(factory);
  const panel = startPanel({ channel: wa, extend: [providerRoutes, (r) => backupRoutes(r, { restart: () => {} }), (r) => updateRoutes(r, { restart: () => {} })] });
  await new Promise((r) => (panel.listening ? r() : panel.once('listening', r)));
  store.createUser({ username: 'priya', email: 'priya@example.org', role: 'admin', password: 'demo-password-456' });
  store.createUser({ username: 'grandpa-viewer', role: 'viewer', password: 'demo-password-789' });
  // owner assistant (044): the owner's own phone (fake) is linked, so Settings shows "Linked +41 79 000 00 01"
  await imp('src/core/owner-assistant.js');
  db.db.prepare("INSERT OR REPLACE INTO owner_links (tenant_id, user_id, phone, status, code_hash, expires_at, linked_at) SELECT 'default', id, ?, 'linked', NULL, 0, ? FROM users WHERE username = 'admin'").run(P(1), now - 2 * D);
  await wa.start({ onMessage: createRouter(wa), onHistory: createHistoryHandler() });
  for (let i = 0; i < 6; i++) await wa.upkeep(Date.now() + 61000); // 075: memory measured a minute after start; 077: Telegram group sizes (one group per tick)
  // #91: Chats shows "Loaded 12 earlier messages" (rides) and "Loading recent messages from your phone…" (Family)
  prefs.noteLatestKeys([2, 5, 6, 7].map((n) => ({ chat: G(n), isGroup: true, msgId: `last-${n}`, participant: `${P(n)}@s.whatsapp.net`, ts: now - n * H })));
  const phoneHistory = await imp('src/core/history-load.js');
  for (const c of [G(3), G(2)]) await phoneHistory.loadChatHistory(c, { by: 'admin', reason: 'switch_on' });
  system.startMetrics();
  const noise = () => db.db.prepare("DELETE FROM activity WHERE summary LIKE 'Panel login%' OR summary LIKE 'Owner \"admin\" created%' OR summary LIKE 'Backup passphrase changed%' OR summary LIKE 'User %' OR summary LIKE 'Contact %' OR summary LIKE 'Global tool service%' OR summary LIKE 'Created \"%' OR summary LIKE 'The server disk%' OR summary LIKE 'Disk space is back%' OR (type = 'backup.done' AND ts > ?)").run(now - 60000);
  noise(); setInterval(noise, 300).unref();
  return { base: `http://127.0.0.1:${panel.address().port}`, dataDir };
}

/** 062: a fresh install, to see the true first run. 075: WhatsApp is not set up (nothing loaded) until Link WhatsApp;
 *  then one number waits for its QR scan; a pairing code links it after
 *  3 s, with three groups and a direct chat. The models answer as in the full demo once a provider is connected. */
async function startEmpty({ imp, createChannelHub, createRouter, createHistoryHandler }) {
  await (await imp('src/core/agents.js')).loadAgents();
  const QR = (await import('qrcode')).default;
  const { bus } = await imp('src/core/events.js');
  const qrDataUrl = await QR.toDataURL('demo-not-a-real-whatsapp-link', { margin: 1, width: 240 });
  const P = (n) => `417900000${String(n).padStart(2, '0')}`;
  const groups = [['120363041122330001@g.us', 'Class 4B parents', 23], ['120363041122330002@g.us', 'Family ❤️', 9], ['120363041122330003@g.us', 'Morges ↔ Geneva rides', 14]];
  let linked = null;
  const factory = () => ({
    id: 'whatsapp',
    async start() {},
    async status() { return linked ? { status: 'open', me: `${P(99)}:1@s.whatsapp.net`, since: linked } : { status: 'qr', qrDataUrl }; },
    async listChats() { return linked ? groups.map(([id, name, size]) => ({ id, name, size })) : []; },
    async chatName(jid) { return groups.find((g) => g[0] === jid)?.[1] || ''; },
    async groupMembers() { return [1, 2, 3].map((i) => ({ phone: P(i), jid: `${P(i)}@s.whatsapp.net`, admin: i === 1 })); },
    async isMember() { return true; },
    async send() { return { msgId: `out-${Date.now()}` }; },
    async typing() {},
    async lookupNumber(phone) { return { jid: `${String(phone).replace(/\D/g, '')}@s.whatsapp.net`, exists: true, lid: '' }; },
    async pair() { setTimeout(() => { linked = Date.now(); bus.emit('status'); }, 3000).unref(); return 'DEMO-1234'; },
    async logout() { linked = null; bus.emit('status'); }, async restart() {}, async remove() {},
  });
  const { providerRoutes } = await imp('src/panel/routes/providers.js');
  const { startPanel } = await imp('src/panel/server.js');
  const wa = createChannelHub(factory);
  const panel = startPanel({ channel: wa, extend: [providerRoutes] });
  await new Promise((r) => (panel.listening ? r() : panel.once('listening', r)));
  await wa.start({ onMessage: createRouter(wa), onHistory: createHistoryHandler() }); // nothing set up yet: Link WhatsApp loads it
  return { base: `http://127.0.0.1:${panel.address().port}`, dataDir: process.env.DATA_DIR };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { base, dataDir } = await startDemo({ port: Number(process.argv[2] || 8099) });
  console.log(`Demo panel on ${base} — sign in as admin / ${DEMO_PASSWORD} (data in ${dataDir})`);
}
