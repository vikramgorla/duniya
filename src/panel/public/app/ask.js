// Ask (044, streaming #66/#83, conversation 066): the owner assistant in the panel, on Overview and on the owner
// assistant's page. A thread for this session: the question as a bubble, "Thinking…", each tool as a live chip
// ("Checking server metrics…" → "✓ Checked server metrics", folded to "Used 3 tools"), the answer streaming with a caret
// as safe markdown (text nodes only), Stop, Copy, Retry; follow-ups carry the earlier turns (the server keeps them).
// Module of the panel (063).
import { S, api, apiStream, copyBtn, h, icon, toast, tryApi } from './core.js';
import { toolPhrase } from './names.js';
import { plural } from './shared.js';

/** 066: inline **bold**, __bold__ and `code` as elements with text nodes (model text never becomes HTML). */
const inline = (text) => text.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/).filter(Boolean)
  .map((t) => (/^(\*\*|__)/.test(t) ? h('b', {}, t.slice(2, -2)) : /^`/.test(t) ? h('code', {}, t.slice(1, -1)) : t));
/** 066: a safe markdown subset: paragraphs, line breaks, "-"/"*"/"•" and "1." lists, "#" headings as bold, bold, code. */
function markdown(text) {
  const out = []; let list = null; let para = null;
  for (const line of String(text || '').split('\n')) {
    const item = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const kind = item[1] ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== kind) out.push(list = h(kind, {}));
      list.append(h('li', {}, inline(item[2]))); para = null; continue;
    }
    list = null;
    if (!line.trim()) { para = null; continue; }
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    if (head) { out.push(h('p', {}, h('b', {}, head[1]))); para = null; continue; }
    if (para) para.append(h('br'), ...inline(line)); else out.push(para = h('p', {}, inline(line)));
  }
  return out;
}
/** The answer's blocks; while it streams, a blinking caret ends the last line. */
function answerText(text, live) {
  const nodes = markdown(text);
  const last = nodes.at(-1);
  if (live && last) (/^(UL|OL)$/.test(last.tagName) ? last.lastElementChild : last).append(h('span', { class: 'caret', 'aria-hidden': 'true' }));
  return nodes;
}
const MAX_TURNS = 12; // the thread on screen; the server bounds what the model sees

/** One tool chip: running (spinner, "Checking …"), done (✓), held for a confirm (⏸) or failed (✕). */
const chip = (x) => h('span', { class: `pill raw step ${x.step === 'held' ? 'warn' : x.step === 'calling' ? 'run' : x.ok ? '' : 'bad'}`, title: x.tool },
  x.step === 'calling' ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : h('span', { 'aria-hidden': 'true' }, x.step === 'held' ? '⏸ ' : x.ok ? '✓ ' : '✕ '),
  x.step === 'calling' ? `${toolPhrase(x.tool, true)}…` : x.step === 'held' ? `Held for your confirm: ${toolPhrase(x.tool)}` : `${toolPhrase(x.tool)}${x.ok ? '' : ' failed'}`);

function turnView(t, a, last) {
  const tools = t.steps;
  const live = t.state === 'thinking' || t.state === 'streaming';
  const steps = !tools.length ? null : live
    ? h('div', { class: 'asksteps' }, tools.map(chip))
    : h('details', { class: 'asksteps-fold' }, h('summary', {}, `Used ${plural(tools.length, 'tool')}`), h('div', { class: 'asksteps' }, tools.map(chip)));
  const running = tools.some((x) => x.step === 'calling');
  return h('div', { class: 'turn' },
    h('div', { class: 'bubble me' }, t.q),
    h('div', { class: 'answer' },
      steps,
      t.restarted && live ? h('div', { class: 'small muted' }, h('span', { 'aria-hidden': 'true' }, '↻ '), 'The answer was interrupted; asking again…') : null,
      live && !t.reply && !running ? h('div', { class: 'thinking', role: 'status' }, h('span', { class: 'shimmer' }, tools.length ? 'Thinking about what it found' : 'Thinking'), h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))) : null,
      t.reply ? h('div', { class: 'md' }, answerText(t.reply, live)) : null,
      ...t.confirms.map((c) => h('div', { class: 'note warn' }, h('div', {}, c.preview),
        h('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
          h('button', { class: 'btn primary small', onclick: () => a.decide(t, c, false) }, 'Confirm'),
          h('button', { class: 'btn small', onclick: () => a.decide(t, c, true) }, 'Cancel')))),
      t.state === 'error' ? h('div', { class: 'note bad', role: 'alert' }, h('div', {}, t.error),
        last ? h('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => a.send(t.q, t) }, 'Retry') : null) : null,
      t.state === 'stopped' ? h('div', { class: 'small muted' }, 'Stopped.') : null,
      t.state === 'done' && t.reply ? h('div', { class: 'answer-actions' }, copyBtn(() => t.reply)) : null));
}

/** The Ask card. `id`: its element id (Overview: ov-ask; the owner assistant's page: oa-ask). */
export function askCard({ id = 'ov-ask', title = 'Ask', wide = true } = {}) {
  const a = S.ask || (S.ask = { draft: '', turns: [], busy: false });
  const q = h('textarea', { placeholder: a.turns.length ? 'Ask a follow-up…' : 'Ask about your chats…', 'aria-label': 'Ask the owner assistant', rows: 1, maxlength: 4000,
    oninput: (e) => { a.draft = e.target.value; }, onfocus: () => (S.overviewBusy = true), onblur: () => (S.overviewBusy = false) });
  q.value = a.draft;
  const thread = h('div', { class: 'thread', 'aria-live': 'polite' });
  a.stick ??= true; // auto-scroll follows the answer until the reader scrolls up
  thread.addEventListener('scroll', () => { a.stick = thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 24; }, { passive: true });
  const btn = h('button', { class: 'btn primary', type: 'button', onclick: () => (a.busy ? a.ctrl?.abort() : a.send(a.draft)) });
  const draw = () => {
    btn.replaceChildren(...(a.busy ? [h('span', { class: 'stopsq', 'aria-hidden': 'true' }), 'Stop'] : [icon('send'), 'Ask']));
    btn.classList.toggle('primary', !a.busy); btn.setAttribute('aria-label', a.busy ? 'Stop the answer' : 'Ask');
    thread.setAttribute('aria-busy', String(!!a.busy));
    thread.replaceChildren(...a.turns.map((t, i) => turnView(t, a, i === a.turns.length - 1)));
    thread.classList.toggle('hide', !a.turns.length);
    if (a.stick) thread.scrollTop = thread.scrollHeight;
  };
  a.redraw = draw; // the newest card draws (Overview may be rebuilt while an answer streams in)
  a.decide ||= async (t, c, cancel) => {
    const r = await tryApi(() => api('POST', '/api/owner/ask/confirm', { code: c.code, cancel }));
    t.confirms = t.confirms.filter((x) => x !== c);
    if (r) { t.reply = `${t.reply}\n\n${r.reply}`.trim(); toast(cancel ? 'Cancelled' : 'Done'); }
    a.redraw();
  };
  /** Ask `question`; `again` = the failed turn to answer once more (Retry). */
  a.send ||= async (question, again = null) => {
    if (!String(question || '').trim() || a.busy) return;
    const t = again || { q: question.trim(), reply: '', steps: [], confirms: [], state: 'thinking' };
    Object.assign(t, { reply: '', steps: [], confirms: [], state: 'thinking', error: '', restarted: false });
    if (!again) { a.turns.push(t); a.turns.splice(0, a.turns.length - MAX_TURNS); a.draft = ''; }
    a.busy = true; a.ctrl = new AbortController(); a.stick = true;
    let fresh = true; let frame = 0;
    const later = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; a.redraw(); }); };
    a.redraw();
    try {
      // #83: token deltas are appended (the first one of a round replaces earlier interim text) and drawn at most once
      // per frame; "restarted" drops the partial text of a broken stream; the round's whole text and "done" win.
      const r = await apiStream('/api/owner/ask/stream', { question: t.q }, (e) => {
        if (e.type === 'delta') { t.reply = fresh ? e.text : t.reply + e.text; fresh = false; t.state = 'streaming'; return later(); }
        if (e.type === 'step' && e.step === 'thinking') fresh = true;
        else if (e.type === 'step' && e.step === 'calling') t.steps.push(e);
        else if (e.type === 'step') { const i = t.steps.findIndex((x) => x.step === 'calling' && x.tool === e.tool); if (i >= 0) t.steps[i] = e; else t.steps.push(e); }
        else if (e.type === 'restarted') { t.reply = ''; fresh = true; t.restarted = true; }
        else if (e.type === 'text') { t.reply = e.text; fresh = false; t.restarted = false; }
        a.redraw();
      }, a.ctrl.signal);
      t.reply = r.reply; t.confirms = r.confirms || []; t.state = 'done';
    } catch (e) {
      if (a.ctrl.signal.aborted) t.state = 'stopped';
      else { t.state = 'error'; t.error = e.message || 'Something went wrong'; }
    }
    cancelAnimationFrame(frame);
    t.steps = t.steps.filter((x) => x.step !== 'calling');
    a.busy = false; a.ctrl = null;
    a.redraw();
  };
  q.addEventListener('keydown', (e) => {
    // Enter asks on a keyboard (Shift+Enter: new line); on phones Enter is a new line and the button asks
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!e.shiftKey && !matchMedia('(pointer: coarse)').matches))) { e.preventDefault(); a.send(a.draft); }
  });
  draw();
  return h('div', { class: 'card askcard', id, style: wide ? 'grid-column:1/-1' : null },
    h('div', { class: 'row spread nowrap' }, h('h2', { style: 'margin:0' }, title), h('span', { class: 'pill' }, S.user.role)),
    h('p', { class: 'small muted', style: 'margin:4px 0 10px' }, 'Looks across the chats that are on (not those private to members). Changes need your Confirm.'),
    thread, h('div', { class: 'ask-form' }, q, btn));
}
