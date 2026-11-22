// @ts-check
// The Telegram Bot API over HTTPS (077): the one place that holds the token, puts a deadline on every call and turns
// Telegram's answers into errors. The token is read when it is needed and never leaves this module: it is not logged,
// not in errors and not in status. `fetch`, `token` and `api` are replaceable (tests and the demo pass a fake Bot API).
import { fail } from '../../core/config.js';
import { MAX_MEDIA_BYTES } from '../../core/media.js';

const CALL_WAIT = 30 * 1000; // ms: one call
const UPLOAD_WAIT = 120 * 1000; // ms: a call that carries a file
const DOWNLOAD_WAIT = 60 * 1000; // ms: the bytes of a file
const TELEGRAM_FILE_MAX = 20 * 1048576; // bytes: what Telegram serves to bots
/** The largest file this server takes from Telegram. */
export const DOWNLOAD_LIMIT = Math.min(TELEGRAM_FILE_MAX, MAX_MEDIA_BYTES);
const KIND = /^(Bad Request|Forbidden|Unauthorized|Conflict): /; // how a description starts: the code says it already
const WAIT_OVER = new Set(['TimeoutError', 'AbortError']);
const UNAUTHORIZED = 401; const TOO_MANY = 429;
/** What the panel answers when Telegram refuses a call: a refused token and "slow down" stay what they are. */
const panelStatus = (code) => (code === UNAUTHORIZED ? 409 : code === TOO_MANY ? TOO_MANY : 502);
const tooLarge = () => fail('Media is too large', 413);
/** Telegram's refusal of a call as an error (see call()); `scrub` keeps the token out of its words. */
function refusal(j, httpStatus, scrub) {
  const code = j.error_code || httpStatus;
  return fail(scrub(j.description || `Telegram error ${code}`).replace(KIND, ''), panelStatus(code),
    { tg: code, retryAfter: Number(j.parameters?.retry_after) || 0, migrateTo: j.parameters?.migrate_to_chat_id ? String(j.parameters.migrate_to_chat_id) : '' });
}

/** @param {{ fetch: typeof globalThis.fetch, token: () => string, api: string }} options */
export function createBotApi({ fetch: doFetch, token, api }) {
  /**
   * One call of a Bot API method. An error carries `tg`: Telegram's error code, or 0 when Telegram was not reached
   * (`timedOut` then says whether the wait ran out); `retryAfter` (seconds) on "slow down"; `migrateTo` when a group
   * became a supergroup (its new chat id).
   */
  async function call(method, params = {}, { signal = AbortSignal.timeout(CALL_WAIT), form = null } = {}) {
    const t = token();
    if (!t) throw fail('Telegram is not set up: no bot token', 409);
    const scrub = (s) => String(s || '').split(t).join('…');
    const body = form ? { body: form } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) };
    let r;
    try { r = await doFetch(`${api}/bot${t}/${method}`, { method: 'POST', ...body, signal }); } catch (e) {
      throw fail(`Telegram could not be reached (${scrub(e?.cause?.code || e?.name || 'network')})`, 503, { tg: 0, timedOut: WAIT_OVER.has(e?.name) });
    }
    /** @type {any} */
    const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
    if (j.ok) return j.result;
    throw refusal(j, r.status, scrub);
  }

  /** A call that carries a file ({ buffer, mimetype, fileName }) in `field`, as multipart. */
  function upload(method, params, field, file) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    form.append(field, new Blob([file.buffer], { type: file.mimetype }), file.fileName || 'file');
    return call(method, {}, { form, signal: AbortSignal.timeout(UPLOAD_WAIT) });
  }

  /** The bytes of a file. Refused when too large: by the size Telegram declared, by what getFile says, and while they arrive. */
  async function download(fileId, declared = 0) {
    if (declared > DOWNLOAD_LIMIT) throw tooLarge();
    const f = await call('getFile', { file_id: fileId });
    if (!f.file_path || (f.file_size || 0) > DOWNLOAD_LIMIT) throw tooLarge();
    const r = await doFetch(`${api}/file/bot${token()}/${f.file_path}`, { signal: AbortSignal.timeout(DOWNLOAD_WAIT) }).catch(() => null);
    if (!r?.ok || !r.body) throw fail('Telegram did not send the file', 502);
    const parts = []; let size = 0;
    try {
      for await (const part of r.body) { size += part.length; if (size > DOWNLOAD_LIMIT) throw tooLarge(); parts.push(part); }
    } catch (e) { throw e.status ? e : fail('Telegram did not send the whole file', 502); }
    return Buffer.concat(parts);
  }

  return { call, upload, download };
}
