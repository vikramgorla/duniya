// Lists and sending (082): People → Sending. The history of runs → a run's page (progress, pause / resume / stop, who
// got what), and New message: audience, purpose, who replies, the message → the preview (who, how many, which app,
// how long, who is skipped and why, three samples) → Start sending. Orders (Send reminders) and an event page (Message
// registered people) open New message prefilled. Loaded from people.js; every text from people or models is a text node.
import { $, S, api, ask, avatar, can, emptyState, field, h, menu, meterEl, time, toggle, tryApi } from './core.js';
import { helpLink, plural } from './shared.js';
import { day, peopleNav } from './people.js';
import { back, group, row, runPill } from './events.js';
const enc = encodeURIComponent;
const WAIT = { hours: 'Waiting for the sending hours', cap: 'Today\'s limit is reached: it carries on tomorrow by itself', offline: 'Waiting for WhatsApp to connect' };
const PERSON = { waiting: ['Waiting', ''], sending: ['Sending', 'info'], sent: ['Sent', ''], replied: ['Replied', 'ok'], stop: ['Said stop', 'warn'], skipped: ['Skipped', ''], failed: ['Failed', 'bad'] };
const pill = runPill;
const KINDS = [['list', 'A list'], ['tag', 'A tag'], ['household', 'A household'], ['event', 'People registered for an event'], ['orders', 'People with an open order'], ['saved', 'A saved audience']];
const FIELDS = [['Everyone', '{first_name} {household}'], ['Events', '{event} {date} {place} {people}'], ['Open orders', '{amount} {due} {ways_to_pay}'], ['Surveys', '{survey} {survey_link}']];
/** 085: the fields a message may use, behind a small disclosure instead of a long hint. */
const fieldsHelp = () => h('details', { class: 'small muted' }, h('summary', {}, 'Each person gets their own wording: fields you can use'), h('ul', { class: 'mini-list' }, FIELDS.map(([k, v]) => h('li', {}, `${k}: `, h('code', {}, v)))));
const countsLine = (c) => [`${c.reached} of ${c.total - c.skipped} sent`, c.replied + c.stop ? `${c.replied + c.stop} replied` : '', c.stop ? `${c.stop} said stop` : '',
  c.skipped ? `${c.skipped} skipped` : '', c.failed ? `${c.failed} failed` : ''].filter(Boolean).join(' · ');

/** #people/sending, #people/sending/new?…, #people/sending/<id> */
export function renderSending(b) {
  S.onFeed = null;
  if (b?.startsWith('new')) return newMessage(new URLSearchParams(b.split('?')[1] || ''));
  if (b?.startsWith('campaign/')) return b === 'campaign/new' ? newCampaign() : campaignPage(b.slice(9)); // 083
  return b ? runPage(b) : runList();
}

async function runList() {
  const g = await api('GET', '/api/sending');
  $('#main').replaceChildren(h('div', { class: 'card' }, peopleNav('people/sending'),
    h('div', { class: 'sec-head' }, h('h2', {}, 'Sending'), h('a', { class: 'btn small primary', href: '#people/sending/new' }, '+ New message'), helpLink('sending.md')),
    h('p', { class: 'small muted', style: 'margin:2px 0 0' }, 'One person at a time, at a person\'s pace, only to people who agreed. ', h('a', { href: '#settings/sending-pace' }, 'Sending pace')),
    g.runs.length ? group(`Messages (${g.runs.length})`, h('ul', {}, g.runs.map((r) => row(r.title, [r.audienceText, countsLine(r.counts), day(r.createdAt, true)].join(' · '),
      { href: `#people/sending/${enc(r.id)}`, end: h('span', { class: 'row-end' }, pill(r.status)) }))))
      : emptyState('list', 'Nothing sent yet', 'Message a list, an event\'s families or everyone who still owes: each person gets their own wording.',
        h('a', { class: 'btn primary', href: '#people/sending/new' }, 'New message')),
    group(`Campaigns (${g.campaigns.length})`, h('ul', {}, g.campaigns.map((c) => row(c.title, `${c.audienceText} · step ${Math.min(c.step + 1, c.steps.length)} of ${c.steps.length}`,
      { href: `#people/sending/campaign/${enc(c.id)}`, end: h('span', { class: 'row-end' }, pill(c.status, true)) })),
    can('admin') ? row('New campaign', 'Messages over days; follow-ups only to who has not answered, registered or paid', { href: '#people/sending/campaign/new', mark: h('span', { class: 'lmark c3', 'aria-hidden': 'true' }, '+') }) : null)),
    g.filters.length ? group('Saved audiences', h('ul', {}, g.filters.map((f) => row(f.name, f.text, { href: `#people/sending/new?saved=${enc(f.id)}`,
      end: can('admin') ? h('button', { class: 'btn small ghost icon rm', type: 'button', 'aria-label': `Remove ${f.name}`, title: 'Remove', onclick: () => tryApi(() => api('DELETE', `/api/sending/filters/${f.id}`), 'Removed').then(runList) }, '×') : null })))) : null));
}

