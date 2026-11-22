// @ts-check
// Panel routes (089): an agent's lessons (list, add, approve, edit, scope, delete) and feedback on when it joins in.
// Admins; lessons are proposed by the server from 👎 ratings, the owner's corrections and join-in feedback.
import { getAgent, isBuiltin } from '../../core/agents.js';
import { chatLabel, chatLabels } from '../../core/chat-names.js';
import { db } from '../../core/db.js';
import { addLesson, deleteLesson, joinFeedback, listLessons, updateLesson } from '../../core/lessons.js';

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */
export function lessonRoutes(route, { channel } = {}) {
  const agentOf = (p) => {
    const a = getAgent(p.id);
    if (!a || isBuiltin(p.id)) throw Object.assign(new Error('Not found'), { status: 404 });
    return a;
  };
  route('GET', '/api/agents/:id/lessons', async (req, res, body, q, p) => {
    const a = agentOf(p);
    const r = listLessons(a.id);
    const names = chatLabels([...new Set([...r.proposed, ...r.active, ...r.feedback].map((l) => l.chat).filter(Boolean))]);
    const named = (l) => ({ ...l, ...(l.chat ? { chatName: names.get(l.chat) } : {}) });
    return { settings: a.lessons, chats: a.chats.map((c) => ({ id: c, name: chatLabel(c) })),
      proposed: r.proposed.map(named), active: r.active.map(named), feedback: r.feedback.map(named) };
  }, { role: 'admin' });
  route('POST', '/api/agents/:id/lessons', async (req, res, body, q, p, user) => [201, addLesson(agentOf(p).id, body, user.username)], { role: 'admin' });
  route('PUT', '/api/agents/:id/lessons/:lid', async (req, res, body, q, p, user) => updateLesson(agentOf(p).id, p.lid, body, user.username), { role: 'admin' });
  route('DELETE', '/api/agents/:id/lessons/:lid', async (req, res, body, q, p) => deleteLesson(agentOf(p).id, p.lid), { role: 'admin' });
  // Feedback on joining in: needless (an answer `msg` it gave by itself), missed (it stayed out in `chat`), good.
  route('POST', '/api/agents/:id/join-feedback', async (req, res, body, q, p, user) => {
    const a = agentOf(p);
    const kind = String(body.kind || '');
    let chat = String(body.chat || ''); let message = ''; let answer = ''; let msg = null;
    if (kind === 'needless' || kind === 'good') {
      const ans = db.prepare('SELECT id, chat, text, ts FROM messages WHERE id = ? AND agent = ? AND from_agent = 1').get(Math.trunc(Number(body.msg)) || 0, a.id);
      if (!ans) throw Object.assign(new Error('That answer is not stored'), { status: 404 });
      ({ chat } = ans); answer = ans.text; msg = ans.id;
      message = db.prepare('SELECT text FROM messages WHERE chat = ? AND id < ? AND from_agent = 0 ORDER BY id DESC LIMIT 1').get(chat, ans.id)?.text || '';
    } else if (kind === 'missed') {
      if (!a.chats.includes(chat)) throw Object.assign(new Error('Which chat of this agent?'), { status: 400, field: 'chat' });
      message = db.prepare('SELECT text FROM messages WHERE chat = ? AND from_agent = 0 ORDER BY id DESC LIMIT 1').get(chat)?.text || ''; // the last message it left alone
    }
    joinFeedback(a, { chat, kind, msg, message, answer, by: user.username })?.catch(() => {}); // the lesson is proposed in the background
    return { ok: true, proposing: kind !== 'good' && !!message && a.lessons?.enabled !== false };
  }, { role: 'admin' });
}
