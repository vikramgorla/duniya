// A fake Telegram Bot API (077) for tests and the demo panel: a `fetch` replacement, no network. Every call is recorded
// in `calls` ({ method, params }); `push(update)` delivers an update to the waiting getUpdates; `failNext(method, err)`
// makes the next call of a method fail ({ error_code, description, retry_after, migrate_to_chat_id }); `files` maps file
// ids to bytes. `down = true`: Telegram cannot be reached; `stall(n)`: the next n long polls get no answer at all;
// `polls` counts the long polls.
// Groups live in `chats` (id → { title, type, admins: [user], members: [user ids], permissions, invite_link }).
export const FAKE_TOKEN = '7000000001:AAFakeTokenForTestsOnly_abcdefghijklmnopq';

export function fakeBotApi({ token = FAKE_TOKEN, me = {} } = {}) {
  const bot = { id: 7000000001, is_bot: true, first_name: 'Family helper', username: 'family_helper_bot', can_join_groups: true, can_read_all_group_messages: false, ...me };
  const f = { calls: [], updates: [], chats: new Map(), files: new Map(), failures: [], bot, token, down: false, polls: 0, stalled: 0 };
  let nextUpdate = 1; let nextMsg = 100; let waiter = null;
  const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  const err = (e) => new Response(JSON.stringify({ ok: false, error_code: e.error_code || 400, description: e.description || 'Bad Request: fake failure',
    ...(e.retry_after || e.migrate_to_chat_id ? { parameters: { retry_after: e.retry_after, migrate_to_chat_id: e.migrate_to_chat_id } } : {}) }), { status: e.error_code || 400 });
  f.push = (update) => { f.updates.push({ update_id: nextUpdate++, ...update }); waiter?.(); };
  f.failNext = (method, e, times = 1) => { for (let i = 0; i < times; i++) f.failures.push({ method, e }); };
  f.stall = (times) => { f.stalled = times; waiter?.(); };
  f.sent = (method) => f.calls.filter((c) => c.method === method).map((c) => c.params);
  f.group = (id, g) => { f.chats.set(String(id), { type: 'supergroup', admins: [], members: [], permissions: { can_send_messages: true, can_change_info: true }, ...g }); };
  const message = (params, extra = {}) => ({ message_id: nextMsg++, date: Math.floor(Date.now() / 1000), chat: { id: Number(params.chat_id) }, from: bot, ...extra });

  async function paramsOf(init) {
    if (init?.body instanceof FormData) {
      const out = {};
      for (const [k, v] of init.body.entries()) out[k] = typeof v === 'string' ? (/^[[{]/.test(v) ? JSON.parse(v) : v) : { file: true, size: v.size, type: v.type };
      return out;
    }
    return init?.body ? JSON.parse(String(init.body)) : {};
  }

  f.fetch = async (url, init = {}) => {
    if (f.down) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const u = new URL(String(url));
    const file = /^\/file\/bot([^/]+)\/(.+)$/.exec(u.pathname);
    if (file) {
      const bytes = file[1] === f.token ? f.files.get(file[2].replace(/^f\//, '')) : null;
      return bytes ? new Response(bytes) : new Response('not found', { status: 404 });
    }
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
    if (!m) return new Response('not found', { status: 404 });
    const [, tok, method] = m;
    const params = await paramsOf(init);
    if (method === 'getUpdates') f.polls++; else f.calls.push({ method, params });
    if (tok !== f.token) return err({ error_code: 401, description: 'Unauthorized' });
    const i = f.failures.findIndex((x) => x.method === method);
    if (i >= 0) return err(f.failures.splice(i, 1)[0].e);
    const g = f.chats.get(String(params.chat_id));
    switch (method) {
      case 'getMe': return ok(bot);
      case 'deleteWebhook': return ok(true);
      case 'getUpdates': {
        if (f.stalled > 0) { f.stalled--; throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }); }
        const ready = () => f.updates.filter((x) => x.update_id >= (params.offset || 0));
        if (!ready().length) {
          await new Promise((resolve) => { // like Telegram: answers [] after `timeout` seconds without updates
            waiter = resolve;
            init.signal?.addEventListener('abort', resolve, { once: true });
            setTimeout(resolve, (params.timeout ?? 0) * 1000).unref?.();
          });
          waiter = null;
          if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        const list = ready(); f.updates = f.updates.filter((x) => x.update_id >= (params.offset || 0));
        return ok(list);
      }
      // an animation comes back as Telegram sends it: the GIF (as MP4) and a document beside it
      case 'sendAnimation': return ok(message(params, { animation: { file_id: `anim-${nextMsg}`, mime_type: 'video/mp4', file_size: 2048, duration: 2 }, document: { file_id: `anim-${nextMsg}`, mime_type: 'video/mp4', file_size: 2048 } }));
      case 'sendMessage': case 'sendPhoto': case 'sendVideo': case 'sendSticker': case 'sendVoice': case 'sendAudio': case 'sendDocument':
      case 'sendLocation': case 'sendVenue': case 'sendContact': return ok(message(params, method === 'sendMessage' ? { text: params.text } : {}));
      case 'sendPoll': { const msg = message(params, { poll: { id: `poll${nextMsg}`, question: params.question, options: params.options } }); return ok(msg); }
      case 'editMessageText': return ok(message(params, { message_id: params.message_id, text: params.text }));
      case 'deleteMessage': case 'setMessageReaction': case 'sendChatAction': case 'setChatTitle': case 'setChatDescription': case 'setChatPhoto': case 'leaveChat': return ok(true);
      case 'setChatPermissions': if (g) g.permissions = params.permissions; return ok(true);
      case 'getChat': return g ? ok({ id: Number(params.chat_id), type: g.type, title: g.title, description: g.description || '', permissions: g.permissions, invite_link: g.invite_link })
        : ok({ id: Number(params.chat_id), type: 'private' });
      case 'getChatMemberCount': return ok(g ? g.members.length + g.admins.length + 1 : 2);
      case 'getChatAdministrators': return ok((g?.admins || []).map((user, n) => ({ user, status: n === 0 ? 'creator' : 'administrator', can_invite_users: true })));
      case 'getChatMember': {
        const id = Number(params.user_id);
        const status = g?.admins.some((a) => a.id === id) ? 'administrator' : g?.members.includes(id) ? 'member' : 'left';
        return ok({ user: { id }, status });
      }
      case 'exportChatInviteLink': return ok('https://t.me/+FakeInviteLink');
      case 'getFile': return f.files.has(params.file_id) ? ok({ file_id: params.file_id, file_path: `f/${params.file_id}`, file_size: f.files.get(params.file_id).length }) : err({ description: 'Bad Request: file not found' });
      default: return err({ description: `Bad Request: method ${method} not faked` });
    }
  };

  /** A message update from a user in a chat (private when chat > 0). */
  f.say = (from, chatId, text, extra = {}) => f.push({ message: { message_id: nextMsg++, date: Math.floor(Date.now() / 1000), from: { is_bot: false, ...from },
    chat: { id: chatId, type: chatId > 0 ? 'private' : 'supergroup', ...(chatId < 0 ? { title: f.chats.get(String(chatId))?.title || 'Group' } : {}) }, ...(text != null ? { text } : {}), ...extra } });
  return f;
}