/** The fields New message and New campaign share: title, who (audience), purpose, who replies, a survey (083). */
async function basics(q, { group = true } = {}) {
  const mods = S.status?.settings?.modulesOn || [];
  const [lists, homes, sum, agents, chats, saved, events, surveys] = await Promise.all([api('GET', '/api/lists'), api('GET', '/api/households'), api('GET', '/api/people/summary'),
    api('GET', '/api/agents'), group ? api('GET', '/api/chats') : [], api('GET', '/api/sending'), mods.includes('events') ? api('GET', '/api/module/events') : [],
    mods.includes('surveys') ? api('GET', '/api/surveys') : []]);
  const opts = (list, value, label = (x) => x.name) => list.map((x) => h('option', { value: x.id, selected: x.id === value }, label(x)));
  const F = {
    title: h('input', { value: q.get('title') || (q.get('kind') === 'orders' ? 'Payment reminder' : ''), placeholder: 'e.g. Picnic on Sunday', autocomplete: 'off' }),
    mode: h('select', {}, h('option', { value: 'direct' }, 'Each person in their own chat'), group ? h('option', { value: 'group' }, 'One post in a group') : null),
    kind: h('select', {}, KINDS.filter(([k]) => (k !== 'event' || mods.includes('events')) && (k !== 'orders' || mods.includes('orders')) && (k !== 'saved' || saved.filters.length))
      .map(([k, l]) => h('option', { value: k, selected: k === (q.get('saved') ? 'saved' : q.get('kind') || 'list') }, l))),
    list: h('select', {}, opts(lists, q.get('list'))), tag: h('select', {}, (sum?.tags || []).map((x) => h('option', { value: x.tag }, `${x.tag} (${x.count})`))),
    household: h('select', {}, opts(homes, q.get('household'))), event: h('select', {}, opts(events, q.get('event'))),
    orders: h('select', {}, h('option', { value: '' }, 'Any event'), opts(events, q.get('event'))), saved: h('select', {}, opts(saved.filters, q.get('saved'))),
    group: h('select', {}, chats.filter((c) => c.isGroup && c.enabled).map((c) => h('option', { value: c.id }, c.name))),
    purpose: h('select', {}, h('option', { value: 'updates' }, 'Updates (about things they take part in)'), h('option', { value: 'marketing' }, 'Marketing')),
    agent: h('select', {}, agents.filter((a) => !a.builtin && a.enabled).map((a) => h('option', { value: a.id }, a.name))),
  };
  const surveyPick = (value = '') => h('select', {}, h('option', { value: '' }, 'No survey'), opts(surveys.filter((x) => x.status === 'open'), value, (x) => x.title));
  const which = h('div', {});
  const to = field('To', F.kind);
  const showWhich = () => {
    which.replaceChildren(F.mode.value === 'group' ? field('Group', F.group, 'Groups that are on.') : field({ list: 'List', tag: 'Tag', household: 'Household', event: 'Event', orders: 'Orders of', saved: 'Saved audience' }[F.kind.value], F[F.kind.value]));
    to.hidden = F.mode.value === 'group';
  };
  F.kind.onchange = showWhich; F.mode.onchange = showWhich;
  const audience = () => {
    const k = F.kind.value;
    if (k === 'saved') return saved.filters.find((f) => f.id === F.saved.value)?.audience;
    return k === 'orders' ? { kind: k, event: F.orders.value } : { kind: k, [k]: F[k].value };
  };
  showWhich();
  return { F, mods, events, surveys, surveyPick, which, to, audience };
}

