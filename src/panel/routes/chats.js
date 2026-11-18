// @ts-check
// Panel routes: chats (on/off and per-chat settings, history, binding, stored messages, WhatsApp group tools, memory).
import { fail } from '../../core/config.js';
import { agentForChat, bindChat, listAgents } from '../../core/agents.js';
import { allChatPrefs, ignoredCounts, isChatEnabled, isChatPrivate, seenChats, setChatPrefs } from '../../core/chat-prefs.js';
import { personInfo } from '../../core/contacts.js';
import { chatLabel, chatLabels } from '../../core/chat-names.js';
import { listMessages, namesInChat, searchStored, deleteStoredMessage } from '../../core/db.js';
import { isChatAlias, listDirectChats } from '../../core/direct-chats.js';
import { activity } from '../../core/events.js';
import { historyLoadCount, historyStatus, loadChatHistory } from '../../core/history-load.js';
import { memberTag, personView, tagsInChat } from '../../core/member-tags.js';
import { eraseChatMemory, forgetDeleted, maybeSummarize, memoryView } from '../../core/memory.js';
import { ratingsOf } from '../../core/review.js';
import { visibleChats } from '../../core/owner-assistant.js';
import { maybePostNotice, noticePostedAt, setChatNoticeOff } from '../../core/privacy-notice.js';
import { chatToolCatalog } from '../../core/chat-tools.js';
import { channelInfo, channelOf, isGroup, personOfChat, splitChatId } from '../../channels/index.js';

/** Leave out empty values and settings at their default. */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && v !== false && v !== 0 && v !== 'inherit'));

/** @param {import('../http.js').Route} route  @param {import('../http.js').RouteContext} [ctx] */

