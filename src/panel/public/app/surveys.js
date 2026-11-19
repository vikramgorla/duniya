// Surveys (083): People → Surveys. The list → a survey's page (results per question, who answered what, CSV, Send…),
// and the editor (title, intro, questions of four kinds with their choices). Loaded from people.js on first visit;
// answers from people are text nodes, never HTML.
import { $, api, ask, avatar, can, emptyState, field, h, menu, time, toggle, tryApi } from './core.js';
import { helpLink, plural } from './shared.js';
import { peopleNav } from './people.js';
import { back, group, row, sentBlock } from './events.js';
const enc = encodeURIComponent;
const KINDS = [['single', 'One choice'], ['multi', 'Several choices'], ['number', 'A number'], ['text', 'Short text']];
const show = (v) => (v === null || v === undefined ? 'skipped' : Array.isArray(v) ? v.join(', ') : String(v));
const rank = (p) => (p.doneAt ? 0 : p.startedAt ? 1 : 2);
const STATE = [['Finished', 'ok'], ['Part-way', 'info'], ['Asked', '']];
/** 085: one person per row: avatar · name · when and how · their answers quoted · state pill; the row opens the person. */
const person = (p) => h('li', { class: 'has-end' }, h('a', { class: 'lrow', href: `#people/${enc(p.person || p.id)}` }, avatar(p.name, p.person || p.id, 's'),
  h('span', { class: 'lrow-main' }, h('span', { class: 'lrow-name' }, p.name),
    h('span', { class: 'lrow-sub' }, [p.doneAt ? time(p.doneAt) : '', p.via === 'link' ? 'by link' : p.via === 'chat' ? 'in chat' : ''].filter(Boolean).join(' · ') || 'not answered yet'),
    Object.keys(p.answers || {}).length ? h('span', { class: 'quote' }, Object.values(p.answers).map(show).filter((v) => v && v !== 'skipped').join(' · ')) : null)),
  h('span', { class: 'row-end' }, h('span', { class: `pill ${STATE[rank(p)][1]}` }, STATE[rank(p)][0])));

/** #people/surveys[/id] */
export const renderSurveys = (b) => (b ? surveyPage(b) : surveyList());

async function edit(s = null) {
  const qs = (s?.questions || [{ text: '', kind: 'single', options: ['', ''], required: true }]).map((q) => ({ ...q, options: [...(q.options || [])] }));
  const title = h('input', { value: s?.title || '', placeholder: 'e.g. Picnic day', autocomplete: 'off' });
  const intro = h('input', { value: s?.intro || '', placeholder: 'e.g. Two minutes, promise.', autocomplete: 'off' });
  const list = h('div', {});
  const draw = () => list.replaceChildren(...qs.map((q, i) => h('div', { class: 'sblock' },
    field(`Question ${i + 1}`, h('input', { value: q.text, autocomplete: 'off', oninput: (e) => { q.text = e.target.value; } })),
    h('div', { class: 'grid2' }, field('Answer', h('select', { onchange: (e) => { q.kind = e.target.value; if (['single', 'multi'].includes(q.kind) && q.options.length < 2) q.options = ['', '']; draw(); } }, KINDS.map(([k, l]) => h('option', { value: k, selected: q.kind === k }, l)))),
      field('Needs an answer', toggle(q.required !== false, (on) => { q.required = on; }, false, 'Needs an answer'))),
    ['single', 'multi'].includes(q.kind) ? field('Choices', h('div', {}, q.options.map((o, k) => h('input', { value: o, placeholder: `Choice ${k + 1}`, autocomplete: 'off', style: 'margin-bottom:6px', oninput: (e) => { q.options[k] = e.target.value; } })),
      h('button', { class: 'btn small', type: 'button', onclick: () => { q.options.push(''); draw(); } }, '+ Choice'))) : null,
    qs.length > 1 ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => { qs.splice(i, 1); draw(); } }, 'Remove question') : null)),
  h('button', { class: 'btn small', type: 'button', onclick: () => { qs.push({ text: '', kind: 'single', options: ['', ''], required: true }); draw(); } }, '+ Question'));
  draw();
  if (!await ask({ title: s ? `Edit ${s.title}` : 'New survey', ok: s ? 'Save' : 'Create survey', wide: true, body: [field('Title', title), field('Intro (optional)', intro), list] })) return null;
  const body = { title: title.value, intro: intro.value, questions: qs.map((q) => ({ ...q, options: q.options.filter((o) => o.trim()) })) };
  return tryApi(() => api(s ? 'PUT' : 'POST', s ? `/api/surveys/${s.id}` : '/api/surveys', body), s ? 'Saved' : 'Survey created');
}