async function newMessage(q) {
  const { F, surveys, surveyPick, which, to, audience } = await basics(q);
  const rem = q.get('kind') === 'orders' ? await api('GET', `/api/order-reminders?event=${enc(q.get('event') || '')}`) : null;
  F.template = h('textarea', { rows: 4, placeholder: 'Hi {first_name}, …', maxlength: 1500 }, rem?.template || (q.get('survey') ? 'Hi {first_name}, a few quick questions about {survey}: answer here in the chat, or at {survey_link}' : ''));
  F.quiet = h('input', { type: 'number', min: 0, max: 500, value: rem ? 0 : 20 });
  F.survey = surveyPick(q.get('survey') || '');
  const out = h('div', { 'aria-live': 'polite' });
  const body = () => ({ title: F.title.value, mode: F.mode.value, group: F.group.value, audience: audience(), purpose: F.purpose.value, agent: F.agent.value, template: F.template.value, noReplyLimit: Number(F.quiet.value), survey: F.survey.value });
  const saveAudience = async () => {
    const name = h('input', { autocomplete: 'off', placeholder: 'e.g. Families with kids' });
    if (await ask({ title: 'Save this audience', ok: 'Save', body: field('Name', name) })) tryApi(() => api('POST', '/api/sending/filters', { name: name.value, audience: audience() }), 'Saved');
  };
  const previewIt = async () => {
    const p = await tryApi(() => api('POST', '/api/sending/preview', body()));
    if (!p) return;
    const est = p.estimate.days > 1 ? `about ${p.estimate.days} days` : `about ${plural(p.estimate.minutes, 'minute')}`;
    out.replaceChildren(h('div', { class: 'sblock', style: 'margin-top:12px' },
      h('h3', {}, 'Preview'),
      h('p', {}, p.run.mode === 'group' ? 'One post in the group.' : `${plural(p.to.total, 'person', 'people')} get it${p.to.telegram ? ` (${p.to.whatsapp} on WhatsApp, ${p.to.telegram} on Telegram)` : ''}, ${est} at the current pace.`),
      p.to.neverWrote ? h('p', { class: 'small muted' }, `${plural(p.to.neverWrote, 'person has', 'people have')} never written to this number: they get it more slowly and count toward today's limit of new chats.`) : null,
      p.chatsToSwitchOn ? h('p', { class: 'small muted' }, `${plural(p.chatsToSwitchOn, 'direct chat')} will be switched on with ${p.run.agentName}, so replies reach it.`) : null,
      p.samples.length ? group('Samples (each person gets their own wording)', h('ul', { class: 'mini-list' }, p.samples.map((s) => h('li', {}, h('b', {}, s.to), h('div', { class: 'small', style: 'white-space:pre-wrap' }, s.text))))) : null,
      p.skipped.length ? h('details', { class: 'sblock' }, h('summary', {}, `Skipped (${p.skipped.length})`), h('ul', { class: 'mini-list' }, p.skipped.map((s) => h('li', {}, `${s.name}: ${s.reason}`)))) : null,
      h('div', { class: 'row', style: 'gap:8px;margin-top:10px' },
        p.to.total ? h('button', { class: 'btn primary', type: 'button', onclick: async () => { const r = await tryApi(() => api('POST', `/api/sending/runs/${p.run.id}/start`), 'Sending started'); if (r) location.hash = `people/sending/${r.id}`; } }, `Send to ${plural(p.to.total, 'person', 'people')}`) : h('p', { class: 'muted' }, 'Nobody would get it: see who is skipped and why.')),
      p.to.total ? h('p', { class: 'small muted' }, 'Bulk messages can get a WhatsApp number restricted: send only to people who expect it.') : null));
    out.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  $('#main').replaceChildren(h('div', { class: 'card' }, back('#people/sending', 'Sending'),
    h('div', { class: 'sec-head' }, h('h2', { tabindex: '-1' }, 'New message'), helpLink('sending.md')),
    field('Title', F.title, 'Only you see it.'), field('How', F.mode), to, which,
    h('div', { class: 'grid2' }, field('Purpose', F.purpose, 'Only people who said yes to it get it.'), field('Replies go to', F.agent)),
    field('Message', F.template), fieldsHelp(),
    surveys.length ? field('Survey (optional)', F.survey) : null,
    h('details', { class: 'sblock' }, h('summary', {}, 'More options'), field('Pause when this many in a row do not answer', F.quiet, '0 = never (for reminders nobody needs to answer).'),
      h('button', { class: 'btn small', type: 'button', onclick: saveAudience }, 'Save this audience…')),
    h('div', { class: 'row', style: 'gap:8px;margin-top:12px' }, h('button', { class: 'btn primary', type: 'button', onclick: previewIt }, 'Preview')),
    out));
  $('#main h2')?.focus({ preventScroll: true });
}

async function runPage(id) {
  const g = await api('GET', `/api/sending/runs/${enc(id)}`).catch(() => null);
  const bk = back('#people/sending', 'Sending');
  if (!g) { $('#main').replaceChildren(h('div', { class: 'card' }, bk, h('p', { class: 'muted' }, 'This message is gone.'))); return; }
  const { run: r, recipients } = g;
  const here = location.hash;
  let soon;
  S.onFeed = (a) => { if (location.hash !== here) { S.onFeed = null; return; } if (/List message|Sending /.test(a.summary || '')) { clearTimeout(soon); soon = setTimeout(() => runPage(id), 400); } };
  document.title = `${r.title} · Duniya`;
  const act = (action, ok) => tryApi(() => api('PUT', `/api/sending/runs/${r.id}`, { action }), ok).then((x) => x && runPage(id));
  const stop = async () => (await ask({ title: `Stop "${r.title}"?`, danger: true, ok: 'Stop sending', text: `${plural(r.counts.waiting, 'person', 'people')} who have not got it yet will not get it. This cannot be undone.` })) && act('stop', 'Stopped');
  const m = meterEl(); m.set(r.counts.total - r.counts.skipped ? r.counts.reached / (r.counts.total - r.counts.skipped) : 0);
  const by = (s) => recipients.filter((x) => x.status === s);
  // 085: one person per row: avatar · name · state and time (the wording they got, quoted) · state pill; the row opens the person
  const live = ['running', 'paused'].includes(r.status);
  const who = (x) => h('li', { class: 'has-end' }, h(x.person.startsWith('p_') ? 'a' : 'div', { class: 'lrow', href: x.person.startsWith('p_') ? `#people/${enc(x.person)}` : null }, avatar(x.name, x.person, 's'),
    h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, x.name),
      h('span', { class: 'lrow-sub' }, [x.channel === 'telegram' ? 'Telegram' : '', x.reason, x.repliedAt ? `replied ${time(x.repliedAt)}` : x.at ? time(x.at) : x.status === 'waiting' ? (live ? 'in the queue' : 'not sent') : ''].filter(Boolean).join(' · ')),
      x.text ? h('span', { class: 'quote' }, x.text) : null)),
  h('span', { class: 'row-end' }, h('span', { class: `pill ${PERSON[x.status]?.[1] || ''}` }, PERSON[x.status]?.[0] || x.status)));
  const sentList = [...by('replied'), ...by('stop'), ...by('sent')];
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, bk,
    h('div', { class: 'ap-head' }, h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, r.title), h('div', { class: 'small muted' }, `${r.audienceText} · ${r.purpose} · replies go to ${r.agentName || r.agent}`)),
      can('admin') && ['running', 'paused'].includes(r.status) ? menu(`More for ${r.title}`, h('button', { class: 'btn small danger', type: 'button', onclick: stop }, 'Stop…')) : null),
    h('p', { class: 'small', style: 'margin:8px 0 0' }, pill(r.status), ` ${countsLine(r.counts)}`),
    m,
    r.status === 'paused' && r.reason ? h('p', { class: 'small', role: 'status' }, r.reason) : null,
    r.status === 'running' && r.wait ? h('p', { class: 'small muted', role: 'status' }, WAIT[r.wait] || r.wait) : null,
    can('admin') ? h('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
      r.status === 'running' ? h('button', { class: 'btn', type: 'button', onclick: () => act('pause', 'Paused') }, 'Pause') : null,
      r.status === 'paused' ? h('button', { class: 'btn primary', type: 'button', onclick: () => act('resume', 'Resumed') }, 'Resume') : null) : null,
    group('The message', h('p', { class: 'quote', style: 'margin:0 10px' }, r.template)),
    sentList.length ? group(`Sent (${sentList.length})`, h('ul', {}, sentList.map(who))) : null,
    by('waiting').length ? group(`${live ? 'Waiting' : 'Not sent'} (${by('waiting').length})`, h('ul', {}, by('waiting').slice(0, 50).map(who))) : null,
    by('failed').length ? group(`Failed (${by('failed').length})`, h('ul', {}, by('failed').map(who))) : null,
    by('skipped').length ? h('details', { class: 'sblock' }, h('summary', {}, `Skipped (${by('skipped').length})`), h('ul', { class: 'mini-list' }, by('skipped').map((x) => h('li', {}, `${x.name}: ${x.reason}`)))) : null));
  $('#main h2')?.focus({ preventScroll: true });
}