export function chatRoutes(route, { channel } = {}) {
  // ---------- chats + memory ----------
  route('GET', '/api/chats', async () => {
    const groups = (await channel.listChats()).map((c) => ({ ...c, isGroup: true }));
    const owner = new Map(listAgents().flatMap((b) => b.chats.map((c) => [c, b.id])));
    const prefs = allChatPrefs();
    const numbers = new Map(((await channel.status()).numbers || []).map((n) => [n.id, n.label]));
    const known = new Set(groups.map((c) => c.id));
    // 1:1 chats the numbers have seen (name and number only) and any bound chat we can't see right now
    /** @type {any[]} */
    const people = seenChats({ groups: false }).filter((c) => !known.has(c.id)).map((c) => ({ id: c.id, name: chatLabel(c.id), phone: c.phone || personInfo({ jid: personOfChat(c.id) }).phone, number: c.number, isGroup: false, lastAt: c.lastAt }));
    for (const c of people) known.add(c.id);
    // 049: direct chats prepared before the person wrote ("Waiting for the first message"); LID aliases are not listed.
    const prepared = listDirectChats();
    const waiting = new Map(prepared.map((d) => [d.chat, d]));
    for (const c of people) if (waiting.has(c.id)) Object.assign(c, { prepared: true, waiting: waiting.get(c.id).waiting, introAt: waiting.get(c.id).introAt });
    for (const d of prepared.filter((x) => !known.has(x.chat))) {
      people.push({ id: d.chat, name: d.name, phone: d.phone, number: d.number, isGroup: false, lastAt: d.firstAt, prepared: true, waiting: d.waiting, onWhatsApp: d.onWhatsApp, introAt: d.introAt });
      known.add(d.chat);
    }
    for (let i = people.length - 1; i >= 0; i--) if (isChatAlias(people[i].id)) people.splice(i, 1);
    const missing = [...owner.keys()].filter((c) => !known.has(c)).map((id) => ({ id, name: chatLabel(id), offline: true, size: 0, isGroup: isGroup(id) }));
    // 070: settings that are at their default are left out (model, logging, welcome "inherit", fallback inherit, off,
    // not private…): the list stays small with hundreds of chats; the panel and the admin tools fill in the defaults.
    return [...groups, ...people, ...missing].map((c) => {
      const number = c.number || splitChatId(c.id).account;
      const pr = prefs[c.id];
      return compact({ ...c, number, numberLabel: channelOf(c.id) === 'whatsapp' || !channelOf(c.id) ? numbers.get(number) || number : channelInfo(channelOf(c.id))?.label, channel: channelOf(c.id) || undefined, agent: owner.get(c.id), model: pr?.model, logging: pr?.logging,
        fallback: pr?.fallback && (pr.fallback.mode !== 'inherit' || pr.fallback.chain?.length) ? pr.fallback : null, enabled: pr?.enabled, ignored: ignoredCounts.get(c.id),
        private: pr?.private, noticeOff: pr?.noticeOff, welcome: pr?.welcome, noticePostedAt: c.isGroup ? noticePostedAt(c.id) : null, history: historyStatus(c.id) });
    });
  });
  /** Switch a chat on or off: recorded, the privacy notice (044) and the phone's recent messages (#91) when it goes on. */
  const afterSwitch = async (chat, on, wasOn, user) => {
    ignoredCounts.delete(chat); activity('config', { chat, summary: `Chat switched ${on ? 'ON — agents may answer here' : 'OFF — agents ignore it'} (${user.username})` });
    if (!on || wasOn) return;
    await maybePostNotice(chat, channel); // groups only, once
    if (historyLoadCount() > 0) { // nothing was stored while the chat was off: ask the phone (answered later)
      try { await loadChatHistory(chat, { by: user.username, reason: 'switch_on' }); } catch (e) { activity('memory.history', { chat, summary: `Could not ask the phone for earlier messages: ${e.message}` }); }
    }
  };
  route('PUT', '/api/chats/:chat/prefs', async (req, res, body, q, p, user) => {
    const chat = decodeURIComponent(p.chat);
    const wasOn = isChatEnabled(chat);
    // 044: "private to members" and the privacy-notice opt-out are recorded like every chat setting.
    if (body.noticeOff !== undefined) setChatNoticeOff(chat, !!body.noticeOff, user.username);
    if (body.private !== undefined) {
      setChatPrefs(chat, { private: !!body.private });
      activity('config', { chat, summary: `Chat ${body.private ? 'marked private to members — hidden from the owner assistant' : 'no longer private to members'} (${user.username})` });
    }
    if (body.welcome !== undefined) { // 054: "Welcome new members" for this chat (inherit = the agent's setting)
      setChatPrefs(chat, { welcome: String(body.welcome) });
      activity('config', { chat, summary: `Welcome new members: ${body.welcome === 'inherit' ? 'as the agent is set' : body.welcome} for this chat (${user.username})` });
    }
    const out = setChatPrefs(chat, { model: body.model, logging: body.logging, enabled: body.enabled, fallback: body.fallback });
    if (body.enabled !== undefined) await afterSwitch(chat, out.enabled, wasOn, user);
    else if (body.private !== undefined || body.noticeOff !== undefined || body.welcome !== undefined) { /* recorded above */ } else activity('config', { chat, summary: `Chat settings: model ${out.model}, logging ${out.logging}, fallback ${out.fallback.mode}${out.fallback.chain.length ? ` (${out.fallback.chain.join(' → ')})` : ''} (${user.username})` });
    return { ...out, history: historyStatus(chat) };
  });
  // #91: "Load recent messages": ask the linked phone for earlier messages of a chat that is on (status by polling).
  route('GET', '/api/chats/:chat/history', async (req, res, body, q, p) => ({ status: historyStatus(decodeURIComponent(p.chat)), count: historyLoadCount() }));
  route('POST', '/api/chats/:chat/history', async (req, res, body, q, p, user) => {
    const chat = decodeURIComponent(p.chat);
    const status = await loadChatHistory(chat, { count: body.count, by: user.username, reason: 'button' });
    return { status };
  }, { role: 'admin' });
  // 062: `enable: true` also switches the chat on (choosing an agent for a chat means it should answer there).
  route('POST', '/api/chats/bind', async (req, res, body, q, p, user) => {
    const chat = String(body.chat);
    await bindChat(chat, body.agent || null, user.username);
    if (!body.enable || !body.agent || isChatEnabled(chat)) return { ok: true, enabled: isChatEnabled(chat) };
    setChatPrefs(chat, { enabled: true });
    await afterSwitch(chat, true, false, user);
    return { ok: true, enabled: true, history: historyStatus(chat) };
  });
  // Stored messages of a chat (024): admins and owners only; each look is recorded.
  route('GET', '/api/chats/:chat/messages', async (req, res, body, q, p, user) => {
    const chat = decodeURIComponent(p.chat);
    const tags = tagsInChat(chat);
    // 057: the sender as the panel knows them (own / address-book name), with their group tag; raw ids are not returned
    // 072: an agent's answer carries its rating (the same as in Review); answers in chats private to members are not rated
    const list = listMessages(chat, { before: q.get('before'), limit: q.get('limit'), q: q.get('q') || '', around: q.get('around') });
    const rated = ratingsOf(list.filter((m) => m.fromAgent).map((m) => m.id));
    const rateable = !isChatPrivate(chat);
    const rows = list.map(({ senderJid, ...m }) => (m.fromAgent ? { ...m, rating: rated.get(m.id) || 0, rateable: rateable && !!m.agent && m.id > 0 }
      : { ...m, name: personInfo({ phone: m.sender, jid: senderJid, fallbackName: m.name }).label, ...(memberTag(chat, { phone: m.sender, jid: senderJid }, tags) ? { tag: memberTag(chat, { phone: m.sender, jid: senderJid }, tags) } : {}) }));
    if (!q.get('before')) activity('config', { chat, summary: `Stored messages viewed by ${user.username}${q.get('q') ? ` (search “${String(q.get('q')).slice(0, 40)}”)` : ''}` });
    return rows;
  }, { role: 'admin' });
  // #178: delete one stored message (admins and owners); the agent forgets it (the chat summary is rebuilt). WhatsApp is unchanged.
  route('DELETE', '/api/chats/:chat/messages/:id', async (req, res, body, q, p, user) => {
    const chat = decodeURIComponent(p.chat);
    if (!deleteStoredMessage(chat, Number(p.id))) throw Object.assign(new Error('Message not found'), { status: 404 });
    forgetDeleted(chat);
    activity('config', { chat, summary: `A stored message was deleted by ${user.username}` });
    return { ok: true };
  }, { role: 'admin' });
  // 070: Search messages across chats. Owner only; the chats the owner assistant may read (on, not private to
  // members); newest first, 30 at a time (`before` = the last id). Each search is recorded like a look at messages.
  route('GET', '/api/search/messages', async (req, res, body, q, p, user) => {
    const query = String(q.get('q') || '').trim().slice(0, 100);
    if (query.length < 2) return { results: [], more: false };
    const chats = visibleChats();
    const rows = searchStored({ chats, query, before: q.get('before'), limit: 31 });
    const names = await chatLabels(rows.slice(0, 30).map((m) => m.chat), channel);
    if (!q.get('before')) activity('config', { summary: `Messages searched by ${user.username} (“${query.slice(0, 40)}”, ${rows.length > 30 ? '30+' : rows.length} found in ${chats.length} chats)` });
    return {
      chats: chats.length, more: rows.length > 30,
      results: rows.slice(0, 30).map((m) => ({ id: m.id, chat: m.chat, chatName: names.get(m.chat), ts: m.ts, agent: m.agent || '', fromAgent: !!m.from_agent,
        name: m.from_agent ? '' : personInfo({ phone: m.sender, jid: m.sender_jid, fallbackName: m.name }).label, text: String(m.text || '').slice(0, 600) })),
    };
  }, { role: 'owner' });
  // ---------- WhatsApp group tools for admins (026): same channel functions as the agents' whatsapp tools ----------
  route('GET', '/api/whatsapp/tools', async () => chatToolCatalog());
  const ADMIN_RANK = { superadmin: 2, admin: 1 };
  const waGroup = (p) => {
    const chat = decodeURIComponent(p.chat);
    if (!isGroup(chat)) throw fail('This is not a group');
    if (typeof channel.groupInfo !== 'function') throw fail('WhatsApp actions are not available', 501);
    return chat;
  };
  const waLog = (chat, user, summary, detail) => activity('whatsapp.action', { agent: agentForChat(chat)?.id || '', chat, summary: `${summary} (panel, ${user.username})`, detail: { ...detail, by: user.username, source: 'panel' } });
  route('GET', '/api/chats/:chat/whatsapp', async (req, res, body, q, p) => {
    const chat = waGroup(p);
    const g = await channel.groupInfo(chat);
    const names = namesInChat(chat);
    const tags = tagsInChat(chat);
    return { ...g, participants: g.participants.map((m) => ({ ...m, ...personView({ phone: m.phone, jid: m.jid, fallbackName: names[m.phone] }, chat, tags) }))
      .sort((a, b) => ((ADMIN_RANK[b.admin] || 0) - (ADMIN_RANK[a.admin] || 0)) || (a.name || a.phone || '~').localeCompare(b.name || b.phone || '~')) };
  }, { role: 'admin' });
  route('GET', '/api/chats/:chat/whatsapp/invite', async (req, res, body, q, p, user) => {
    const chat = waGroup(p);
    const r = await channel.groupInviteLink(chat);
    waLog(chat, user, 'Invite link viewed', { tool: 'group_invite_link' });
    return r;
  }, { role: 'admin' });
  route('POST', '/api/chats/:chat/whatsapp/invite/revoke', async (req, res, body, q, p, user) => {
    const chat = waGroup(p);
    const r = await channel.groupRevokeInvite(chat);
    waLog(chat, user, 'Invite link reset', { tool: 'revoke_invite_link' });
    return r;
  });
  route('PUT', '/api/chats/:chat/whatsapp', async (req, res, body, q, p, user) => {
    const chat = waGroup(p);
    const done = [];
    if (typeof body.subject === 'string') {
      if (!body.subject.trim()) return [400, { error: 'The group name cannot be empty', field: 'subject' }];
      await channel.groupSubject(chat, body.subject.trim()); done.push(`name “${body.subject.trim().slice(0, 60)}”`);
    }
    if (typeof body.description === 'string') { await channel.groupDescription(chat, body.description); done.push('description'); }
    const settings = Object.fromEntries(['announcement', 'locked', 'joinApproval'].filter((k) => typeof body[k] === 'boolean').map((k) => [k, body[k]]));
    if (Object.keys(settings).length) {
      await channel.groupSettings(chat, settings);
      const label = { announcement: 'only admins send', locked: 'only admins edit info', joinApproval: 'approve new members' };
      done.push(...Object.entries(settings).map(([k, v]) => `${label[k]} ${v ? 'on' : 'off'}`));
    }
    if (!done.length) return [400, { error: 'Nothing to change' }];
    waLog(chat, user, `Group updated: ${done.join(', ')}`, { tool: 'update_group', input: body });
    return { ok: true, changed: done };
  });
  route('GET', '/api/chats/:chat/memory', async (req, res, body, q, p) => memoryView(decodeURIComponent(p.chat)));
  route('POST', '/api/chats/:chat/memory/summarize', async (req, res, body, q, p) => {
    const chat = decodeURIComponent(p.chat);
    const summary = await maybeSummarize(chat, agentForChat(chat), { force: true });
    return { summary: summary ?? memoryView(chat).summary };
  });
  route('DELETE', '/api/chats/:chat/memory', async (req, res, body, q, p, user) => { eraseChatMemory(decodeURIComponent(p.chat), user.username); return { ok: true }; });
}
