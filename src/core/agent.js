import Anthropic from '@anthropic-ai/sdk';
import { env, getSecret, onSecretChange } from './config.js';
import { history, addPending, takePending, peekPending, dropPending } from './db.js';
import { activity } from './events.js';
import { toolsFor, matchesAny, organizerConnection } from './tools.js';

let anthropic = null;
onSecretChange((name) => { if (name === 'ANTHROPIC_API_KEY') anthropic = null; });
function claude() {
  const apiKey = getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (Panel → Secrets)');
  if (!anthropic) anthropic = new Anthropic({ apiKey });
  return anthropic;
}

const MAX_TOOL_ROUNDS = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

function systemPrompt({ bot, role, isGroup }) {
  const now = new Date().toLocaleString('en-GB', { timeZone: bot.timezone || env.timezone });
  const roleText = role === 'organizer'
    ? (bot.confirm
      ? 'They are an organizer: they may request changes. Make changes only through the matching preview tool, then summarise the preview clearly. The system adds a confirm code; never claim a change is done before it is confirmed.'
      : 'They are an organizer.')
    : 'They are a participant: they can ask questions. If they want something changed, say an organizer needs to do it.';
  return [
    bot.prompt.trim(),
    `Current time: ${now} (${bot.timezone || env.timezone}). Chat type: ${isGroup ? 'WhatsApp group (shared, keep personal details out)' : 'WhatsApp direct message'}.`,
    roleText,
    'Write for WhatsApp: short plain text, *bold* sparingly, simple "-" lists, no markdown headings or tables.',
    bot.extraPrompt?.trim() || '',
  ].filter(Boolean).join('\n\n');
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

  const past = history(chat, bot.historySize)
    .filter((m) => !(m.from_bot === 0 && m.text === text))
    .map((m) => `${m.from_bot ? 'Assistant' : m.name || m.sender}: ${m.text}`)
    .join('\n');
  const messages = [{
    role: 'user',
    content: `${past ? `Recent chat:\n${past}\n\n` : ''}New message from ${senderName} (${role}):\n${text}`,
  }];

  const codes = [];
  let reply = '';
  let usage = { input: 0, output: 0 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await claude().messages.create({
      model: bot.model,
      max_tokens: bot.maxTokens,
      system: systemPrompt({ bot, role, isGroup }),
      tools: defs,
      messages,
    });
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