// ---------- Campaigns (083) ----------
const STOPS = [['replied', 'They replied (or said stop)'], ['registered', 'They registered for the event'], ['paid', 'They paid for the event'], ['answered', 'They finished the survey']];
async function newCampaign() {
  const { F, mods, events, surveys, surveyPick, which, to, audience } = await basics(new URLSearchParams(), { group: false });
  const steps = [{ kind: 'message', template: '', survey: '' }, { kind: 'wait', days: 3 }, { kind: 'message', template: '', survey: '' }];
  const list = h('div', {});
  const draw = () => list.replaceChildren(...steps.map((st, i) => h('div', { class: 'sblock' },
    st.kind === 'wait' ? field(`Step ${i + 1}: wait this many days`, h('input', { type: 'number', min: 1, max: 90, value: st.days, oninput: (e) => { st.days = Number(e.target.value); } }))
      : [field(`Step ${i + 1}: message`, h('textarea', { rows: 3, maxlength: 1500, placeholder: i ? 'Hi {first_name}, a quick reminder…' : 'Hi {first_name}, …', oninput: (e) => { st.template = e.target.value; } }, st.template)),
        surveys.length ? field('Survey (optional)', (() => { const sel = surveyPick(st.survey); sel.onchange = () => { st.survey = sel.value; }; return sel; })()) : null],
    i ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { steps.splice(i, 1); draw(); } }, 'Remove step') : null)));
  draw();
  const stops = Object.fromEntries(STOPS.map(([k]) => [k, k === 'replied']));
  const event = h('select', {}, h('option', { value: '' }, 'The audience\'s event'), events.map((e) => h('option', { value: e.id }, e.name)));
  const end = h('input', { type: 'date' });
  const out = h('div', { 'aria-live': 'polite' });
  const body = () => ({ title: F.title.value, audience: audience(), purpose: F.purpose.value, agent: F.agent.value, steps, stops, event: event.value, endDay: end.value });
  const previewIt = async () => {
    const p = await tryApi(() => api('POST', '/api/sending/campaigns/preview', body()));
    if (!p) return;
    out.replaceChildren(h('div', { class: 'sblock', style: 'margin-top:12px' }, h('h3', {}, 'Preview'), h('p', {}, p.line),
      p.first.skipped.length ? h('details', { class: 'sblock' }, h('summary', {}, `Skipped at step 1 (${p.first.skipped.length})`), h('ul', { class: 'mini-list' }, p.first.skipped.map((x) => h('li', {}, `${x.name}: ${x.reason}`)))) : null,
      h('button', { class: 'btn primary', type: 'button', onclick: async () => { const c = await tryApi(() => api('POST', `/api/sending/campaigns/${p.campaign.id}/start`), 'Campaign started'); if (c) location.hash = `people/sending/campaign/${c.id}`; } }, 'Start the campaign')));
    out.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  $('#main').replaceChildren(h('div', { class: 'card' }, back('#people/sending', 'Sending'),
    h('div', { class: 'sec-head' }, h('h2', { tabindex: '-1' }, 'New campaign'), helpLink('campaigns.md')),
    field('Title', F.title), to, which, h('div', { class: 'grid2' }, field('Purpose', F.purpose), field('Replies go to', F.agent)),
    h('h3', {}, 'Steps'), fieldsHelp(), list,
    h('div', { class: 'row', style: 'gap:8px' }, h('button', { class: 'btn small', type: 'button', onclick: () => { steps.push({ kind: 'message', template: '', survey: '' }); draw(); } }, '+ Message'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { steps.push({ kind: 'wait', days: 3 }); draw(); } }, '+ Wait')),
    h('h3', {}, 'Follow-ups skip people when'),
    STOPS.filter(([k]) => (k !== 'registered' || mods.includes('events')) && (k !== 'paid' || mods.includes('orders')) && (k !== 'answered' || surveys.length))
      .map(([k, l]) => h('div', { class: 'row' }, toggle(stops[k], (on) => { stops[k] = on; }, false, l), h('span', {}, l))),
    mods.includes('events') ? field('Event (for registered and paid)', event) : null, field('Last day (optional)', end, 'Nothing is sent after it.'),
    h('button', { class: 'btn primary', type: 'button', onclick: previewIt }, 'Preview'), out));
  $('#main h2')?.focus({ preventScroll: true });
}

