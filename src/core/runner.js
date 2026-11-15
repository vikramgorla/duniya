import { randomInt } from 'node:crypto';
import { env } from './config.js';
import { addPending, takePending, peekPending, dropPending } from './db.js';
import { chat as modelChat, effectiveFallback } from './providers/index.js';
import { REASON_TEXT } from './providers/errors.js';
import { getChatPrefs } from './chat-prefs.js';

/** The model for a chat: the chat's own choice (auto, provider:auto or provider:model) or the agent's. */
export const chatModel = (agent, chat) => { const m = getChatPrefs(chat).model; return m && m !== 'inherit' ? m : agent.model; };
import { buildContext } from './memory.js';
import { activity } from './events.js';
import { toolsFor, matchesAny, organizerConnection } from './tools.js';
import { checkBudget } from './budget.js';
import { silenceReason } from './silences.js';
import { countStat } from './stats.js';
import { planAttachments } from './media-ai.js';

const MAX_TOOL_ROUNDS = 8;

// Test console (#37): WhatsApp actions are never carried out from the panel. Read-only ones look at the chat being
// tested; every other one returns what it would have done.
const WA_READ_ONLY = new Set(['whatsapp:poll_results', 'whatsapp:group_info', 'whatsapp:profile_info']);
async function runTool(run, m, call, ctx) {
  const fq = m?.fq || '';
  if (ctx.source === 'panel' && fq.startsWith('media:')) { // 043: no pictures are made (or paid for) from the test console
    return { isError: false, text: JSON.stringify({ testConsole: true, notSent: true, note: `Test console: ${fq} was not carried out; in WhatsApp the picture would be created and sent.`, input: call.input }) };
  }
  if (ctx.source !== 'panel' || !fq.startsWith('whatsapp:')) return run(call.name, call.input, { ...ctx, toolName: call.name });
  if (WA_READ_ONLY.has(fq)) return run(call.name, call.input, { ...ctx, chat: ctx.contextChat || ctx.chat, toolName: call.name });
  return { isError: false, text: JSON.stringify({ testConsole: true, notSent: true, note: `Test console: ${fq} was not carried out; in WhatsApp it would run with this input.`, input: call.input }) };
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Confirm codes guard risky actions, so they come from a cryptographic source.
const newCode = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

function systemPrompt({ agent, role, isGroup, chatName }) {
  const now = new Date().toLocaleString('en-GB', { timeZone: agent.timezone || env.timezone });
  const roleText = role === 'organizer'
    ? (agent.confirm
      ? 'They are an organizer: they may request changes. Make changes only through the matching preview tool, then summarise the preview clearly. The system adds a confirm code; never claim a change is done before it is confirmed.'
      : 'They are an organizer.')
    : 'They are a participant: they can ask questions. If they want something changed, say an organizer needs to do it.';
  return [
    agent.prompt.trim(),
    `Current time: ${now} (${agent.timezone || env.timezone}). Chat type: ${isGroup ? 'WhatsApp group (shared, keep personal details out)' : 'WhatsApp direct message'}${chatName ? ` named "${chatName}"` : ''}.`,
    'You see the recent conversation of this chat, a running summary of older discussion and saved notes. Use them to stay aware of what people have said and decided. When someone asks you to remember something, save it with the memory tool. If something older is not in your context, search the chat history before saying you do not know.',
    roleText,
    'Write for WhatsApp: short plain text, *bold* sparingly, simple "-" lists, no markdown headings or tables.',
  ].filter(Boolean).join('\n\n');
}

/** Errors the agent should explain instead of a generic failure. */
export function friendlyModelError(e) {
  const code = e?.code || '';
  if (code === 'subscription_sharing_usage_limit_exceeded' || code === 'subscription_sharing_usage_unavailable') {
    return 'I have reached the ChatGPT plan usage limit for now. Please try again later.';
  }
  if (code === 'subscription_sharing_user_not_eligible') return 'The connected ChatGPT account is not eligible for plan usage (Plus or Pro needed).';
  if (code === 'copilot_limit') return 'I have reached the GitHub Copilot usage limit for now. Please try again later.';
  if (code === 'free_only') return 'My model isn’t available right now (this server only allows free models). An admin can choose another model.';
  if (code === 'no_model') return 'No AI model is configured yet. An admin needs to connect a model provider.';
  // 042: every model in the fallback chain failed or is paused for a retryable reason (limits, outages, sign-in).
  if (code === 'all_paused' || ['rate_limit', 'quota', 'server', 'network', 'timeout', 'auth'].includes(e?.fallbackReason)) {
    return `My AI model isn’t available right now (${REASON_TEXT[e.fallbackReason] || 'provider problem'}). Please try again ${e.fallbackReason === 'quota' ? 'later' : 'in a few minutes'}.`;
  }
  return null;
}

export function extractConfirmId(text, field = 'confirm_id') {
  try {
    const walk = (v) => {
      if (!v || typeof v !== 'object') return null;
      if (typeof v[field] === 'string') return v[field];
      for (const x of Object.values(v)) { const r = walk(x); if (r) return r; }
      return null;
    };
    const found = walk(JSON.parse(text));
    if (found) return found;
  } catch { /* not JSON */ }
  const m = String(text).match(new RegExp(`${field}["'\\s:=]+["']?([A-Za-z0-9_\\-:.]{4,80})`, 'i'));
  return m ? m[1] : null;
}

/**
 * One agent turn for an agent. Returns reply text or null.
 * ctx: { agent, role, chat, senderName, requester, text, isGroup, source: 'whatsapp'|'panel'|'schedule' }
 * contextChat (panel tests, #37): the chat whose memory and model the test uses; `chat` stays the panel test chat.
 */
export async function runAgent(ctx) {
  const { agent, role, chat, senderName, text, isGroup } = ctx;
  // Spending caps (040): checked before the first model call of a turn (a turn that started finishes). Panel tests
  // are never held back, so the owner can still try the agent.
  let model = chatModel(agent, ctx.contextChat || chat);
  if (ctx.source !== 'panel') {
    const budget = await checkBudget(agent, chat, { names: { chat: ctx.chatName } });
    if (budget.action === 'quiet') {
      ctx.silenceReason = 'budget';
      countStat('budget', { agent: agent.id, chat });
      silenceReason('budget', { chat, agent: agent.id, sender: ctx.senderName || '' });
      return null;
    }
    if (budget.action === 'fallback') model = budget.model;
  }
  const { defs, run, meta } = await toolsFor(agent, role);
  for (const err of meta.get('__errors') || []) activity('error', { agent: agent.id, chat, summary: err });

  const memory = buildContext({ agent, chat: ctx.contextChat || chat, excludeId: ctx.msgRowId || 0 });
  // Photos & voice (043): photos / PDFs go as image / document blocks to a model that can see them (or the vision
  // fallback model); otherwise a note asks the model to say kindly that it can't look at them.
  const plan = await planAttachments(model, ctx.attachments || []);
  model = plan.model;
  const notes = [ctx.mediaNote, plan.note].filter(Boolean).join('\n');
  const turnText = `${memory ? `${memory}\n\n` : ''}New message from ${senderName} (${role}):\n${text}${notes ? `\n${notes}` : ''}`;
  const messages = [{
    role: 'user',
    content: plan.attachments.length ? [...plan.attachments, { type: 'text', text: turnText }] : turnText,
  }];

  const codes = [];
  let reply = '';
  const usage = { input: 0, output: 0 };
  // Fallback (042): per model call, keeping this turn's messages, so tools that already ran never run again and
  // nothing is sent before the turn ends. The account that answered stays first for the rest of the turn.
  const fallback = effectiveFallback({ agent, chatPrefs: getChatPrefs(ctx.contextChat || chat) });
  const turn = { ref: '' };
  const failed = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let res;
    try {
      res = await modelChat({
        model, purpose: 'agent', maxTokens: agent.maxTokens, usage: { agent: agent.id, chat, kind: ctx.source === 'panel' ? 'test' : ctx.source === 'schedule' ? 'scheduled' : 'reply' },
        system: systemPrompt({ agent, role, isGroup, chatName: ctx.chatName }), tools: defs, messages, fallback, turn,
      });
    } catch (e) {
      if (e.failures?.length) ctx.fallback = { answeredBy: '', failed: [...failed, ...e.failures.filter((f) => f.reason !== 'unavailable').map(({ ref, name, reason }) => ({ ref, name, reason }))] };
      const friendly = friendlyModelError(e);
      if (!friendly) throw e;
      activity('error', { agent: agent.id, chat, summary: `Model error: ${e.message}`, detail: { code: e.code, reason: e.fallbackReason, failures: e.failures } });
      ctx.modelError = e.code || 'model_error'; // the router records why the agent could not really answer (#34)
      return friendly;
    }
    ctx.model = res.model;
    ctx.answeredBy = res.answeredBy || res.model;
    for (const f of res.failures || []) failed.push({ ref: f.ref, name: f.name, reason: f.reason });
    if (failed.length) ctx.fallback = { answeredBy: ctx.answeredBy, model: res.model, failed };
    usage.input += res.usage?.input_tokens || 0;
    usage.output += res.usage?.output_tokens || 0;
    reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) break;

    messages.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const call of calls) {
      const m = meta.get(call.name);
      const started = Date.now();
      const out = await runTool(run, m, call, ctx);
      let content = String(out.text ?? '').slice(0, 12000);
      activity(out.isError ? 'tool.error' : 'tool.call', {
        agent: agent.id, chat,
        summary: `${m?.fq || call.name} (${Date.now() - started} ms)${out.isError ? ' failed' : ''}`,
        detail: { input: call.input, output: content.slice(0, 2000), role },
      });

      if (!out.isError && m?.kind === 'mcp' && agent.confirm && matchesAny(m.fq, [agent.confirm.preview])) {
        const confirmId = extractConfirmId(out.text, agent.confirm.idField || 'confirm_id');
        if (confirmId) {
          const code = newCode();
          const [server, confirmTool] = agent.confirm.tool.split(':');
          addPending({
            code, agent: agent.id, server, confirmTool, confirmId, tool: m.fq, chat,
            requester: ctx.requester, summary: content.slice(0, 500),
            expires: Date.now() + (agent.confirm.ttlMinutes || 9) * 60000,
          });
          codes.push(code);
          content = content.split(confirmId).join('[held for organizer confirmation]');
          activity('confirm.created', { agent: agent.id, chat, summary: `${code}: ${m.fq}`, detail: { input: call.input } });
        }
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, is_error: out.isError, content });
    }
    messages.push({ role: 'user', content: results });
  }

  for (const code of codes) {
    reply += `\n\nOrganizer: reply *confirm ${code}* to apply, or *cancel ${code}* (valid ${agent.confirm.ttlMinutes || 9} min).`;
  }
  ctx.usage = usage;
  const via = failed.length ? ` (after ${failed.map((f) => `${f.name}: ${REASON_TEXT[f.reason] || f.reason}`).join(', ')})` : '';
  activity('model.usage', { agent: agent.id, chat, summary: `${ctx.model || agent.model}: ${usage.input} in / ${usage.output} out${via}`, detail: failed.length ? { fallback: failed } : undefined });
  return reply.trim() || null;
}

