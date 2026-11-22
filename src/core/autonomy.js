// @ts-check
// 093: "How sure before changing things" — one place for an agent's autonomy setting: the system-instruction text, the
// risk of each change (094: from the tool's own annotations, the same for Duniya's tools and remote ones, with the
// owner's per-tool override) and what may happen without an extra confirmation. The runner enforces it in code.
import { matchesAny } from './config.js';

/** ask = preview and wait for a yes; clear = an organizer's clear request is the approval; act = also reasonable inferred changes. */
export const AUTONOMY = ['ask', 'clear', 'act'];

const DESTRUCTIVE_INPUT = /^(delete|remove|destroy|drop|cancel)$/i;
/** A tool that confirms a previewed change (remote services; also the owner assistant's hold). */
export const isConfirmTool = (name) => /(^|_)confirm($|_)/i.test(name);
export const RISKS = ['read', 'change', 'destructive'];

/**
 * The risk of a tool call, from what the tool declares (MCP annotations; Duniya's own tools carry the same ones):
 * readOnlyHint → read (never asks), destructiveHint → destructive (always asks), anything else → change (follows the
 * "Changes it makes" setting). An input that asks for a delete ({ op: "delete" }, { delete: true }) is destructive
 * whatever the tool says. `override`: the owner's per-tool choice (read | change | destructive) wins over the tool.
 * @returns {'read'|'change'|'destructive'}
 */
export function riskOf(annotations = {}, input = {}, override = '') {
  if (Object.entries(input || {}).some(([k, v]) => (typeof v === 'string' && DESTRUCTIVE_INPUT.test(v.trim())) || (/^(delete|remove)$/i.test(k) && v))) return 'destructive';
  if (RISKS.includes(override)) return /** @type {any} */ (override);
  if (annotations?.readOnlyHint === true) return 'read';
  return annotations?.destructiveHint === true ? 'destructive' : 'change';
}

/**
 * A service's preview → confirm pattern: the agent's own confirm settings for that service when it has them, otherwise
 * a sibling confirm tool — then any other tool's result that carries a confirm id is a preview. `undo`: its undo tool.
 * @returns {{ confirm: string, preview: (name: string) => boolean, undo: string }}
 */
export function changeTools(agent, server, names) {
  const own = agent.confirm?.tool?.startsWith(`${server}:`) ? agent.confirm : null;
  const confirm = own ? own.tool.slice(server.length + 1) : names.find(isConfirmTool) || '';
  return { confirm, preview: (name) => !!confirm && name !== confirm && (own ? matchesAny(`${server}:${name}`, [own.preview]) : true), undo: confirm ? names.find((n) => /undo/i.test(n) && !isConfirmTool(n)) || '' : '' };
}

/** The agent's setting (the built-in owner assistant keeps its own confirmations). */
export const autonomyOf = (agent) => (AUTONOMY.includes(agent?.autonomy) ? agent.autonomy : 'clear');

/**
 * May this change happen without an extra confirmation? Only for an organizer (or the owner) on a live message (also a
 * follow-up without the wake word; never the test console or a schedule), a change (never a destructive one), and the
 * service's "Changes it makes" (default: the agent's setting) is clear or act. A read never needs one.
 */
export function mayChangeWithoutAsking(ctx, risk, mode) {
  if (risk === 'read') return true;
  if (risk !== 'change' || (mode || autonomyOf(ctx.agent)) === 'ask') return false;
  if (ctx.role !== 'organizer' && !ctx.ownerTurn) return false;
  // a follow-up without the wake word ("should go to the shopping list", "yes") counts: the model judged it is for it
  return !['panel', 'schedule'].includes(ctx.source);
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
