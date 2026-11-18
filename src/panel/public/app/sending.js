// Lists and sending (082): People → Sending. The history of runs → a run's page (progress, pause / resume / stop, who
// got what), and New message: audience, purpose, who replies, the message → the preview (who, how many, which app,
// how long, who is skipped and why, three samples) → Start sending. Orders (Send reminders) and an event page (Message
// registered people) open New message prefilled. Loaded from people.js; every text from people or models is a text node.
import { $, S, api, ask, can, emptyState, field, h, menu, meterEl, time, tryApi } from './core.js';
import { helpLink, plural } from './shared.js';
import { peopleNav } from './people.js';
import { back, group, row } from './events.js';
const enc = encodeURIComponent;
const STATE = { running: ['Sending', 'info'], paused: ['Paused', 'warn'], stopped: ['Stopped', ''], done: ['Done', 'ok'], draft: ['Draft', ''] };
const WAIT = { hours: 'Waiting for the sending hours', cap: 'Today\'s limit is reached: it carries on tomorrow by itself', offline: 'Waiting for WhatsApp to connect' };
const PERSON = { waiting: 'Waiting', sending: 'Sending', sent: 'Sent', replied: 'Replied', stop: 'Said stop', skipped: 'Skipped', failed: 'Failed' };
const pill = (s) => h('span', { class: `pill ${STATE[s]?.[1] || ''}` }, STATE[s]?.[0] || s);
const KINDS = [['list', 'A list'], ['tag', 'A tag'], ['household', 'A household'], ['event', 'People registered for an event'], ['orders', 'People with an open order'], ['saved', 'A saved audience']];
const FIELDS = '{first_name} {household} · events: {event} {date} {place} {people} · open orders: {amount} {due} {ways_to_pay}';
const countsLine = (c) => [`${c.reached} of ${c.total - c.skipped} sent`, c.replied + c.stop ? `${c.replied + c.stop} replied` : '', c.stop ? `${c.stop} said stop` : '',
  c.skipped ? `${c.skipped} skipped` : '', c.failed ? `${c.failed} failed` : ''].filter(Boolean).join(' · ');

/** #people/sending, #people/sending/new?…, #people/sending/<id> */
export function renderSending(b) {
  S.onFeed = null;
  if (b?.startsWith('new')) return newMessage(new URLSearchParams(b.split('?')[1] || ''));
  return b ? runPage(b) : runList();
}

async function runList() {
  const g = await api('GET', '/api/sending');
  $('#main').replaceChildren(h('div', { class: 'card' }, peopleNav('people/sending'),
    h('div', { class: 'sec-head' }, h('h2', {}, `Sending (${g.runs.length})`), h('a', { class: 'btn small primary', href: '#people/sending/new' }, '+ New message'), helpLink('sending.md')),
    g.runs.length ? h('ul', { class: 'people-list', style: 'margin-top:10px' }, g.runs.map((r) => row(r.title, [r.audienceText, countsLine(r.counts), time(r.createdAt)].join(' · '),
      { href: `#people/sending/${enc(r.id)}`, end: h('span', { class: 'row-end' }, pill(r.status)) })))
      : emptyState('list', 'Nothing sent yet', 'Send a message to a list, a tag, a household, an event or people who still owe: each person gets their own wording, one at a time at a person\'s pace, and only if they agreed.',
        h('a', { class: 'btn primary', href: '#people/sending/new' }, 'New message')),
    g.filters.length ? group('Saved audiences', h('ul', {}, g.filters.map((f) => row(f.name, f.text, { href: `#people/sending/new?saved=${enc(f.id)}`,
      end: can('admin') ? h('button', { class: 'btn small ghost icon rm', type: 'button', 'aria-label': `Remove ${f.name}`, title: 'Remove', onclick: () => tryApi(() => api('DELETE', `/api/sending/filters/${f.id}`), 'Removed').then(runList) }, '×') : null })))) : null,
    h('p', { class: 'small muted' }, 'Pacing lowers the risk that WhatsApp restricts your number, but does not remove it; WhatsApp\'s terms restrict bulk messaging. Send only to people who expect it. ',
      h('a', { href: '#settings/sending-pace' }, 'Sending pace'))));
}