async function surveyList() {
  const list = await api('GET', '/api/surveys');
  const create = async () => { const s = await edit(); if (s) location.hash = `people/surveys/${s.id}`; };
  $('#main').replaceChildren(h('div', { class: 'card' }, peopleNav('people/surveys'),
    h('div', { class: 'sec-head' }, h('h2', {}, `Surveys (${list.length})`), h('button', { class: 'btn small primary', type: 'button', onclick: create }, '+ New'), helpLink('surveys.md')),
    list.length ? h('ul', { class: 'people-list', style: 'margin-top:10px' }, list.map((s) => row(s.title, `${plural(s.questions.length, 'question')} · ${s.counts.done} of ${s.counts.invited} finished`, { href: `#people/surveys/${enc(s.id)}`, end: s.status === 'closed' ? h('span', { class: 'row-end' }, h('span', { class: 'pill' }, 'Closed')) : null })))
      : emptyState('list', 'No surveys yet', 'A few questions people answer in their chat (the agent asks one at a time) or with their own link.', h('button', { class: 'btn primary', onclick: create }, 'New survey'))));
}

async function surveyPage(id) {
  const r = await api('GET', `/api/surveys/${enc(id)}`).catch(() => null);
  const bk = back('#people/surveys', 'Surveys');
  if (!r) { $('#main').replaceChildren(h('div', { class: 'card' }, bk, h('p', { class: 'muted' }, 'This survey is gone.'))); return; }
  const { survey: s, counts: c } = r;
  document.title = `${s.title} · Duniya`;
  const redraw = () => surveyPage(id);
  const remove = async () => (await ask({ title: `Delete ${s.title}?`, danger: true, ok: 'Delete survey', text: `The answers of ${plural(c.started, 'person', 'people')} go too. This cannot be undone.` }))
    && tryApi(async () => { await api('DELETE', `/api/surveys/${s.id}`); location.hash = 'people/surveys'; }, 'Deleted');
  const total = (t) => (t.kind === 'number' ? h('p', { class: 'small' }, t.answers ? `Average ${t.average} · from ${t.min} to ${t.max} · total ${t.sum} (${plural(t.answers, 'answer')})` : 'No answers yet')
    : t.kind === 'text' ? h('ul', { class: 'mini-list' }, t.latest.length ? t.latest.map((v) => h('li', {}, v)) : h('li', { class: 'muted' }, 'No answers yet'))
      : h('div', { class: 'results' }, t.options.map((o) => h('div', { class: 'result' }, h('div', { class: 'result-head' }, h('span', {}, o.option), h('b', { class: 'num' }, String(o.count))),
        h('div', { class: 'meter' }, h('i', { style: `width:${t.answers ? Math.round((o.count / t.answers) * 100) : 0}%` }))))));
  $('#main').replaceChildren(h('div', { class: 'card person-page' }, bk,
    h('div', { class: 'ap-head' }, h('div', { class: 'ap-title' }, h('h2', { tabindex: '-1' }, s.title), h('div', { class: 'small muted' }, s.intro || `${plural(s.questions.length, 'question')}`)),
      can('admin') ? menu(`More for ${s.title}`, h('button', { class: 'btn small', type: 'button', onclick: () => edit(s).then((x) => x && redraw()) }, 'Edit…'),
        h('button', { class: 'btn small', type: 'button', onclick: () => tryApi(() => api('PUT', `/api/surveys/${s.id}`, { status: s.status === 'open' ? 'closed' : 'open' }), s.status === 'open' ? 'Closed' : 'Open again').then((x) => x && redraw()) }, s.status === 'open' ? 'Close it' : 'Open it again'),
        h('a', { class: 'btn small', href: `/api/surveys/${s.id}/csv`, download: '' }, 'Download CSV'), h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete…')) : null),
    h('p', { class: 'small', style: 'margin:8px 0 0' }, [`${c.done} of ${c.invited} finished`, c.started - c.done ? `${c.started - c.done} part-way` : '', s.status === 'closed' ? 'closed' : ''].filter(Boolean).join(' · ')),
    s.status === 'open' && can('admin') && !c.invited ? h('a', { class: 'btn primary', style: 'margin-top:8px', href: `#people/sending/new?survey=${enc(s.id)}&title=${enc(s.title)}` }, 'Send it to people…') : null,
    r.totals.map((t) => group(t.text, total(t))),
    r.people.length ? group(`People (${r.people.length})`, h('ul', {}, [...r.people].sort((a, b) => rank(a) - rank(b)).map(person))) : null,
    await sentBlock((x) => x.survey === s.id, `people/sending/new?survey=${enc(s.id)}&title=${enc(s.title)}`, 'Send it to more people')));
  $('#main h2')?.focus({ preventScroll: true });
}
