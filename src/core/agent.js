import { env } from './config.js';
import { addPending, takePending, peekPending, dropPending } from './db.js';
import { chat as modelChat } from './providers/index.js';
import { getChatPrefs } from './chat-prefs.js';

/** The model for a chat: the chat's own choice (auto, provider:auto or provider:model) or the bot's. */
export const chatModel = (bot, chat) => { const m = getChatPrefs(chat).model; return m && m !== 'inherit' ? m : bot.model; };
import { buildContext } from './memory.js';
import { activity } from './events.js';
import { toolsFor, matchesAny, organizerConnection } from './tools.js';

const MAX_TOOL_ROUNDS = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

function systemPrompt({ bot, role, isGroup, chatName }) {
  const now = new Date().toLocaleString('en-GB', { timeZone: bot.timezone || env.timezone });
  const roleText = role === 'organizer'
    ? (bot.confirm
      ? 'They are an organizer: they may request changes. Make changes only through the matching preview tool, then summarise the preview clearly. The system adds a confirm code; never claim a change is done before it is confirmed.'
      : 'They are an organizer.')
    : 'They are a participant: they can ask questions. If they want something changed, say an organizer needs to do it.';
  return [
    bot.prompt.trim(),
    `Current time: ${now} (${bot.timezone || env.timezone}). Chat type: ${isGroup ? 'WhatsApp group (shared, keep personal details out)' : 'WhatsApp direct message'}${chatName ? ` named "${chatName}"` : ''}.`,
    'You see the recent conversation of this chat, a running summary of older discussion and saved notes. Use them to stay aware of what people have said and decided. When someone asks you to remember something, save it with the memory tool. If something older is not in your context, search the chat history before saying you do not know.',
    roleText,
    'Write for WhatsApp: short plain text, *bold* sparingly, simple "-" lists, no markdown headings or tables.',
    bot.extraPrompt?.trim() || '',
  ].filter(Boolean).join('\n\n');
}

/** Errors the bot should explain instead of a generic failure. */
export function friendlyModelError(e) {
  const code = e?.code || '';
  if (code === 'subscription_sharing_usage_limit_exceeded' || code === 'subscription_sharing_usage_unavailable') {
    return 'I have reached the ChatGPT plan usage limit for now. Please try again later.';
  }
  if (code === 'subscription_sharing_user_not_eligible') return 'The connected ChatGPT account is not eligible for plan usage (Plus or Pro needed).';
  if (code === 'no_model') return 'No AI model is configured yet. An admin needs to connect a model provider.';
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
 * One agent turn for a bot. Returns reply text or null.
 * ctx: { bot, role, chat, senderName, requester, text, isGroup, source: 'whatsapp'|'panel'|'schedule' }
 */
export async function runAgent(ctx) {
  const { bot, role, chat, senderName, text, isGroup } = ctx;
  const { defs, run, meta } = await toolsFor(bot, role);
  for (const err of meta.get('__errors') || []) activity('error', { bot: bot.id, chat, summary: err });

  const memory = buildContext({ bot, chat, excludeId: ctx.msgRowId || 0 });
  const messages = [{
    role: 'user',
    content: `${memory ? `${memory}\n\n` : ''}New message from ${senderName} (${role}):\n${text}`,
  }];

  const codes = [];
  let reply = '';
  let usage = { input: 0, output: 0 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let res;
    try {
      res = await modelChat({
        model: chatModel(bot, chat), purpose: 'bot', maxTokens: bot.maxTokens,
        system: systemPrompt({ bot, role, isGroup, chatName: ctx.chatName }), tools: defs, messages,
      });
    } catch (e) {
      const friendly = friendlyModelError(e);
      if (!friendly) throw e;
      activity('error', { bot: bot.id, chat, summary: `Model error: ${e.message}`, detail: { code: e.code } });
      return friendly;
    }
    ctx.model = res.model;
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
      const out = await run(call.name, call.input, { ...ctx, toolName: call.name });
      let content = String(out.text ?? '').slice(0, 12000);
      activity(out.isError ? 'tool.error' : 'tool.call', {
        bot: bot.id, chat,
        summary: `${m?.fq || call.name} (${Date.now() - started} ms)${out.isError ? ' failed' : ''}`,
        detail: { input: call.input, output: content.slice(0, 2000), role },
      });

      if (!out.isError && m?.kind === 'mcp' && bot.confirm && matchesAny(m.fq, [bot.confirm.preview])) {
        const confirmId = extractConfirmId(out.text, bot.confirm.idField || 'confirm_id');
        if (confirmId) {
          const code = newCode();
          const [server, confirmTool] = bot.confirm.tool.split(':');
          addPending({
            code, bot: bot.id, server, confirmTool, confirmId, tool: m.fq, chat,
            requester: ctx.requester, summary: content.slice(0, 500),
            expires: Date.now() + (bot.confirm.ttlMinutes || 9) * 60000,
          });
          codes.push(code);
          content = content.split(confirmId).join('[held for organizer confirmation]');
          activity('confirm.created', { bot: bot.id, chat, summary: `${code}: ${m.fq}`, detail: { input: call.input } });
        }
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, is_error: out.isError, content });
    }
    messages.push({ role: 'user', content: results });
  }

  for (const code of codes) {
    reply += `\n\nOrganizer: reply *confirm ${code}* to apply, or *cancel ${code}* (valid ${bot.confirm.ttlMinutes || 9} min).`;
  }
  ctx.usage = usage;
  activity('model.usage', { bot: bot.id, chat, summary: `${ctx.model || bot.model}: ${usage.input} in / ${usage.output} out` });
  return reply.trim() || null;
}

/** "confirm ABCD" / "cancel ABCD". Returns reply text, or undefined when it isn't for us. */
export async function handleConfirmCommand({ bot, text, role, chat }) {
  const m = String(text).trim().match(/^(confirm|cancel)\s+([A-Z0-9]{4})$/i);
  if (!m) return undefined;
  const code = m[2].toUpperCase();
  const p = peekPending(code);
  if (!p || p.bot !== bot.id) return undefined;
  if (role !== 'organizer') return 'Only organizers can confirm or cancel changes.';
  if (p.chat !== chat) return `Change ${code} belongs to another chat; confirm it there.`;
  if (/^cancel$/i.test(m[1])) {
    dropPending(code);
    activity('confirm.cancelled', { bot: bot.id, chat, summary: code });
    return `Cancelled ${code}.`;
  }
  const row = takePending(code);
  if (!row) return `Change ${code} has expired — ask me again.`;
  return applyPending(bot, row);
}

export async function applyPending(bot, row) {
  const conn = organizerConnection(bot, row.server);
  const out = await conn.call(row.confirm_tool, { [bot.confirm.idField || 'confirm_id']: row.confirm_id });
  activity(out.isError ? 'tool.error' : 'confirm.applied', {
    bot: bot.id, chat: row.chat, summary: `${row.code}: ${row.tool}${out.isError ? ' failed' : ''}`, detail: { output: out.text.slice(0, 1000) },
  });
  return out.isError ? `Could not apply ${row.code}: ${out.text.slice(0, 300)}` : `Done (${row.code}). ${out.text.slice(0, 300)}`;
}