async function campaignPage(id) {
  const c = await api('GET', `/api/sending/campaigns/${enc(id)}`).catch(() => null);
  const bk = back('#people/sending', 'Sending');
  if (!c) { $('#main').replaceChildren(h('div', { class: 'card' }, bk, h('p', { class: 'muted' }, 'This campaign is gone.'))); return; }
  document.title = `${c.title} · Duniya`;
  const here = location.hash; let soon;
  S.onFeed = (a) => { if (location.hash !== here) { S.onFeed = null; return; } if (/List message|Sending |Campaign /.test(a.summary || '')) { clearTimeout(soon); soon = setTimeout(() => campaignPage(id), 400); } };
  const act = (action, ok) => tryApi(() => api('PUT', `/api/sending/campaigns/${c.id}`, { action }), ok).then((x) => x && campaignPage(id));
  const stop = async () => (await ask({ title: `Stop "${c.title}"?`, danger: true, ok: 'Stop the campaign', text: 'Its current step stops too and no later step is sent. This cannot be undone.' })) && act('stop', 'Stopped');
  const stepLine = (st, i) => {
    const state = st.run ? countsLine(st.run.counts) : st.current && st.kind === 'wait' ? `next step ${day(c.stepAt + st.days * 86400000, true)}` : i < c.step ? 'Done' : c.status === 'stopped' ? 'Not sent' : 'Not started';
    return row(st.kind === 'wait' ? `${i + 1}. Wait ${plural(st.days, 'day')}` : `${i + 1}. ${st.template}`, `${st.current && st.kind !== 'wait' ? 'Now · ' : ''}${state}${st.survey ? ' · with a survey' : ''}`,
      { href: st.run ? `#people/sending/${enc(st.run.id)}` : null, end: st.run ? h('span', { class: 'row-end' }, pill(st.run.status)) : null });
  };
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, bk,
    h('div', { class: 'ap-head' }, h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, c.title), h('div', { class: 'small muted' }, `${c.audienceText} · ${c.purpose}${c.endDay ? ` · until ${day(c.endDay)}` : ''}`)),
      can('admin') && ['running', 'paused'].includes(c.status) ? menu(`More for ${c.title}`, h('button', { class: 'btn small danger', type: 'button', onclick: stop }, 'Stop…')) : null),
    h('p', { class: 'small', style: 'margin:8px 0 0' }, pill(c.status, true), ` Step ${Math.min(c.step + 1, c.steps.length)} of ${c.steps.length}`),
    c.reason ? h('p', { class: 'small', role: 'status' }, c.reason) : null,
    can('admin') ? h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, c.status === 'running' ? h('button', { class: 'btn', type: 'button', onclick: () => act('pause', 'Paused') }, 'Pause') : null,
      c.status === 'paused' ? h('button', { class: 'btn primary', type: 'button', onclick: () => act('resume', 'Resumed') }, 'Resume') : null) : null,
    group('Steps', h('ul', {}, c.steps.map(stepLine))),
    h('p', { class: 'small muted' }, `Follow-ups skip people when: ${STOPS.filter(([k]) => c.stops[k]).map(([, l]) => l.toLowerCase()).join('; ') || 'never (everyone gets every message)'}. Consent and the sending pace apply to every step.`)));
  $('#main h2')?.focus({ preventScroll: true });
}