/** "confirm ABCD" / "cancel ABCD". Returns reply text, or undefined when it isn't for us. */
export async function handleConfirmCommand({ agent, text, role, chat }) {
  const m = String(text).trim().match(/^(confirm|cancel)\s+([A-Z0-9]{4})$/i);
  if (!m) return undefined;
  const code = m[2].toUpperCase();
  const p = peekPending(code);
  if (!p || p.agent !== agent.id) return undefined;
  if (role !== 'organizer') return 'Only organizers can confirm or cancel changes.';
  if (p.chat !== chat) return `Change ${code} belongs to another chat; confirm it there.`;
  if (/^cancel$/i.test(m[1])) {
    dropPending(code);
    activity('confirm.cancelled', { agent: agent.id, chat, summary: code });
    return `Cancelled ${code}.`;
  }
  const row = takePending(code);
  if (!row) return `Change ${code} has expired — ask me again.`;
  return applyPending(agent, row);
}

export async function applyPending(agent, row) {
  const conn = organizerConnection(agent, row.server);
  const out = await conn.call(row.confirm_tool, { [agent.confirm.idField || 'confirm_id']: row.confirm_id });
  activity(out.isError ? 'tool.error' : 'confirm.applied', {
    agent: agent.id, chat: row.chat, summary: `${row.code}: ${row.tool}${out.isError ? ' failed' : ''}`, detail: { output: out.text.slice(0, 1000) },
  });
  return out.isError ? `Could not apply ${row.code}: ${out.text.slice(0, 300)}` : `Done (${row.code}). ${out.text.slice(0, 300)}`;
}
