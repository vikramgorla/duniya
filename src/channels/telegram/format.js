// @ts-check
// Text for Telegram (077). Agents write WhatsApp markup (*bold*, _italic_, ~strike~, `code`, ```block```); Telegram
// gets plain text plus "entities" (offsets in UTF-16 units, which is how JavaScript counts), so nothing is parsed as
// HTML or Markdown on Telegram's side and no text can break the message. Long texts are cut into messages of at most
// 4096 characters, at a line break when possible.
const MAX_TEXT = 4096;

const MARKS = [
  ['```', 'pre'], ['`', 'code'], ['*', 'bold'], ['_', 'italic'], ['~', 'strikethrough'],
];
const WORD = /[\p{L}\p{N}]/u;

/**
 * WhatsApp markup → { text, entities }. A marker counts only around non-space text and not inside a word
 * (snake_case and 2*3*4 stay as they are); markers are not nested.
 * @param {string} input
 */
export function toEntities(input) {
  const s = String(input ?? '');
  let out = ''; const entities = [];
  let i = 0;
  while (i < s.length) {
    const hit = MARKS.find(([m]) => s.startsWith(m, i));
    if (hit) {
      const [m, type] = hit;
      const end = s.indexOf(m, i + m.length);
      const inner = end > i + m.length ? s.slice(i + m.length, end) : '';
      const edgesOk = m === '```' || (!/^\s|\s$/.test(inner) && !inner.includes('\n'));
      const outside = (ch) => !ch || !WORD.test(ch);
      if (inner && edgesOk && outside(s[i - 1]) && outside(s[end + m.length])) {
        const text = m === '```' ? inner.replace(/^\n/, '') : inner;
        entities.push({ type, offset: out.length, length: text.length });
        out += text;
        i = end + m.length;
        continue;
      }
    }
    out += s[i]; i++;
  }
  return { text: out, entities };
}

/** Cut text into parts of at most `max` characters, at a line break (else a space) in the last third when possible. */
export function chunks(text, max = MAX_TEXT) {
  const parts = [];
  let rest = String(text ?? '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.66) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.66) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, '');
  }
  if (rest || !parts.length) parts.push(rest);
  return parts;
}

// Telegram accepts only these reaction emoji; common ones agents use are mapped to the nearest allowed one.
const ALLOWED = new Set(['👍', '👎', '❤', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡', '🥱',
  '🥴', '😍', '🐳', '❤‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈', '😴', '😭', '🤓', '👻', '👨‍💻', '👀',
  '🎃', '🙈', '😇', '😨', '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿', '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂', '🤷', '🤷‍♀', '😡']);
const NEAREST = { '✅': '👌', '✔': '👌', '☑': '👌', '⏳': '👀', '⌛': '👀', '😂': '🤣', '😊': '😁', '🙂': '😁', '😀': '😁', '💪': '🔥', '🥳': '🎉', '👋': '🤗', '❌': '👎', '🚗': '👌' };
/** The reaction Telegram accepts for an emoji ('' removes), or null when there is none close enough. */
export function reactionFor(emoji) {
  const e = String(emoji || '').replace(/\uFE0F|\p{Emoji_Modifier}/gu, ''); // no variation selectors or skin tones
  if (!e) return '';
  if (ALLOWED.has(e)) return e;
  return NEAREST[e] || null;
}
export const SOME_REACTIONS = '👍 ❤ 🔥 🎉 👌 🙏 😁 🤣 👀 💯';
