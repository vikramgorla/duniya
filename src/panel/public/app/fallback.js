// Model fallback (042): chain editors and per-chat overrides. Module of the panel (063).
// ---------- model fallback (042) ----------
import { can, h } from './core.js';
import { modelLabel, modelSelect } from './shared.js';
const FB_REASON = { rate_limit: 'rate limit', quota: 'usage limit', server: 'provider error', network: 'network error', timeout: 'timed out', auth: 'sign-in expired', model_not_found: 'model not available', unavailable: 'not connected', bad_request: 'request refused' };
/** "Answered by OpenAI — work after Anthropic failed (usage limit)" for the test console. */
export const fallbackLine = (fb) => (fb?.failed?.length ? `${fb.answeredBy ? `Answered by ${fb.answeredBy}` : 'No model could answer'} after ${fb.failed.map((f) => `${f.name} failed (${FB_REASON[f.reason] || f.reason})`).join(', ')}` : '');
/** Ordered list of models to try. Empty = any other connected provider (Auto). Returns { el, value() }. */
export function chainEditor(models, initial, { emptyText = 'Any other connected provider, each with its Auto model, in the order shown on this page.' } = {}) {
  const chain = [...(initial || [])];
  const box = h('div', { class: 'chain' });
  const draw = () => {
    const add = modelSelect(models, 'auto', { 'aria-label': 'Add a fallback model', autoLabel: chain.length ? '+ Add another model…' : '+ Add a model…', disabled: !can('admin'), onchange: (e) => { const v = e.target.value; if (v !== 'auto' && !chain.includes(v) && chain.length < 10) chain.push(v); draw(); } });
    box.replaceChildren(
      chain.length ? h('ol', { class: 'chainlist' }, chain.map((ref, i) => h('li', {},
        h('span', { class: 'grow' }, modelLabel(ref, models)),
        h('button', { type: 'button', class: 'btn small mut', disabled: i === 0, 'aria-label': 'Move up', onclick: () => { [chain[i - 1], chain[i]] = [chain[i], chain[i - 1]]; draw(); } }, '↑'),
        h('button', { type: 'button', class: 'btn small danger mut', 'aria-label': 'Remove', onclick: () => { chain.splice(i, 1); draw(); } }, '✕'))))
        : h('p', { class: 'small muted', style: 'margin:4px 0' }, emptyText),
      add);
  };
  draw();
  return { el: box, value: () => [...chain] };
}
/** Agent / chat override: inherit | on | off, plus an own chain. Returns { el, value() }. */
export function fallbackPicker(models, override, { what = 'agent', inheritLabel = '' } = {}) {
  const o = override || { mode: 'inherit', chain: [] };
  const fb = models.fallback || { enabled: true, chain: [] };
  const mode = h('select', { disabled: !can('admin'), 'aria-label': 'When the model is unavailable' },
    h('option', { value: 'inherit', selected: o.mode === 'inherit' }, inheritLabel || `Use the Models setting (${fb.enabled ? 'switch' : 'don’t switch'})`),
    h('option', { value: 'on', selected: o.mode === 'on' }, 'Switch to another model'),
    h('option', { value: 'off', selected: o.mode === 'off' }, 'Don’t switch: stay on the chosen model'));
  const own = h('input', { type: 'checkbox', checked: !!o.chain?.length, disabled: !can('admin') });
  const chain = chainEditor(models, o.chain?.length ? o.chain : fb.chain, { emptyText: 'Any other connected provider (Auto).' });
  const chainBox = h('div', { class: own.checked ? '' : 'hide', style: 'margin-top:6px' }, chain.el);
  own.onchange = () => chainBox.classList.toggle('hide', !own.checked);
  const ownRow = h('label', { class: 'inline small', style: 'margin-top:6px' }, own, `Own list of models for this ${what}`);
  const sync = () => ownRow.classList.toggle('hide', mode.value === 'off');
  mode.onchange = sync; sync();
  return { el: h('div', {}, mode, ownRow, chainBox), value: () => ({ mode: mode.value, chain: own.checked && mode.value !== 'off' ? chain.value() : [] }) };
}
/** One line for a chat's fallback override (#65): "If unavailable: switch to A → B". */
export function chatFallbackLine(fb, models) {
  const o = fb || { mode: 'inherit', chain: [] };
  if (o.mode === 'off') return 'If unavailable: don’t switch';
  const chain = o.chain?.length ? `: ${o.chain.map((r) => modelLabel(r, models)).join(' → ')}` : '';
  return o.mode === 'on' ? `If unavailable: switch model${chain}` : `If unavailable: as the agent${chain ? ` (own list${chain})` : ''}`;
}
/** Chats → model fallback for one chat (#65): the same picker as the agent editor; saved with the chat's settings. */
export function chatFallbackEditor(c, models, { onSaved, onClose }) {
  const pick = fallbackPicker(models, c.fallback, { what: 'chat', inheritLabel: 'As the agent' });
  return h('div', { class: 'card', id: 'chat-fallback', style: 'margin-top:14px' }, h('h2', {}, `Model fallback · ${c.name || c.id}`),
    h('p', { class: 'small muted', style: 'margin-top:0' }, 'When this chat’s model hits a limit, an outage or an expired sign-in, Duniya can answer with another model. Refused requests never switch, and tools are never run twice.'),
    pick.el,
    h('div', { class: 'row', style: 'margin-top:12px' },
      can('admin') ? h('button', { class: 'btn primary', onclick: () => onSaved(pick.value()) }, 'Save') : null,
      h('button', { class: 'btn', onclick: onClose }, 'Close')));
}

