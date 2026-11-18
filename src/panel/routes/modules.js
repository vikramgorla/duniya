// @ts-check
// Modules (081): Settings → Modules (on/off), the module tools for agent tool lists, and the Events and Orders pages.
// The module code loads with import() only when it is on (need() answers 409 with the reason when it is off).
import { MODULES, moduleRows, moduleSections, need, setModuleOn, liveModules } from '../../modules/index.js';
import { send } from '../http.js';

/** CSV with every cell quoted; cells that a spreadsheet would run as a formula start with an apostrophe. */
const csv = (rows) => `${rows.map((r) => r.map((v) => { const s = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; }).join(',')).join('\r\n')}\r\n`;
const sendCsv = (res, name, rows) => { send(res, 200, csv(rows), { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"`, 'cache-control': 'no-store' }); return null; };
const slug = (s) => String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'export';

/** @param {import('../http.js').Route} route */
export function moduleRoutes(route) {
  const admin = { role: /** @type {'admin'} */ ('admin') };
  route('GET', '/api/modules', async () => ({ modules: moduleRows(), methods: liveModules().some((m) => m.id === 'orders') ? (await need('orders')).paymentMethods() : null }), { role: 'viewer' });
  route('PUT', '/api/modules/:id', async (req, res, body, q, p, user) => {
    if (typeof body.on !== 'boolean') return [400, { error: 'on must be true or false', field: 'on' }];
    return { modules: await setModuleOn(p.id, body.on, user.username) };
  }, admin);
  // the tools of the modules that are on, for an agent's tool list (all / none per role, like WhatsApp actions)
  route('GET', '/api/modules/tools', async () => liveModules().map((m) => ({ id: m.id, label: MODULES.find((x) => x.id === m.id)?.label || m.id,
    tools: m.tools.map((t) => ({ name: t.name, description: t.description, organizerOnly: !t.roles.includes('participant'), participantDefault: !!t.participantDefault })) })), { role: 'viewer' });
  route('PUT', '/api/orders/methods', async (req, res, body, q, p, user) => ({ methods: (await need('orders')).setPaymentMethods(body.methods, user.username) }), admin);

  // ---------- Events ----------
  const ev = () => need('events');
  route('GET', '/api/module/events', async (req, res, body, q) => (await ev()).listEvents({ past: q.get('past') === '1' }), admin);
  route('POST', '/api/module/events', async (req, res, body, q, p, user) => [201, (await ev()).saveEvent({ ...body, id: undefined }, user.username)], admin);
  route('GET', '/api/module/events/:id', async (req, res, body, q, p) => ({ ...(await ev()).eventPage(p.id), modules: moduleSections('event', p.id) }), admin);
  route('PUT', '/api/module/events/:id', async (req, res, body, q, p, user) => (await ev()).saveEvent({ ...body, id: p.id }, user.username), admin);
  route('DELETE', '/api/module/events/:id', async (req, res, body, q, p, user) => (await ev()).deleteEvent(p.id, user.username), admin);
  route('GET', '/api/module/events/:id/csv', async (req, res, body, q, p) => { const m = await ev(); return sendCsv(res, `${slug(m.getEvent(p.id).name)}-registrations`, m.csvRows(p.id)); }, admin);
  route('POST', '/api/module/events/:id/registrations', async (req, res, body, q, p, user) => [201, (await ev()).register({ ...body, event: p.id }, { by: user.username, organizer: true })], admin);
  route('PUT', '/api/module/registrations/:id', async (req, res, body, q, p, user) => (await ev()).updateRegistration(p.id, body, user.username), admin);
  route('POST', '/api/module/events/:id/duties', async (req, res, body, q, p, user) => (await ev()).saveDuty({ ...body, id: '', event: p.id }, user.username), admin);
  route('PUT', '/api/module/duties/:id', async (req, res, body, q, p, user) => (await ev()).saveDuty({ ...body, id: p.id }, user.username), admin);
  route('DELETE', '/api/module/duties/:id', async (req, res, body, q, p) => (await ev()).deleteDuty(p.id), admin);
  route('PUT', '/api/module/duties/:id/people/:person', async (req, res, body, q, p, user) => (await ev()).takeDuty(p.id, p.person, user.username, body.on !== false), admin);

  // ---------- Orders and payments ----------
  const ord = () => need('orders');
  const filter = (q) => ({ status: q.get('status') || 'open', event: q.get('event') || '' });
  route('GET', '/api/orders', async (req, res, body, q) => (await ord()).ordersPage(filter(q)), admin);
  route('GET', '/api/orders/csv', async (req, res, body, q) => sendCsv(res, `orders-${filter(q).status}`, (await ord()).csvRows(filter(q))), admin);
  route('POST', '/api/orders', async (req, res, body, q, p, user) => [201, (await ord()).createOrder(body, user.username)], admin);
  route('GET', '/api/orders/:id', async (req, res, body, q, p) => (await ord()).getOrder(p.id), admin);
  route('PUT', '/api/orders/:id', async (req, res, body, q, p, user) => (await ord()).updateOrder(p.id, body, user.username), admin);
  route('DELETE', '/api/orders/:id', async (req, res, body, q, p, user) => (await ord()).deleteOrder(p.id, user.username), admin);
  route('POST', '/api/orders/:id/payments', async (req, res, body, q, p, user) => [201, (await ord()).addPayment(p.id, body, user.username)], admin);
  route('DELETE', '/api/orders/:id/payments/:pay', async (req, res, body, q, p, user) => (await ord()).removePayment(p.id, p.pay, user.username), admin);
}
