// @ts-check
// Modules (081): Settings → Modules (on/off), the module tools for agent tool lists, and the Events and Orders pages;
// 082: Lists and sending (runs with a preview, pause / resume / stop, saved audiences) and payment reminders.
// The module code loads with import() only when it is on (need() answers 409 with the reason when it is off).
import { MODULES, moduleRows, moduleSections, need, setModuleOn, liveModules } from '../../modules/index.js';
import { PAGE_CSP, clientIp, esc, limiter, pageHead, send } from '../http.js';
import { baseUrl } from '../http-util.js';

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
  route('GET', '/api/modules/tools', async () => liveModules().map((m) => ({ id: m.id, label: MODULES.find((x) => x.id === m.id)?.label || m.id, line: MODULES.find((x) => x.id === m.id)?.line || '', changes: m.tools.some((t) => t.annotations?.readOnlyHint !== true),
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
  route('GET', '/api/orders/:id', async (req, res, body, q, p) => { const m = await ord(); return { ...m.getOrder(p.id), methods: m.paymentMethods() }; }, admin);
  route('PUT', '/api/orders/:id', async (req, res, body, q, p, user) => (await ord()).updateOrder(p.id, body, user.username), admin);
  route('DELETE', '/api/orders/:id', async (req, res, body, q, p, user) => (await ord()).deleteOrder(p.id, user.username), admin);
  route('POST', '/api/orders/:id/payments', async (req, res, body, q, p, user) => [201, (await ord()).addPayment(p.id, body, user.username)], admin);
  route('DELETE', '/api/orders/:id/payments/:pay', async (req, res, body, q, p, user) => (await ord()).removePayment(p.id, p.pay, user.username), admin);
  // 082: payment reminders to people (through Lists and sending): the message to start from, automatic ones per event
  route('GET', '/api/order-reminders', async (req, res, body, q) => { const m = await ord(); return { template: m.reminderTemplate(q.get('event') || ''), auto: m.autoReminders() }; }, admin);
  route('PUT', '/api/order-reminders/:event', async (req, res, body, q, p, user) => ({ auto: (await ord()).setAutoReminders(p.event, body, user.username) }), admin);

  // ---------- Lists and sending (082) ----------
  const snd = () => need('sending');
  route('GET', '/api/sending', async () => { const m = await snd(); return { runs: m.listRuns(), filters: m.listFilters(), campaigns: (await import('../../modules/sending/campaigns.js')).listCampaigns() }; }, admin);
  route('POST', '/api/sending/preview', async (req, res, body, q, p, user) => (await snd()).preview(body, user.username), admin);
  route('GET', '/api/sending/runs/:id', async (req, res, body, q, p) => (await snd()).runPage(p.id, q.get('status') || ''), admin);
  route('POST', '/api/sending/runs/:id/start', async (req, res, body, q, p, user) => (await snd()).startRun(p.id, user.username), admin);
  route('PUT', '/api/sending/runs/:id', async (req, res, body, q, p, user) => (await snd()).controlRun(p.id, String(body.action || ''), user.username), admin);
  route('POST', '/api/sending/filters', async (req, res, body) => [201, (await snd()).saveFilter(body)], admin);
  route('DELETE', '/api/sending/filters/:id', async (req, res, body, q, p) => (await snd()).deleteFilter(p.id), admin);
  // 083: campaigns (sequences of sends, confirmed once)
  const cmp = async () => { await snd(); return import('../../modules/sending/campaigns.js'); };
  route('POST', '/api/sending/campaigns/preview', async (req, res, body, q, p, user) => (await cmp()).campaignPreview(body, user.username), admin);
  route('GET', '/api/sending/campaigns/:id', async (req, res, body, q, p) => (await cmp()).getCampaign(p.id), admin);
  route('POST', '/api/sending/campaigns/:id/start', async (req, res, body, q, p, user) => (await cmp()).startCampaign(p.id, user.username), admin);
  route('PUT', '/api/sending/campaigns/:id', async (req, res, body, q, p, user) => (await cmp()).controlCampaign(p.id, String(body.action || ''), user.username), admin);

  // ---------- Surveys (083) ----------
  const srv = () => need('surveys');
  route('GET', '/api/surveys', async (req) => { const m = await srv(); m.noteBase(baseUrl(req)); return m.listSurveys(); }, admin);
  route('POST', '/api/surveys', async (req, res, body, q, p, user) => [201, (await srv()).saveSurvey({ ...body, id: undefined }, user.username)], admin);
  route('GET', '/api/surveys/:id', async (req, res, body, q, p) => (await srv()).results(p.id), admin);
  route('PUT', '/api/surveys/:id', async (req, res, body, q, p, user) => (await srv()).saveSurvey({ ...body, id: p.id }, user.username), admin);
  route('DELETE', '/api/surveys/:id', async (req, res, body, q, p, user) => (await srv()).deleteSurvey(p.id, user.username), admin);
  route('GET', '/api/surveys/:id/csv', async (req, res, body, q, p) => { const m = await srv(); return sendCsv(res, `${slug(m.getSurvey(p.id).title)}-answers`, m.csvRows(p.id)); }, admin);
  // the public page behind a person's link: no login; the token is the key; a plain form, every text escaped
  const pageLimit = limiter(30);
  const surveyPage = async (req, res, p, form = null) => {
    const html = (title, inner, status = 200) => { send(res, status, `${pageHead(title)}\n<body><main>${inner}</main>`, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); return null; };
    if (pageLimit(clientIp(req)) || pageLimit(`t:${p.token}`)) return html('Please wait', '<h1>Too many tries</h1><p>Wait a minute and open the link again.</p>', 429);
    const m = liveModules().some((x) => x.id === 'surveys') ? await srv() : null;
    const t = m?.byToken(p.token);
    if (!t) return html('Link not valid', '<h1>This link does not work</h1><p>It may be old or the survey may be closed. Ask the person who sent it for a new one.</p>', 404);
    const { survey: s } = t;
    let answers = t.answers; let error = ''; let done = t.done && !form;
    if (s.status !== 'open') return html(s.title, `<h1>${esc(s.title)}</h1><p>This survey is closed. Thank you!</p>`);
    if (form) {
      const given = Object.fromEntries(s.questions.map((q) => [q.id, q.kind === 'multi' ? form.getAll(q.id) : form.get(q.id) ?? '']));
      try { const r = m.answer(s.id, t.person, given, 'link'); done = r.done; if (!done) error = 'Please answer the questions marked *.'; } catch (e) { error = e.message; }
      answers = { ...answers, ...given };
    }
    if (done) return html(s.title, `<h1>Thank you!</h1><p>Your answers to “${esc(s.title)}” are saved. You can close this page.</p>`);
    const field = (q) => {
      const a = answers[q.id]; const req2 = q.required ? ' *' : '';
      if (q.kind === 'single' || q.kind === 'multi') return `<fieldset><legend>${esc(q.text)}${req2}</legend>${q.options.map((o) => `<label class=opt><input type=${q.kind === 'multi' ? 'checkbox' : 'radio'} name="${esc(q.id)}" value="${esc(o)}"${[].concat(a ?? []).includes(o) ? ' checked' : ''}> ${esc(o)}</label>`).join('')}</fieldset>`;
      return `<label for="${esc(q.id)}">${esc(q.text)}${req2}</label><input type=text${q.kind === 'number' ? ' inputmode=decimal' : ''} id="${esc(q.id)}" name="${esc(q.id)}" value="${esc(a ?? '')}" maxlength=500${q.required ? ' required' : ''}>`;
    };
    return html(s.title, `<h1>${esc(s.title)}</h1>${s.intro ? `<p>${esc(s.intro)}</p>` : ''}${error ? `<p class="note bad" role=alert>${esc(error)}</p>` : ''}
<form method=post>${s.questions.map(field).join('')}<div class=actions><button type=submit>Send my answers</button></div></form><p class=small>Only the people who run this survey see your answers.</p>`, error ? 400 : 200);
  };
  route('GET', '/s/:token', async (req, res, body, q, p) => surveyPage(req, res, p), { public: true });
  route('POST', '/s/:token', async (req, res, body, q, p) => surveyPage(req, res, p, body), { public: true, form: true });
}
