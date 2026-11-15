// Built-in WhatsApp tools (026), exposed to the model as whatsapp__<name>. Same shape as the memory tools.
// Role rules are code (constitution III): participants get the send/react/poll-type tools by default, organizers all;
// powerful actions (people, group settings, block, delete) are organizer-only whatever the rules say, and are applied
// immediately (owner decision on issue #2: no confirm code). Every action is logged as `whatsapp.action`.
import { digits } from './config.js';
import {
  logMessage, messageByMsgId, lastBotMessage, setMessageText, searchMessages, namesInChat, getPoll, latestPoll, recentPolls, pollTally,
} from './db.js';
import { activity } from './events.js';

let channel = null;
/** The channel the tools act through (set by the router and the panel at startup). */
export const setWhatsAppChannel = (ch) => { channel = ch; };
export const whatsappChannel = () => channel;

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const clip = (s, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const jidOf = (chat) => { const i = String(chat).indexOf('#'); return i > 0 ? chat.slice(i + 1) : String(chat); };
export const isGroupChat = (chat) => jidOf(chat).endsWith('@g.us');
const isWhatsAppChat = (chat) => /@(g\.us|s\.whatsapp\.net|lid)$/.test(jidOf(chat || ''));

export const WHATSAPP_PARTICIPANT_DEFAULT = ['send_media', 'send_location', 'react', 'reply', 'create_poll', 'poll_results', 'group_info', 'profile_info'];
export const WHATSAPP_DEFAULT_ALLOW = {
  organizer: ['whatsapp:*'],
  participant: WHATSAPP_PARTICIPANT_DEFAULT.map((n) => `whatsapp:${n}`),
};

/**
 * Rules for whatsapp tools of a role: the role's explicit `whatsapp:` rules when it has any (the editor writes them,
 * `whatsapp:-` = none), otherwise the defaults above.
 */
export function whatsappRules(bot, role) {
  const explicit = (bot.tools?.[role] || []).filter((r) => r.startsWith('whatsapp:'));
  return explicit.length ? explicit : WHATSAPP_DEFAULT_ALLOW[role] || [];
}

// ---------- shared helpers ----------
function need() { if (!channel) fail('WhatsApp is not available here', 503); return channel; }

/** The chat to act on: the current one, or another chat (id or group name) bound to the same bot. */
async function targetChat(input, ctx) {
  const want = String(input.chat || '').trim();
  if (!want || want === ctx.chat) {
    if (!isWhatsAppChat(ctx.chat)) fail('There is no WhatsApp chat here; name the group (chat) to act on');
    return ctx.chat;
  }
  const bound = ctx.bot.chats || [];
  if (bound.includes(want)) return want;
  for (const c of bound) {
    const name = await channel?.chatName?.(c).catch(() => '');
    if (name && name.toLowerCase() === want.toLowerCase()) return c;
  }
  return fail('I can only act in this chat or in other chats this bot is in');
}
const needGroup = (chat) => { if (!isGroupChat(chat)) fail('This only works in a WhatsApp group'); };

/** A stored message → { msgId, fromMe, participant, text }. `message` = id or a few words of it (latest match). */
function findMessage(chat, message, fallback) {
  const want = String(message || '').trim();
  let row = null;
  if (want) {
    row = messageByMsgId(chat, want);
    if (!row) {
      const hits = searchMessages(chat, want, 30).filter((m) => m.msg_id);
      row = hits.filter((m) => String(m.text).toLowerCase().includes(want.toLowerCase())).at(-1) || hits.at(-1) || null; // own text before quotes
    }
    if (!row) fail(`No stored message in this chat matches "${clip(want, 60)}"`);
  } else {
    row = fallback();
    if (!row) fail('Which message? Give its id or a few words of it');
  }
  return { msgId: row.msg_id, fromMe: !!row.from_bot, participant: row.sender_jid || '', text: row.text || '', row };
}
const current = (chat, ctx) => () => (ctx.msgId ? messageByMsgId(chat, ctx.msgId) || (chat === ctx.chat
  ? { msg_id: ctx.msgId, from_bot: 0, sender_jid: ctx.senderJid || '', text: ctx.text || '' } : null) : null);

/** The bot's own sends are stored like its replies (context, edit/delete later). */
function remember(ctx, chat, msgId, text) {
  logMessage({ chat, bot: ctx.bot.id, msgId: msgId || null, sender: 'bot', name: 'Assistant', text, fromBot: true });
}
function people(input) {
  const list = Array.isArray(input.people) ? input.people : String(input.people || '').split(/[,\n]/);
  const out = list.map((p) => String(p).trim()).filter(Boolean);
  if (!out.length) fail('Name at least one person (phone number with country code)');
  if (out.length > 20) fail('At most 20 people at once');
  return out;
}
const ACTION_WORD = { add: 'Added', remove: 'Removed', promote: 'Made admin', demote: 'No longer admin' };
async function participantsAction(input, ctx, action) {
  const chat = await targetChat(input, ctx); needGroup(chat);
  const res = await need().groupParticipants(chat, people(input), action);
  const failed = res.filter((r) => !r.ok);
  return { chat, result: { done: res.filter((r) => r.ok).length, failed: failed.map((r) => ({ who: r.who, status: r.status })) },
    summary: `${ACTION_WORD[action]} ${res.filter((r) => r.ok).length} of ${res.length}` };
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const CHAT = str('Optional: another chat this bot is in (group name or chat id). Default: the current chat.');
const MESSAGE = (dflt) => str(`Optional: the message, as its id or a few words of it. Default: ${dflt}.`);
const PEOPLE = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'Phone numbers with country code, e.g. "+41 79 123 45 67"' };

/**
 * Tool definitions. roles = who may ever get the tool (organizer-only tools stay off participants even if ticked).
 * run returns { chat, result, summary } — summary is for the activity log, result goes to the model.
 */
const DEFS = [
  { name: 'send_media', roles: ['organizer', 'participant'],
    description: 'Send an image, GIF, video, sticker, audio (voice note) or document to the chat from a public https URL (or base64). Max 16 MB. Use for pictures, flyers, PDFs, maps.',
    input_schema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['image', 'gif', 'video', 'sticker', 'audio', 'document'], description: 'What to send. GIFs are sent as looping MP4; stickers must be WebP; voice notes OGG/Opus.' },
      url: str('Public http(s) URL of the file'), base64: str('Or the file as base64 (data: URL allowed)'), mimetype: str('Content type when giving base64, e.g. image/png'),
      caption: str('Optional caption (image, GIF, video, document)', { maxLength: 1000 }), file_name: str('File name shown for documents'), chat: CHAT,
    }, required: ['kind'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const r = await need().sendMedia(chat, { kind: input.kind, url: input.url, base64: input.base64, mimetype: input.mimetype, caption: input.caption || '', fileName: input.file_name || '' });
      const label = `[${input.kind === 'audio' ? 'voice note' : input.kind}${input.caption ? `: ${clip(input.caption, 300)}` : ''}]`;
      remember(ctx, chat, r.msgId, label);
      return { chat, result: { sent: true, msgId: r.msgId, type: r.mimetype, ...(r.asStill ? { note: 'Sent as a still image (use an MP4 for a moving GIF)' } : {}) }, summary: `${label} ${r.bytes} bytes` };
    } },
  { name: 'send_location', roles: ['organizer', 'participant'],
    description: 'Send a location pin (latitude/longitude, optional place name and address) to the chat.',
    input_schema: { type: 'object', properties: { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 },
      name: str('Place name'), address: str('Address'), chat: CHAT }, required: ['latitude', 'longitude'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const r = await need().sendLocation(chat, { latitude: input.latitude, longitude: input.longitude, name: input.name || '', address: input.address || '' });
      const label = `[location${input.name ? `: ${clip(input.name, 100)}` : ''} (${input.latitude}, ${input.longitude})]`;
      remember(ctx, chat, r.msgId, label);
      return { chat, result: { sent: true, msgId: r.msgId }, summary: label };
    } },
  { name: 'send_contact', roles: ['organizer', 'participant'],
    description: 'Send a contact card (name and phone number) to the chat.',
    input_schema: { type: 'object', properties: { name: str('Contact name'), phone: str('Phone number with country code'), org: str('Optional organisation'), chat: CHAT }, required: ['name', 'phone'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const r = await need().sendContact(chat, { name: input.name, phone: input.phone, org: input.org || '' });
      remember(ctx, chat, r.msgId, `[contact: ${clip(input.name, 80)}]`);
      return { chat, result: { sent: true, msgId: r.msgId }, summary: `[contact: ${clip(input.name, 80)}]` };
    } },
  { name: 'react', roles: ['organizer', 'participant'],
    description: 'React to a message with an emoji (e.g. 👍 ✅ ❤️), or remove your reaction with an empty emoji. Default: the message you are answering.',
    input_schema: { type: 'object', properties: { emoji: str('One emoji; empty removes the reaction', { maxLength: 16 }), message: MESSAGE('the message you are answering'), chat: CHAT }, required: ['emoji'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const ref = findMessage(chat, input.message, current(chat, ctx));
      await need().react(chat, ref, input.emoji || '');
      return { chat, result: { ok: true }, summary: `${input.emoji ? `Reacted ${input.emoji}` : 'Removed reaction'} to "${clip(ref.text, 80)}"` };
    } },
  { name: 'reply', roles: ['organizer', 'participant'],
    description: 'Send a text that quotes (replies to) a specific earlier message, e.g. to answer an older question. Your normal answer already quotes the current message; use this only for another message.',
    input_schema: { type: 'object', properties: { text: str('Your reply', { maxLength: 4000 }), message: MESSAGE('the message you are answering'), chat: CHAT }, required: ['text'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const ref = findMessage(chat, input.message, current(chat, ctx));
      const r = await need().send(chat, String(input.text), { quote: ref });
      logMessage({ chat, bot: ctx.bot.id, msgId: r?.msgId || null, sender: 'bot', name: 'Assistant', text: String(input.text), quoted: ref.text, fromBot: true });
      return { chat, result: { sent: true, msgId: r?.msgId || null }, summary: `Replied to "${clip(ref.text, 60)}": ${clip(input.text, 120)}` };
    } },
  { name: 'edit_message', roles: ['organizer', 'participant'],
    description: 'Change the text of a message you (the assistant) sent earlier. Default: your last message in this chat.',
    input_schema: { type: 'object', properties: { text: str('New text', { maxLength: 4000 }), message: MESSAGE('your last message'), chat: CHAT }, required: ['text'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const ref = findMessage(chat, input.message, () => lastBotMessage(chat));
      if (!ref.fromMe) fail('Only messages the assistant sent can be edited');
      await need().editMessage(chat, ref.msgId, String(input.text));
      setMessageText(chat, ref.msgId, String(input.text));
      return { chat, result: { ok: true }, summary: `Edited "${clip(ref.text, 60)}" → "${clip(input.text, 80)}"` };
    } },
  { name: 'delete_message', roles: ['organizer'],
    description: 'Delete a message for everyone: one the assistant sent (default: its last message), or someone else\'s in a group where the assistant is admin.',
    input_schema: { type: 'object', properties: { message: MESSAGE('your last message'), chat: CHAT } },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const ref = findMessage(chat, input.message, () => lastBotMessage(chat));
      if (!ref.fromMe) needGroup(chat);
      await need().deleteMessage(chat, ref);
      setMessageText(chat, ref.msgId, '[deleted]');
      return { chat, result: { ok: true }, summary: `Deleted "${clip(ref.text, 80)}"` };
    } },
  { name: 'create_poll', roles: ['organizer', 'participant'],
    description: 'Post a WhatsApp poll with 2–12 options; single choice by default or several answers with multiple=true. Votes arrive automatically; read them with poll_results.',
    input_schema: { type: 'object', properties: { question: str('The poll question', { maxLength: 255 }), options: { type: 'array', items: { type: 'string', maxLength: 100 }, minItems: 2, maxItems: 12 },
      multiple: { type: 'boolean', description: 'Allow several answers (default false)' }, chat: CHAT }, required: ['question', 'options'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const r = await need().sendPoll(chat, { name: input.question, options: input.options, multi: !!input.multiple });
      const label = `[poll: ${clip(input.question, 200)} — ${(input.options || []).join(' / ')}]`;
      remember(ctx, chat, r.msgId, label);
      return { chat, result: { posted: true, msgId: r.msgId }, summary: label };
    } },
  { name: 'poll_results', roles: ['organizer', 'participant'],
    description: 'Current votes of a poll in this chat (default: the latest poll): count and who voted per option.',
    input_schema: { type: 'object', properties: { poll: str('Optional: poll id or words of its question. Default: the latest poll.'), chat: CHAT } },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      let p = null;
      if (input.poll) p = getPoll(chat, input.poll) || findPollByQuestion(chat, input.poll);
      else p = latestPoll(chat);
      if (!p) fail('No poll found in this chat (only polls created while this app was running are tracked)');
      const options = pollTally(p);
      return { chat, result: { question: p.name, multiple: p.selectable !== 1, voters: Object.keys(p.votes).length, options }, summary: `Poll "${clip(p.name, 60)}": ${options.map((o) => `${o.name} ${o.votes}`).join(', ')}` };
    } },
  { name: 'group_info', roles: ['organizer', 'participant'],
    description: 'Facts about the group: name, description, settings, member count, admins and members (names; phone numbers only for organizers).',
    input_schema: { type: 'object', properties: { chat: CHAT } },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx); needGroup(chat);
      const g = await need().groupInfo(chat);
      const names = namesInChat(chat);
      const showPhones = ctx.role === 'organizer';
      const members = g.participants.map((p) => ({ name: names[p.phone] || (showPhones && p.phone ? `+${p.phone}` : 'member'), ...(showPhones && p.phone ? { phone: `+${p.phone}` } : {}), ...(p.admin ? { admin: true } : {}) }));
      return { chat, result: { name: g.subject, description: g.description, members: g.size, onlyAdminsSend: g.announcement, onlyAdminsEditInfo: g.locked, joinApproval: g.joinApproval,
        admins: members.filter((m) => m.admin).map((m) => m.name), people: members }, summary: `Group info (${g.size} members)` };
    } },
  { name: 'group_invite_link', roles: ['organizer', 'participant'],
    description: 'Get the invite link of the group (the assistant must be a group admin).',
    input_schema: { type: 'object', properties: { chat: CHAT } },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx); needGroup(chat);
      const r = await need().groupInviteLink(chat);
      return { chat, result: r, summary: 'Invite link read' };
    } },
  { name: 'revoke_invite_link', roles: ['organizer'],
    description: 'Reset the group invite link: the old link stops working and a new one is returned.',
    input_schema: { type: 'object', properties: { chat: CHAT } },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx); needGroup(chat);
      const r = await need().groupRevokeInvite(chat);
      return { chat, result: r, summary: 'Invite link reset' };
    } },
  { name: 'add_participants', roles: ['organizer'], description: 'Add people to the group by phone number (the assistant must be a group admin). Applied immediately.',
    input_schema: { type: 'object', properties: { people: PEOPLE, chat: CHAT }, required: ['people'] }, run: (i, c) => participantsAction(i, c, 'add') },
  { name: 'remove_participants', roles: ['organizer'], description: 'Remove people from the group by phone number (the assistant must be a group admin). Applied immediately.',
    input_schema: { type: 'object', properties: { people: PEOPLE, chat: CHAT }, required: ['people'] }, run: (i, c) => participantsAction(i, c, 'remove') },
  { name: 'promote', roles: ['organizer'], description: 'Make group members admins (by phone number). Applied immediately.',
    input_schema: { type: 'object', properties: { people: PEOPLE, chat: CHAT }, required: ['people'] }, run: (i, c) => participantsAction(i, c, 'promote') },
  { name: 'demote', roles: ['organizer'], description: 'Remove admin rights from group admins (by phone number). Applied immediately.',
    input_schema: { type: 'object', properties: { people: PEOPLE, chat: CHAT }, required: ['people'] }, run: (i, c) => participantsAction(i, c, 'demote') },
  { name: 'set_group_subject', roles: ['organizer'], description: 'Rename the group.',
    input_schema: { type: 'object', properties: { subject: str('New group name', { minLength: 1, maxLength: 100 }), chat: CHAT }, required: ['subject'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx); needGroup(chat);
      if (!String(input.subject || '').trim()) fail('The group name cannot be empty');
      await need().groupSubject(chat, String(input.subject).trim());
      return { chat, result: { ok: true }, summary: `Group renamed to "${clip(input.subject, 100)}"` };
    } },
  { name: 'set_group_description', roles: ['organizer'], description: 'Change the group description (empty clears it).',
    input_schema: { type: 'object', properties: { description: str('New description', { maxLength: 2048 }), chat: CHAT }, required: ['description'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx); needGroup(chat);
      await need().groupDescription(chat, String(input.description || ''));
      return { chat, result: { ok: true }, summary: `Description set: ${clip(input.description, 120) || '(cleared)'}` };
    } },
  { name: 'set_group_picture', roles: ['organizer'], description: 'Set the group picture from a public image URL (JPEG/PNG).',
    input_schema: { type: 'object', properties: { url: str('Public http(s) image URL'), chat: CHAT }, required: ['url'] },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx); needGroup(chat);
      await need().groupPicture(chat, { url: input.url });
      return { chat, result: { ok: true }, summary: 'Group picture changed' };
    } },
  { name: 'set_group_settings', roles: ['organizer'],
    description: 'Group settings: only_admins_send (announcement group), only_admins_edit_info (lock name/picture/description), join_approval (admins approve new members). Give only what changes.',
    input_schema: { type: 'object', properties: { only_admins_send: { type: 'boolean' }, only_admins_edit_info: { type: 'boolean' }, join_approval: { type: 'boolean' }, chat: CHAT } },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx); needGroup(chat);
      const s = { announcement: input.only_admins_send, locked: input.only_admins_edit_info, joinApproval: input.join_approval };
      const changed = Object.entries(s).filter(([, v]) => typeof v === 'boolean');
      if (!changed.length) fail('Nothing to change: give only_admins_send, only_admins_edit_info or join_approval');
      await need().groupSettings(chat, Object.fromEntries(changed));
      return { chat, result: { ok: true }, summary: `Settings: ${changed.map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')}` };
    } },
  { name: 'profile_info', roles: ['organizer', 'participant'],
    description: 'WhatsApp profile of a person: name seen in this chat, "about" text and profile picture link. Default: the person you are talking to.',
    input_schema: { type: 'object', properties: { person: str('Phone number with country code (default: the sender)'), chat: CHAT } },
    async run(input, ctx) {
      const chat = await targetChat(input, ctx);
      const who = String(input.person || ctx.requester || '').trim();
      if (!who) fail('Whose profile? Give a phone number');
      if (ctx.role !== 'organizer' && digits(who) !== digits(ctx.requester || '')) {
        const names = namesInChat(chat);
        if (!names[digits(who)]) fail('Participants can look up people of this chat only');
      }
      const p = await need().profile(chat, who);
      const name = namesInChat(chat)[digits(p.phone || who)] || '';
      return { chat, result: { name, about: p.about, pictureUrl: p.pictureUrl, ...(ctx.role === 'organizer' ? { phone: p.phone ? `+${p.phone}` : '' } : {}) }, summary: `Profile of ${name || 'a person'}` };
    } },
  { name: 'block', roles: ['organizer'], description: 'Block a phone number on this WhatsApp number (they can no longer message it). Applied immediately.',
    input_schema: { type: 'object', properties: { person: str('Phone number with country code') }, required: ['person'] },
    async run(input, ctx) {
      const d = digits(input.person);
      if ((ctx.bot.organizers || []).includes(d)) fail('Organizers of this bot cannot be blocked');
      const chat = isWhatsAppChat(ctx.chat) ? ctx.chat : (ctx.bot.chats || [])[0];
      if (!chat) fail('No WhatsApp number to act on');
      await need().block(chat, input.person);
      return { chat, result: { blocked: true }, summary: `Blocked +${d}` };
    } },
  { name: 'unblock', roles: ['organizer'], description: 'Unblock a phone number on this WhatsApp number.',
    input_schema: { type: 'object', properties: { person: str('Phone number with country code') }, required: ['person'] },
    async run(input, ctx) {
      const chat = isWhatsAppChat(ctx.chat) ? ctx.chat : (ctx.bot.chats || [])[0];
      if (!chat) fail('No WhatsApp number to act on');
      await need().unblock(chat, input.person);
      return { chat, result: { unblocked: true }, summary: `Unblocked +${digits(input.person)}` };
    } },
];

