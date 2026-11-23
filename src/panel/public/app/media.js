// Rich messages (096): a stored message's photo, sticker, GIF, video or voice note in the panel (a chat's Messages, an
// agent's Review, an Activity entry). Module of the panel (063), loaded with the screens that show messages. Nothing is
// fetched until it is about to be seen: photos load lazily, GIFs when they scroll near, videos and voice notes when
// played. What the chat app no longer has says so in place of the picture.
import { h } from './core.js';

const WORD = { image: 'Photo', sticker: 'Sticker', gif: 'GIF', video: 'Video', audio: 'Voice note' };
// The line a stored message keeps for its media ("[GIF: happy]", "[image: at the lake]"): shown as the media instead
const PLACEHOLDER = /^\[(?:image|photo|gif|video|sticker|voice note|audio)(?::\s*([\s\S]*?))?\]$/i;
const NEAR = '200px'; // a GIF starts loading this far before it scrolls into view

/**
 * A message's words beside its media: without the placeholder line. `label`: what the placeholder said (a person's
 * caption, or the mood of a GIF an agent shared).
 */
export function wordsBeside(text) {
  const lines = String(text || '').split('\n');
  const m = PLACEHOLDER.exec(lines.at(-1).trim());
  return m ? { text: lines.slice(0, -1).join('\n'), label: m[1] || '' } : { text: String(text || ''), label: '' };
}

/** GIFs play while they are on screen, and load only when they come near. */
const gifs = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
  for (const { target: v, isIntersecting: near } of entries) {
    if (!near) { v.pause(); continue; }
    if (!v.getAttribute('src')) v.src = v.dataset.src;
    v.play().catch(() => {}); // the browser may refuse to play (power saving): the first frame stays
  }
}, { rootMargin: NEAR }) : null;

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
function player(media, src, what) {
  if (media.mimetype.startsWith('image/')) return h('img', { src, alt: what, loading: 'lazy', decoding: 'async' });
  if (media.type === 'gif') {
    const v = h('video', { muted: true, loop: true, playsinline: true, preload: 'none', 'aria-label': what, 'data-src': src });
    v.muted = true; // the property, not only the attribute: browsers play muted videos by themselves
    if (gifs) gifs.observe(v); else v.src = src;
    return v;
  }
  return h(media.type === 'audio' ? 'audio' : 'video', { src, controls: true, preload: 'none', playsinline: true, 'aria-label': what });
}

/**
 * The media of stored message `id` in `chat` (`media` as the server describes it), or null when the panel does not show
 * it inline (documents, files too large for this server). `label`: words for it (alt text, title).
 */
export function messageMedia(chat, id, media, label = '') {
  if (!media?.shown) return null;
  const src = `/api/chats/${encodeURIComponent(chat)}/messages/${id}/media`;
  const what = label ? `${WORD[media.type]}: ${label}` : WORD[media.type];
  const el = player(media, src, what);
  const box = h('div', { class: `msg-media ${media.type}` },
    media.mimetype.startsWith('image/') ? h('a', { href: src, target: '_blank', rel: 'noopener', title: what }, el) : el,
    media.seconds && media.type !== 'gif' ? h('span', { class: 'small muted' }, `${WORD[media.type]} · ${clock(media.seconds)}`) : null);
  el.addEventListener('error', () => box.replaceChildren(h('span', { class: 'small muted' }, `${WORD[media.type]}: no longer available`)));
  return box;
}
