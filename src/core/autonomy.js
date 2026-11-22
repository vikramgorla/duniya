// @ts-check
// 093: "How sure before changing things" — one place for an agent's autonomy setting: the system-instruction text, the
// risk of each change (Duniya's own held changes by a table; remote preview → confirm tools by their names) and what may
// happen without an extra confirmation. The runner enforces it in code; the prompt only explains it.
import { matchesAny } from './config.js';

/** ask = preview and wait for a yes; clear = an organizer's clear request is the approval; act = also reasonable inferred changes. */
export const AUTONOMY = ['ask', 'clear', 'act'];

/**
 * Duniya's own changes that can be held for "confirm CODE" (People, modules), by risk. low = reversible, about
 * non-personal data or a note; high = someone else's registration, duty, money or a send. Unknown tools are high.
 */
const RISK = {
  'people:add_note': 'low', 'people:tag_person': 'low', 'people:add_to_list': 'low',
  'events:register_someone': 'high', 'events:update_registration': 'high', 'events:assign_duty': 'high',
  'orders:mark_paid': 'high', 'orders:refund': 'high',
  'sending:send_to_list': 'high',
};
// Remote tools (preview → confirm): words in the tool name. High wins; a name with neither is high.
const HIGH_WORDS = /delete|remove|reset|clear|wipe|purge|cancel|refund|pay|bill|receipt|decision|approve|reject|assign|register|registration|import|bulk|send|broadcast|role|permission|invite|member|user/i;
const LOW_WORDS = /create|add|update|edit|set|item|line|dish|row|note|menu|agenda|shopping|estimate|performance|prefill|link|undo/i;
const BUILT_IN = ['people', 'events', 'orders', 'sending', 'surveys', 'whatsapp', 'memory', 'media', 'promises'];
const DESTRUCTIVE_INPUT =/^(delete|remove|destroy|drop|cancel)$/i;

const isPreviewTool = (name) => /(^|_)preview$|^preview_/i.test(name);
/** A tool that confirms a previewed change (remote services; also the owner assistant's hold). */
export const isConfirmTool = (name) => /(^|_)confirm($|_)/i.test(name);

/**
 * The risk of a change: `fq` (server:tool), its input, the agent's overrides ({ risk: { low: [globs], high: [globs] } };
 * high wins). Built-in held changes use the table; remote previews their name; anything that names a delete is high.
 * @returns {'low'|'high'}
 */
function riskOf(fq, input = {}, agent = null) {
  if (matchesAny(fq, agent?.risk?.high || [])) return 'high';
  // an input that asks for a delete ({ op: "delete" }, { delete: true }) is high whatever the tool is called
  if (Object.entries(input || {}).some(([k, v]) => (typeof v === 'string' && DESTRUCTIVE_INPUT.test(v.trim())) || (/^(delete|remove)$/i.test(k) && v))) return 'high';
  if (matchesAny(fq, agent?.risk?.low || [])) return 'low';
  if (RISK[fq]) return /** @type {'low'|'high'} */ (RISK[fq]);
  const [server, tool = ''] = fq.split(':');
  if (BUILT_IN.includes(server)) return 'high';
  return HIGH_WORDS.test(tool) || !LOW_WORDS.test(tool) ? 'high' : 'low';
}

/**
 * A remote service's preview → confirm tools (093): the agent's own confirm settings for that service when it has them,
 * otherwise by name — tools ending in _preview next to a `confirm` tool. `undo`: its undo tool, if any.
 * @returns {{ confirm: string, preview: (name: string) => boolean, undo: string }}
 */
export function changeTools(agent, server, names) {
  const own = agent.confirm?.tool?.startsWith(`${server}:`) ? agent.confirm : null;
  const confirm = own ? own.tool.slice(server.length + 1) : names.some(isPreviewTool) ? names.find(isConfirmTool) || '' : '';
  return { confirm, preview: (name) => !!confirm && (own ? matchesAny(`${server}:${name}`, [own.preview]) : isPreviewTool(name)), undo: confirm ? names.find((n) => /undo/i.test(n) && !isConfirmTool(n)) || '' : '' };
}

/** The agent's setting (the built-in owner assistant keeps its own confirmations). */
const autonomyOf = (agent) => (AUTONOMY.includes(agent?.autonomy) ? agent.autonomy : 'clear');

/**
 * May this change happen without an extra confirmation? Only for an organizer (or the owner) on a live turn addressed
 * to the agent (not the test console, a schedule or a message it judged by itself), in clear / act, and a low-risk change.
 */
export function mayChangeWithoutAsking(ctx, fq, input) {
  if (autonomyOf(ctx.agent) === 'ask') return false;
  if (ctx.role !== 'organizer' && !ctx.ownerTurn) return false;
  if (['panel', 'schedule'].includes(ctx.source) || ctx.unaddressed) return false;
  return riskOf(fq, input, ctx.agent) === 'low';
}

// A later message that agrees: "yes", "ok", "go ahead", "do it", 👍, "oui", "ja", "haan" … (the start of the message)
const YES = /^(yes|yeah|yep|yup|y|ok|okay|okey|sure|confirm(ed)?|go( ahead)?|do it|please do|save( it)?|correct|right|sounds good|perfect|fine|approved?|agreed?|done|👍|✅|oui|d'accord|ja|si|sí|haan|han|ha|avunu|ji|theek hai|thik hai)\b/i;
/** Does this message clearly agree to a change shown before? */
export const isAgreement = (text) => {
  const t = String(text || '').trim().toLowerCase().replace(/^[\s"'*_~.,!]+/, '');
  return t.length <= 120 && (YES.test(t) || /^(👍|✅)/u.test(t));
};

/** The system-instruction paragraph for the sender's role (one place; per-agent prompts need not say it). */
export function autonomyNote(agent, role, { held = false } = {}) {
  if (role !== 'organizer') return 'They are a participant: they can ask questions. If they want something changed, say an organizer needs to do it.';
  const codes = held ? ' Some changes are held by the system for an organizer\'s confirm code: then summarise the preview and say it applies after confirm; never claim it is done.' : '';
  const mode = autonomyOf(agent);
  if (mode === 'ask') return `They are an organizer: they may request changes. Before any change, show the specific preview and wait for their explicit yes in a later message.${codes}`;
  const base = 'They are an organizer. When they clearly ask for a specific change, that request is their approval: preview it and confirm it in the same turn, then say in one line what changed (add "say undo to revert" when undo is possible). Apply follow-up tweaks to something you just changed without asking again. Ask one short question first only when the request is unclear, deletes something, or changes another person\'s money, registration or duty.';
  return `${base}${mode === 'act' ? ' You may also make reasonable changes that clearly follow from what they asked, within your job; still never delete or change someone else\'s money without asking.' : ''}${codes}`;
}

/** What the model reads after a preview that was applied at once (clear request), or that waits for a later yes. */
export const appliedNote = (result, undo) => `Duniya: applied without an extra confirmation (the organizer's clear request is their approval): ${String(result).slice(0, 600)}\nReport the change in one line${undo ? ' and add that they can say undo to revert' : ''}. Do not ask whether to save it.`;
export const WAIT_NOTE = 'Duniya: show this preview and wait for an explicit yes in a later message. Confirming it in this turn is blocked.';
export const BLOCKED = 'Not confirmed: Duniya allows this only after an organizer clearly says yes to the preview in a later message. Show the preview and ask.';
