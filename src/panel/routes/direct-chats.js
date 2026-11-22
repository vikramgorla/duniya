// Panel routes for prepared direct chats (049, issue #92): set up a 1:1 chat by phone number before the person writes,
// and the optional intro message (preview, then an explicit confirm with the preview's token).
import { checkDirectNumber, prepareDirectChat, listDirectChats, introPreview, sendIntro } from '../../core/direct-chats.js';

export function directChatRoutes(route, { channel } = {}) {
  route('GET', '/api/direct-chats', async () => listDirectChats());
  route('POST', '/api/direct-chats/check', async ({ body }) => checkDirectNumber({ phone: body.phone, number: body.number }, { channel }));
  route('POST', '/api/direct-chats', async ({ body, user }) => prepareDirectChat({
    phone: body.phone, number: body.number, agent: body.agent, enabled: body.enabled, private: body.private,
    model: body.model, logging: body.logging, fallback: body.fallback, cap: body.cap,
  }, { channel, by: user.username }));
  // Nothing is sent by the preview; the send needs the preview's single-use token (the panel's "Send intro now").
  route('POST', '/api/chats/:chat/intro/preview', async ({ body, params }) => introPreview(decodeURIComponent(params.chat), { text: body.text }));
  route('POST', '/api/chats/:chat/intro', async ({ body, params, user }) => sendIntro(decodeURIComponent(params.chat), { token: body.token }, { channel, by: user.username }));
}
