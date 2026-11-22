// @ts-check
// What the admin tool lists share: input fields in JSON Schema, and small lookups through the panel's own routes.
import { fail } from '../../core/config.js';
/** 065: version a is not newer than b ("2.9.0" vs "v2.10.0"). */
export const notAfter = (a, b) => { const [x, y] = [a, b].map((v) => String(v).replace(/^v/, '').split('.').map(Number)); const i = x.findIndex((n, k) => n !== y[k]); return i < 0 || x[i] < y[i]; };
export const iso = (ts) => (ts ? new Date(ts).toISOString() : null);

export const enc = encodeURIComponent;
export const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
export const bool = (description) => ({ type: 'boolean', description });
export const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
export const obj = (description) => ({ type: 'object', description, additionalProperties: true });
export const ROLE_TEXT = { organizer: 'organizer', participant: 'participant' };

export async function agentName(x, id) {
  const b = await x.call('GET', `/api/agents/${enc(id)}`);
  return `"${b.name}" (${b.id})`;
}
export async function chatName(x, chat) {
  const c = (await x.call('GET', '/api/chats')).find((r) => r.id === chat);
  return c ? `"${c.name}"` : `"${chat}"`;
}
/** 082: the body of a send preview from admin tool arguments. */
export const sendBody = (a) => ({ title: a.title, audience: a.audience, purpose: a.purpose, template: a.template, agent: a.agent, mode: a.mode, group: a.group, noReplyLimit: a.no_reply_limit, survey: a.survey });
export const campaignBody = (a) => ({ title: a.title, audience: a.audience, purpose: a.purpose, agent: a.agent, steps: a.steps, stops: a.stops, event: a.event, endDay: a.end_day, noReplyLimit: a.no_reply_limit });
/** 081: an event id from an id or (part of) a name, upcoming first. */
export async function eventIdOf(x, ref) {
  const r = String(ref || '').trim().toLowerCase();
  const all = [...await x.call('GET', '/api/module/events'), ...await x.call('GET', '/api/module/events?past=1')];
  const e = all.find((v) => v.id === ref) || all.find((v) => v.name.toLowerCase() === r) || all.find((v) => v.name.toLowerCase().includes(r));
  if (!e) throw fail(`No event matches "${ref}"`, 404);
  return e.id;
}
export async function numbers(x) {
  const ch = (await x.call('GET', '/api/status')).channel;
  return ch?.numbers || (ch ? [{ id: 'main', label: 'Main', ...ch }] : []);
}
