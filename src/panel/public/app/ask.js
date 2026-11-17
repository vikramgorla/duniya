// Overview → Ask: the owner assistant in the panel, streamed. Module of the panel (063).
// ---------- Overview → Ask (044, streaming #66): the owner assistant in the panel ----------
import { S, api, apiStream, h, toast, tryApi } from './core.js';
import { plural } from './shared.js';
const toolWords = (name) => String(name || '').replace(/^(get|list)_/, '').replace(/_/g, ' ');
/** Compact progress: "Thinking…", then one small chip per tool (✓ looked up, ⏸ change held, ✕ failed). */
function askSteps(a) {
  const tools = a.steps.filter((x) => x.step !== 'thinking');
  const rounds = a.steps.filter((x) => x.step === 'thinking').length;
  if (!a.busy && !tools.length) return null;
  const chip = (x) => h('span', { class: `pill ${x.step === 'held' ? 'warn' : x.ok ? '' : 'bad'}`, title: x.tool },
    h('span', { 'aria-hidden': 'true' }, x.step === 'held' ? '⏸ ' : x.ok ? '✓ ' : '✕ '), x.step === 'held' ? `change held: ${toolWords(x.tool)}` : `${toolWords(x.tool)}${x.ok ? '' : ' failed'}`);
  return h('div', { class: 'asksteps small muted' },
    a.busy ? h('span', {}, h('span', { class: 'spinner' }), tools.length ? ` Step ${rounds}…` : ' Looking through your chats…') : h('span', {}, `${plural(tools.length, 'step')}:`),
    tools.slice(-8).map(chip), tools.length > 8 ? h('span', {}, `+${tools.length - 8} earlier`) : null);
}
export function askCard() {
  const a = S.ask || (S.ask = { q: '', reply: '', confirms: [], busy: false, steps: [] });
  a.steps ||= [];
  const q = h('textarea', { placeholder: 'Ask about your chats, e.g. “What did the families decide this week?”', 'aria-label': 'Ask the owner assistant', style: 'min-height:72px;font-family:inherit', maxlength: 4000,
    oninput: (e) => { a.q = e.target.value; }, onfocus: () => (S.overviewBusy = true), onblur: () => (S.overviewBusy = false) });
  q.value = a.q;
  const out = h('div', { 'aria-live': 'polite', 'aria-busy': String(!!a.busy) });
  const btn = h('button', { class: 'btn primary', onclick: () => send() }, 'Ask');
  const draw = () => {
    btn.disabled = a.busy; out.setAttribute('aria-busy', String(!!a.busy));
    out.replaceChildren(
      askSteps(a),
      a.busy && a.restarted ? h('div', { class: 'small muted' }, h('span', { 'aria-hidden': 'true' }, '↻ '), 'The answer was interrupted; asking again…') : null,
      a.reply ? h('div', { class: `note${a.busy ? ' askpartial' : ''}`, style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, a.reply) : null,
      ...a.confirms.map((c) => h('div', { class: 'note warn' }, h('div', {}, c.preview),
        h('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
          h('button', { class: 'btn primary small', onclick: () => decide(c, false) }, 'Confirm'),
          h('button', { class: 'btn small', onclick: () => decide(c, true) }, 'Cancel')))));
  };
  a.redraw = draw; // the newest card draws (Overview may be rebuilt while an answer streams in)
  async function decide(c, cancel) {
    const r = await tryApi(() => api('POST', '/api/owner/ask/confirm', { code: c.code, cancel }));
    a.confirms = a.confirms.filter((x) => x !== c);
    if (r) { a.reply = `${a.reply}\n\n${r.reply}`.trim(); toast(cancel ? 'Cancelled' : 'Done'); }
    a.redraw();
  }
  async function send() {
    if (!a.q.trim() || a.busy) return;
    a.busy = true; a.confirms = []; a.reply = ''; a.steps = []; a.fresh = true; a.restarted = false; a.redraw();
    // #83: token deltas are appended (the first one of a round replaces earlier interim text) and drawn at most once
    // per frame; "restarted" drops the partial text of a broken stream; the round's whole text and "done" win.
    let frame = 0;
    const later = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; a.redraw(); }); };
    try {
      const r = await apiStream('/api/owner/ask/stream', { question: a.q }, (e) => {
        if (e.type === 'delta') { a.reply = a.fresh ? e.text : a.reply + e.text; a.fresh = false; return later(); }
        if (e.type === 'step') { a.steps.push(e); if (e.step === 'thinking') a.fresh = true; }
        else if (e.type === 'restarted') { a.reply = ''; a.fresh = true; a.restarted = true; }
        else if (e.type === 'text') { a.reply = e.text; a.fresh = false; a.restarted = false; }
        a.redraw();
      });
      cancelAnimationFrame(frame); frame = 0;
      a.reply = r.reply; a.confirms = r.confirms || []; a.q = ''; q.value = '';
    } catch (e) { toast(e.message); }
    a.busy = false;
    a.redraw();
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
  draw();
  return h('div', { class: 'card', id: 'ov-ask', style: 'grid-column:1/-1' }, h('div', { class: 'row spread' }, h('h2', { style: 'margin:0' }, 'Ask'), h('span', { class: 'pill' }, S.user.role)),
    h('p', { class: 'small muted' }, 'The owner assistant looks across the chats that are on (not those private to members). You see each step as it works; changes need your Confirm.'),
    q, h('div', { class: 'row', style: 'margin-top:8px' }, btn), out);
}