async function newMessage(q) {
  const mods = S.status?.settings?.modulesOn || [];
  const [lists, homes, sum, agents, chats, saved, events, rem] = await Promise.all([api('GET', '/api/lists'), api('GET', '/api/households'), api('GET', '/api/people/summary'),
    api('GET', '/api/agents'), api('GET', '/api/chats'), api('GET', '/api/sending'), mods.includes('events') ? api('GET', '/api/module/events') : [],
    q.get('kind') === 'orders' ? api('GET', `/api/order-reminders?event=${enc(q.get('event') || '')}`) : null]);
  const opts = (list, value, label = (x) => x.name) => list.map((x) => h('option', { value: x.id, selected: x.id === value }, label(x)));
  const F = {
    title: h('input', { value: q.get('title') || (rem ? 'Payment reminder' : ''), placeholder: 'e.g. Picnic on Sunday', autocomplete: 'off' }),
    mode: h('select', {}, h('option', { value: 'direct' }, 'Each person in their own chat'), h('option', { value: 'group' }, 'One post in a group')),
    kind: h('select', {}, KINDS.filter(([k]) => (k !== 'event' || mods.includes('events')) && (k !== 'orders' || mods.includes('orders')) && (k !== 'saved' || saved.filters.length))
      .map(([k, l]) => h('option', { value: k, selected: k === (q.get('saved') ? 'saved' : q.get('kind') || 'list') }, l))),
    list: h('select', {}, opts(lists, q.get('list'))), tag: h('select', {}, (sum?.tags || []).map((x) => h('option', { value: x.tag }, `${x.tag} (${x.count})`))),
    household: h('select', {}, opts(homes, q.get('household'))), event: h('select', {}, opts(events, q.get('event'))),
    orders: h('select', {}, h('option', { value: '' }, 'Any event'), opts(events, q.get('event'))), saved: h('select', {}, opts(saved.filters, q.get('saved'))),
    group: h('select', {}, chats.filter((c) => c.isGroup && c.enabled).map((c) => h('option', { value: c.id }, c.name))),
    purpose: h('select', {}, h('option', { value: 'updates' }, 'Updates (about things they take part in)'), h('option', { value: 'marketing' }, 'Marketing')),
    agent: h('select', {}, agents.filter((a) => !a.builtin && a.enabled).map((a) => h('option', { value: a.id }, a.name))),
    template: h('textarea', { rows: 4, placeholder: 'Hi {first_name}, …', maxlength: 1500 }, rem?.template || q.get('text') || ''),
    quiet: h('input', { type: 'number', min: 0, max: 500, value: rem ? 0 : 20 }),
  };
  const which = h('div', {});
  const showWhich = () => {
    const k = F.kind.value;
    which.replaceChildren(F.mode.value === 'group' ? field('Group', F.group, 'Groups that are on.') : field({ list: 'List', tag: 'Tag', household: 'Household', event: 'Event', orders: 'Orders of', saved: 'Saved audience' }[k], F[k]));
    to.hidden = F.mode.value === 'group';
  };
  const to = field('To', F.kind);
  F.kind.onchange = showWhich; F.mode.onchange = showWhich;
  const audience = () => {
    const k = F.kind.value;
    if (k === 'saved') return saved.filters.find((f) => f.id === F.saved.value)?.audience;
    return k === 'orders' ? { kind: k, event: F.orders.value } : { kind: k, [k]: F[k].value };
  };
  const out = h('div', { 'aria-live': 'polite' });
  const body = () => ({ title: F.title.value, mode: F.mode.value, group: F.group.value, audience: audience(), purpose: F.purpose.value, agent: F.agent.value, template: F.template.value, noReplyLimit: Number(F.quiet.value) });
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
        p.to.total ? h('button', { class: 'btn primary', type: 'button', onclick: async () => { const r = await tryApi(() => api('POST', `/api/sending/runs/${p.run.id}/start`), 'Sending started'); if (r) location.hash = `people/sending/${r.id}`; } }, `Start sending to ${plural(p.to.total, 'person', 'people')}`) : h('p', { class: 'muted' }, 'Nobody would get it.'))));
    out.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  $('#main').replaceChildren(h('div', { class: 'card' }, back('#people/sending', 'Sending'),
    h('div', { class: 'sec-head' }, h('h2', { tabindex: '-1' }, 'New message'), helpLink('sending.md')),
    field('Title', F.title, 'For you: the history and the owner alerts use it.'), field('How', F.mode), to, which,
    h('div', { class: 'grid2' }, field('Purpose', F.purpose, 'Only people who said yes to it get the message.'), field('Replies go to', F.agent)),
    field('Message', F.template, `Each person gets their own wording, with their facts: ${FIELDS}`),
    field('Pause when this many in a row do not answer', F.quiet, '0 = never (e.g. reminders nobody needs to answer).'),
    h('div', { class: 'row', style: 'gap:8px' }, h('button', { class: 'btn primary', type: 'button', onclick: previewIt }, 'Preview'), h('button', { class: 'btn', type: 'button', onclick: saveAudience }, 'Save audience…')),
    out));
  showWhich();
  $('#main h2')?.focus({ preventScroll: true });
}

