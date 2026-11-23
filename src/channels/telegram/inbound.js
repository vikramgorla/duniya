// @ts-check
// What a Telegram message is to the app (077): its words, the placeholder agents see for media, what can be downloaded
// and whether it addresses the bot. Pure functions: no state and no network.
import { clip } from '../../core/config.js';
import { DOWNLOAD_LIMIT } from './api.js';

export const nameOf = (u) => clip([u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || '', 60);
export const isGroupType = (t) => t === 'group' || t === 'supergroup';
export const textOf = (m) => m.text || m.caption || '';
const entitiesOf = (m) => m.entities || m.caption_entities || [];
const spot = (l) => `(${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)})`;

/** What agents see for messages without text: a placeholder, never the media itself (as on WhatsApp). */
function describe(m) {
  const cap = m.caption ? `: ${clip(m.caption, 300)}` : '';
  if (m.photo) return `[image${cap}]`;
  if (m.animation) return `[GIF${cap}]`;
  if (m.video || m.video_note) return `[video${cap}]`;
  if (m.sticker) return '[sticker]';
  if (m.voice) return '[voice note]';
  if (m.audio) return `[audio${cap}]`;
  if (m.document) return `[document: ${clip(m.document.file_name || 'file', 120)}${m.caption ? ` — ${clip(m.caption, 200)}` : ''}]`;
  if (m.venue) return `[location: ${clip(m.venue.title, 100)}, ${clip(m.venue.address, 120)} ${spot(m.venue.location)}]`;
  if (m.location) return `[location ${spot(m.location)}]`;
  if (m.contact) return `[contact: ${clip(nameOf(m.contact) || 'contact', 80)}]`;
  if (m.poll) return `[poll: ${clip(m.poll.question, 200)} — ${m.poll.options.map((o) => clip(o.text, 60)).join(' / ')}]`;
  return '';
}

/** The largest size of a photo this server takes (Telegram sends several), else the smallest. */
const photoOf = (sizes) => sizes.filter((x) => (x.file_size || 0) <= DOWNLOAD_LIMIT).at(-1) || sizes[0];
const sound = (a, mimetype, extra = {}) => ({ info: { type: 'audio', mimetype: a.mime_type || mimetype, size: a.file_size || 0, seconds: a.duration || 0, ...extra }, ref: a.file_id });

/** Photos & voice: what the message holds, without downloading it (`size` is Telegram's declared size). */
export function mediaOf(m) {
  if (m.photo?.length) { const p = photoOf(m.photo); return { info: { type: 'image', mimetype: 'image/jpeg', size: p.file_size || 0 }, ref: p.file_id }; }
  if (m.voice) return sound(m.voice, 'audio/ogg', { ptt: true });
  if (m.audio) return sound(m.audio, 'audio/mpeg');
  if (m.sticker && !m.sticker.is_animated && !m.sticker.is_video) return { info: { type: 'sticker', mimetype: 'image/webp', size: m.sticker.file_size || 0 }, ref: m.sticker.file_id };
  // 096: GIFs and videos (an animation comes with a document too: it is the GIF)
  for (const [type, v] of [['gif', m.animation], ['video', m.video]]) if (v) return { info: { type, mimetype: v.mime_type || 'video/mp4', size: v.file_size || 0, seconds: v.duration || 0 }, ref: v.file_id };
  if (m.document) return { info: { type: 'document', mimetype: m.document.mime_type || '', size: m.document.file_size || 0, fileName: m.document.file_name || '' }, ref: m.document.file_id };
  return null;
}

/** `text` without [from, to), and without the double space that would stay behind. */
function without(text, from, to) {
  const before = text.slice(0, from); const after = text.slice(to);
  return `${before}${(!before || before.endsWith(' ')) && after.startsWith(' ') ? after.slice(1) : after}`;
}

/**
 * The words of a message without the bot's own "@handle", and whether it addresses the bot: an "@bot" mention, a text
 * mention of the bot, or a command for it ("/rides@bot" → "/rides"). The rest of the text stays as written.
 */
function addressOf(m, me) {
  let text = textOf(m); let mentioned = false;
  const handle = `@${String(me.username || '').toLowerCase()}`;
  for (const e of [...entitiesOf(m)].sort((a, b) => b.offset - a.offset)) { // from the end: the offsets before a cut stay right
    const end = e.offset + e.length;
    const part = text.slice(e.offset, end).toLowerCase();
    if (e.type === 'text_mention' && e.user?.id === me.id) mentioned = true;
    else if (e.type === 'mention' && part === handle) { mentioned = true; text = without(text, e.offset, end); }
    else if (e.type === 'bot_command' && part.endsWith(handle)) { mentioned = true; text = without(text, end - handle.length, end); }
  }
  return { text: text.trim(), mentioned };
}

/**
 * The app's fields of a message with words or media (see hub.js), or null when it carries neither (a service message).
 * `me`: the bot (getMe).
 */
export function contentOf(m, me) {
  const { text, mentioned } = addressOf(m, me);
  const placeholder = describe(m);
  const body = placeholder && !m.text ? placeholder : text;
  if (!String(body).trim()) return null;
  const quotedMsg = m.reply_to_message;
  return {
    msgId: String(m.message_id), ts: m.date * 1000, kind: 'text', text: body, caption: placeholder ? text : '', media: !!placeholder,
    quoted: quotedMsg ? clip(textOf(quotedMsg) || describe(quotedMsg), 500) : '',
    mentioned, replyToAgent: quotedMsg?.from?.id === me.id, raw: { message_id: m.message_id },
  };
}