function findPollByQuestion(chat, words) {
  const w = String(words).toLowerCase();
  return recentPolls(chat, 50).reverse().find((p) => p.name.toLowerCase().includes(w)) || null;
}

const scrubInput = (input) => Object.fromEntries(Object.entries(input || {}).map(([k, v]) => [k, k === 'base64' ? `(${String(v).length} chars)` : v]));

/** Tools in the memory-tool shape: run(input, ctx) logs `whatsapp.action` and returns the result for the model. */
export const whatsappTools = DEFS.map((d) => ({
  name: d.name, description: d.description, input_schema: d.input_schema, roles: d.roles,
  async run(input, ctx) {
    if (!d.roles.includes(ctx.role)) fail('Only organizers can do this');
    try {
      const out = await d.run(input || {}, ctx);
      activity('whatsapp.action', { bot: ctx.bot.id, chat: out.chat, summary: `${d.name} by ${ctx.senderName || 'someone'} (${ctx.role}): ${out.summary}`,
        detail: { tool: d.name, input: scrubInput(input), role: ctx.role, by: ctx.senderName || '', from: ctx.chat } });
      return out.result;
    } catch (e) {
      activity('whatsapp.action', { bot: ctx.bot.id, chat: ctx.chat, summary: `${d.name} by ${ctx.senderName || 'someone'} (${ctx.role}) failed: ${e.message}`,
        detail: { tool: d.name, input: scrubInput(input), role: ctx.role, error: e.message } });
      throw e;
    }
  },
}));
export const WHATSAPP_TOOL_NAMES = whatsappTools.map((t) => t.name);
/** For the bot editor: name, description, which roles may have it and the participant default. */
export const whatsappToolCatalog = () => whatsappTools.map((t) => ({ name: t.name, description: t.description, organizerOnly: !t.roles.includes('participant'),
  participantDefault: WHATSAPP_PARTICIPANT_DEFAULT.includes(t.name) }));