async function runPage(id) {
  const g = await api('GET', `/api/sending/runs/${enc(id)}`).catch(() => null);
  const bk = back('#people/sending', 'Sending');
  if (!g) { $('#main').replaceChildren(h('div', { class: 'card' }, bk, h('p', { class: 'muted' }, 'This run is gone.'))); return; }
  const { run: r, recipients } = g;
  const here = location.hash;
  let soon;
  S.onFeed = (a) => { if (location.hash !== here) { S.onFeed = null; return; } if (/List message|Sending /.test(a.summary || '')) { clearTimeout(soon); soon = setTimeout(() => runPage(id), 400); } };
  document.title = `${r.title} · Duniya`;
  const act = (action, ok) => tryApi(() => api('PUT', `/api/sending/runs/${r.id}`, { action }), ok).then((x) => x && runPage(id));
  const stop = async () => (await ask({ title: `Stop "${r.title}"?`, danger: true, ok: 'Stop sending', text: `${plural(r.counts.waiting, 'person', 'people')} who have not got it yet will not get it. This cannot be undone.` })) && act('stop', 'Stopped');
  const m = meterEl(); m.set(r.counts.total - r.counts.skipped ? r.counts.reached / (r.counts.total - r.counts.skipped) : 0);
  const by = (s) => recipients.filter((x) => x.status === s);
  const who = (x) => row(x.name, [x.channel === 'telegram' ? 'Telegram' : x.channel === 'whatsapp' ? 'WhatsApp' : '', x.reason, x.at ? time(x.at) : '', x.repliedAt ? `replied ${time(x.repliedAt)}` : ''].filter(Boolean).join(' · '),
    { href: x.person.startsWith('p_') ? `#people/${enc(x.person)}` : null });
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
    h('details', { class: 'sblock' }, h('summary', {}, 'The message'), h('p', { class: 'small', style: 'white-space:pre-wrap' }, r.template)),
    sentList.length ? group(`Got it (${sentList.length})`, h('ul', {}, sentList.map((x) => h('li', {}, h('details', {}, h('summary', {}, `${x.name} · ${PERSON[x.status]}${x.at ? ` · ${time(x.at)}` : ''}`), h('p', { class: 'small', style: 'white-space:pre-wrap' }, x.text)))))) : null,
    by('waiting').length ? group(`Waiting (${by('waiting').length})`, h('ul', {}, by('waiting').slice(0, 50).map(who))) : null,
    by('failed').length ? group(`Failed (${by('failed').length})`, h('ul', {}, by('failed').map(who))) : null,
    by('skipped').length ? h('details', { class: 'sblock' }, h('summary', {}, `Skipped (${by('skipped').length})`), h('ul', { class: 'mini-list' }, by('skipped').map((x) => h('li', {}, `${x.name}: ${x.reason}`)))) : null));
  $('#main h2')?.focus({ preventScroll: true });
}
