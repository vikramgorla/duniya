// @ts-check
import { isChatEnabled, ignoredCounts, noteLatestKeys } from './chat-prefs.js';
import { mergeChats } from './chat-merge.js';
import { agentSpoke, shouldJudge, verdictOf, closeFollowups } from './group-replies.js';
import { storeLoadedBatch, setHistoryChannel, historyChatActive } from './history-load.js';
import { personInfo, agentName } from './contacts.js';
import { memberTag } from './member-tags.js';
import { env, clip } from './config.js';
import { capsOf, isGroup } from '../channels/index.js';
import { getSetting } from './store.js';
import { listAgents as allAgents, getAgent, agentForChat, roleIn, isBuiltin } from './agents.js';
import { runAgent, handleConfirmCommand } from './runner.js';
import { lastAgentMessage, logMessage, messageByMsgId, deleteMessageByMsgId, saveReaction, savePollVote, pollTally, setMessageText, editStoredMessage, agentAnsweredAfter } from './db.js';
import { activity, recordFailure } from './events.js';
import { maybeSummarize, forgetChanged } from './memory.js';
import { setChatChannel } from './chat-tools.js';
import { countStat } from './stats.js';
import { silenceReason } from './silences.js';
import { handleOwnerMessage, userForPhone } from './owner-assistant.js';
import { dmNoticeOnce } from './privacy-notice.js';
import { resolveDirectChat } from './direct-chats.js';
import { inboundKind, prepareInbound, wantsVoice, speak, createImage } from './media-ai.js';
import { enqueue, registerJobHandler, setQueueChannel, startQueue, packMsg, unpackMsg, quoteOf } from './media-queue.js';
import { readFileSync, rmSync } from 'node:fs';
import { builtinAnswer, todayText, fillPlaceholders } from './quick.js';
import { recordUsage, usageTag } from './usage.js';
import { noteJoin } from './welcome.js';
import { notePerson } from './people.js';
import { inRole, notePersonChat } from './people-access.js';
import { interceptMessage } from '../modules/index.js';
import { drainReads, paceReply, queueRead, readWhenDue } from './pace.js';
import { claimTurn, releaseTurn, isDuplicate, noteSent, similarity } from './turns.js';
import { lessonFromCorrection, noteJudgedAnswer } from './lessons.js';
import { noteMessage as noteCommitments } from './commitments.js';
import { noteCues, noteWriter } from './person-insights.js';
import { findMedia, fitsCaption, postMedia } from './sharing.js';

// 059: the built-in owner assistant is reached through the owner hand-off only, never by routing.
const listAgents = () => allAgents().filter((b) => !isBuiltin(b));

export { silenceReason }; // #34: other modules (usage caps) report why an agent stayed silent, e.g. silenceReason('budget', …)

const rate = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (rate.get(key) || []).filter((t) => now - t < 60000);
  list.push(now);
  rate.set(key, list);
  return list.length > env.rateLimitPerMin;
}

const isAnyOrganizer = (phone) => !!phone && listAgents().some((b) => inRole(b.organizers, { phone }));
/** Index of a trigger in the text as a whole word (anywhere: "can mochi help?" works), or -1. */
function triggerAt(trigger, lower) {
  const word = /[\p{L}\p{N}_]/u;
  for (let i = lower.indexOf(trigger); i !== -1; i = lower.indexOf(trigger, i + 1)) {
    const before = i === 0 ? '' : lower[i - 1];
    const after = lower[i + trigger.length] || '';
    const edgeOk = (ch, inner) => !ch || !word.test(ch) || !word.test(inner);
    if (edgeOk(before, trigger[0]) && edgeOk(after, trigger[trigger.length - 1])) return i;
  }
  return -1;
}
/** The agent's trigger found in the message (anywhere, earliest first), or undefined. */
const findTrigger = (agent, lower) => {
  let best; let at = Infinity;
  for (const t of agent.triggers || []) { const i = triggerAt(t, lower); if (i !== -1 && i < at) { at = i; best = t; } }
  return best;
};
/** Among agents, the one whose trigger appears earliest in the message. */
const earliestTriggered = (agents, lower) => {
  let best = null; let at = Infinity;
  for (const b of agents) for (const t of b.triggers || []) { const i = triggerAt(t, lower); if (i !== -1 && i < at) { at = i; best = b; } }
  return best;
};

export function stripTriggers(agent, text) {
  let t = text.replace(/@\d{5,}/g, ' ').trim();
  // A trigger at the start is an address ("!family …"): drop it. Elsewhere it is part of the sentence: keep the text.
  const trig = findTrigger(agent, t.toLowerCase());
  if (trig && t.toLowerCase().startsWith(trig)) t = t.slice(trig.length);
  return t.trim();
}

/**
 * Role of a sender for an agent. Saved organizers decide; while an agent has none saved, WhatsApp admins of the agent's
 * groups are its organizers (015: "group admins as the default").
 */
export async function resolveRole(agent, msg, channel) {
  const saved = roleIn(agent, msg.phone, msg.personId || '');
  if (saved === 'organizer' || agent.organizers.length || !msg.phone) return saved;
  const groups = msg.isGroup ? [msg.chat] : agent.chats.filter((c) => isGroup(c));
  for (const g of groups) {
    try {
      const members = await channel.groupMembers?.(g);
      if (members?.some((m) => m.admin && m.phone === msg.phone)) return 'organizer';
    } catch { /* not a member / offline */ }
  }
  return 'participant';
}

/** The agent a channel account sends its direct messages to (a WhatsApp number's, the Telegram bot's), '' for the default. */
const accountDmAgent = (msg) => (msg.channel === 'telegram' ? getSetting('telegram', {})?.dmAgent
  : (getSetting('whatsappNumbers', null) || []).find((n) => n.id === (msg.number || 'main'))?.dmAgent) || '';

/** A chat that is off: only an agent that explicitly answers anyone may take a direct message. */
function openAgentFor(msg) {
  const open = listAgents().filter((b) => b.enabled && b.dm === 'anyone');
  const lower = msg.text.trim().toLowerCase();
  return earliestTriggered(open, lower) || open.find((b) => b.id === accountDmAgent(msg)) || open.find((b) => b.id === getSetting('defaultDmAgent', '')) || open[0] || null;
}

/** Does this agent answer this person's direct messages? Anyone, its organizers, or also its participants and the
 *  members of its groups, by its "direct messages" setting. */
async function takesDm(agent, msg, channel) {
  if (agent.dm === 'none') return false;
  const role = await resolveRole(agent, msg, channel);
  if (agent.dm === 'anyone' || role === 'organizer') return true;
  if (agent.dm === 'organizers') return false;
  if (inRole(agent.participants, { phone: msg.phone, person: msg.personId || '' })) return true;
  for (const chat of agent.chats) if (await channel.isMember(chat, msg.phone, msg.senderJid)) return true;
  return false;
}

/** Pick the agent for a direct message, or null. */
async function agentForDm(msg, channel, { openOnly = false } = {}) {
  // A 1:1 chat an admin assigned to an agent (Chats page) always goes to that agent.
  const assigned = agentForChat(msg.chat);
  if (assigned) return assigned.enabled && (!openOnly || assigned.dm === 'anyone') ? assigned : null;
  if (openOnly) return openAgentFor(msg);
  const enabled = listAgents().filter((b) => b.enabled);
  const byTrigger = earliestTriggered(enabled, msg.text.trim().toLowerCase());
  const candidates = byTrigger ? [byTrigger]
    : [getAgent(accountDmAgent(msg)), getAgent(getSetting('defaultDmAgent', '')), ...enabled].filter((b) => b?.enabled);
  for (const agent of candidates) if (await takesDm(agent, msg, channel)) return agent;
  return null;
}

/** Why no agent took a direct message (#34): the agent it would have gone to, and the reason. */
function dmSilence(msg) {
  const assigned = agentForChat(msg.chat);
  if (assigned) return { agent: assigned.id, reason: assigned.enabled ? 'role_not_allowed' : 'agent_disabled' };
  const all = listAgents();
  const enabled = all.filter((b) => b.enabled);
  if (!enabled.length) return { agent: all[0]?.id || '', reason: all.length ? 'agent_disabled' : 'no_agent' };
  const lower = msg.text.trim().toLowerCase();
  const c = earliestTriggered(enabled, lower) || [getAgent(accountDmAgent(msg)), getAgent(getSetting('defaultDmAgent', ''))].find((b) => b?.enabled) || enabled[0];
  return { agent: c.id, reason: c.dm === 'none' ? 'dm_not_allowed' : 'role_not_allowed' };
}

const summarizeLater = (chat, agent) => { maybeSummarize(chat, agent).catch(recordFailure('Summarising', { chat })); };

/**
 * Store WhatsApp history batches (link/reconnect sync). Never replies. Group chats only.
 * #91: every batch also updates the newest message key per chat (metadata only, also for chats that are off), and
 * batches the phone sent on demand (`meta.onDemand`) go to history-load: stored before what is stored, chats that
 * are on only (groups and people: the owner asked for them).
 */
export function createHistoryHandler() {
  return async function onHistory(msgs, meta = {}) {
    try {
      noteLatestKeys(meta.keys || msgs.filter((m) => m.msgId).map((m) => ({ chat: m.chat, number: m.number, isGroup: m.isGroup, msgId: m.msgId, fromMe: m.fromMe, participant: m.isGroup && !m.fromMe ? m.senderJid : '', ts: m.ts })));
    } catch (e) { activity('error', { summary: `Could not note chat keys: ${e.message}` }); }
    const texts = msgs.filter((m) => !m.kind || m.kind === 'text');
    if (meta.onDemand) storeAskedHistory(texts, meta.chats || []); else storeSyncedHistory(texts);
  };
}
/** A message from the phone's history as a stored row. */
const historyRow = (m, agent) => ({ channel: m.channel, chat: m.chat, agent: agent?.id || '', msgId: m.msgId, sender: m.phone, name: m.senderName,
  text: m.text, quoted: m.quoted, fromAgent: m.fromMe, ts: m.ts, senderJid: m.fromMe ? '' : m.senderJid });
/** History the owner asked the phone for (#91): per chat to history-load, which stores it for chats that are on only. */
function storeAskedHistory(msgs, chats) {
  const byChat = new Map(chats.map((c) => [c, []]));
  for (const m of msgs) {
    if (!byChat.has(m.chat)) byChat.set(m.chat, []);
    byChat.get(m.chat).push(historyRow(m, agentForChat(m.chat)));
  }
  for (const [chat, rows] of byChat) storeLoadedBatch(chat, rows); // chats that are off: nothing stored
}
/** History the phone sends by itself (link, reconnect): groups that are on only; never private chats, nor groups that are off (#10). */
function storeSyncedHistory(msgs) {
  const touched = new Map();
  let stored = 0;
  for (const m of msgs.filter((x) => x.isGroup && isChatEnabled(x.chat))) {
    const agent = agentForChat(m.chat);
    if (logMessage(historyRow(m, agent))) { stored++; touched.set(m.chat, agent); }
  }
  if (stored) activity('memory.history', { summary: `Stored ${stored} history message(s) from ${touched.size} group(s)` });
  for (const [chat, agent] of touched) summarizeLater(chat, agent);
}

/** 057: how the panel (Activity, why-quiet) names a sender: the one resolver, so known contacts show their name. */
const whoOf = (msg) => personInfo({ phone: msg.phone, jid: msg.senderJid, fallbackName: msg.senderName }).label;

const voterOf = (msg) => msg.phone || msg.senderJid || 'someone';
// #178: deleted for everyone in WhatsApp → gone from Duniya's stored messages too
function recordDeleted(msg, agent) {
  if (!deleteMessageByMsgId(msg.chat, msg.target)) return;
  forgetChanged(msg.chat);
  activity('memory.history', { agent: agent?.id || '', chat: msg.chat, summary: 'A message deleted in WhatsApp was removed from the stored messages' });
}
/** A reaction is kept when it is on an agent's message or in a group bound to an enabled agent. */
function recordReaction(msg, agent) {
  const target = msg.target ? messageByMsgId(msg.chat, msg.target) : null;
  if (!target?.from_agent && !(agent?.enabled && msg.isGroup)) return;
  saveReaction({ chat: msg.chat, msgId: msg.target, sender: voterOf(msg), name: msg.senderName, emoji: msg.emoji, ts: msg.ts });
  activity('whatsapp.reaction', { agent: agent?.id || target?.agent || '', chat: msg.chat,
    summary: msg.emoji ? `${whoOf(msg)} reacted ${msg.emoji} to "${clip(target?.text || 'a message', 80)}"` : `${whoOf(msg)} removed a reaction` });
}
/** A vote is kept when the poll is known (created while the app ran). */
function recordVote(msg, agent) {
  const p = savePollVote({ chat: msg.chat, msgId: msg.pollId, voter: voterOf(msg), name: msg.senderName, selected: msg.selected || [], ts: msg.ts });
  if (!p) return;
  activity('whatsapp.vote', { agent: agent?.id || '', chat: msg.chat,
    summary: `${whoOf(msg)} voted ${msg.selected?.length ? msg.selected.join(', ') : '(withdrew)'} in "${clip(p.name, 60)}" → ${pollTally(p).map((o) => `${o.name} ${o.votes}`).join(', ')}` });
}
const EVENT_RECORDERS = { deleted: recordDeleted, reaction: recordReaction, poll_vote: recordVote };
/** Reactions, poll votes and deletions (026): stored for context, never answered. */
const recordEvent = (msg) => EVENT_RECORDERS[msg.kind]?.(msg, agentForChat(msg.chat));

/**
 * 077: a chat got a new id (Telegram turns a group into a supergroup): its settings, agent and memory move with it.
 * Only chats that were on carry anything over; a chat that was off just shows up under its new id (off).
 */
export function createChatMoveHandler() {
  return ({ from, to }) => mergeChats(from, to, 'Telegram upgraded this group (new id)');
}

/** Build the live message router for a channel. */
export function createRouter(channel) {
  setChatChannel(channel);
  setHistoryChannel(channel);
  registerMediaHandlers(channel);
  return async function onMessage(incoming) {
    if (closing) return; // 069: shutting down (a few seconds at most): no new turn starts
    inFlight++;
    try { await route(incoming); } finally { if (--inFlight === 0) for (const r of idleWaiters.splice(0)) r(); }
  };
  async function route(incoming) {
    // 049 (#92): one chat per person, whichever id WhatsApp writes from (a phone-form chat set up first joins the LID one)
    const msg = await resolveDirectChat(incoming);
    msg.arrived ??= Date.now(); // 087: sends after this moment that repeat each other are duplicates
    drainReads(channel).catch(() => {}); // 080: read receipts that are due go out on every incoming message (and the upkeep tick)
    noteKeys(msg);
    if (await notAMessage(channel, msg)) return;
    // Owner assistant (044): link codes and linked panel users' direct messages (unless they start with an agent trigger).
    if (!msg.isGroup && await handleOwnerMessage(msg, channel)) return;
    const s = incomingState(msg);
    if (await chatOffGate(channel, s)) return;
    if (await rememberOrIntercept(channel, s)) return;
    if (getSetting('paused', false)) { if (s.wakes) s.quiet('paused'); return; }
    if (await organizerHelper(channel, s)) return;
    const agent = await answeringAgent(channel, s);
    if (!agent) return;
    if (!msg.isGroup) {
      s.rowId = logMessage({
        channel: msg.channel, chat: msg.chat, agent: agent.id, msgId: msg.msgId, sender: msg.phone,
        name: msg.senderName, text: msg.text, quoted: msg.quoted, addressed: true, ts: msg.ts, senderJid: msg.senderJid,
      });
    }
    learnAboutWriter(s, agent);
    const role = await resolveRole(agent, msg, channel);
    const turn = { agent, role, addressed: isAddressed(agent, msg, s.lower), isConfirm: /^(confirm|cancel)\s+[a-z0-9]{4}$/i.test(s.lower) };
    if (!turn.isConfirm) proposeLessonFromOwner(s, agent);
    if (await answerBuiltin(channel, s, turn)) return;
    const admitted = admitTurn(s, turn);
    if (!admitted) return;
    if (inboundKind(msg, agent)) { await queueTurn(channel, s, turn); return; }
    await serialTurn(channel, msg, { agent, role, addressed: turn.addressed, rowId: s.rowId, quiet: s.quiet, judge: admitted.judge, solo: turn.isConfirm });
  }
}

// ---------- the steps of route(), in its order ----------
/** #91: the newest message key per chat (metadata only, also while the chat is off), to load history when it goes on. */
function noteKeys(msg) {
  if (!msg.msgId || (msg.kind && msg.kind !== 'text')) return;
  try { noteLatestKeys([{ chat: msg.chat, number: msg.number, isGroup: msg.isGroup, msgId: msg.msgId, fromMe: !!msg.fromMe, participant: msg.isGroup && !msg.fromMe ? msg.senderJid : '', ts: msg.ts }]); } catch { /* best effort */ }
  try { historyChatActive(msg.chat); } catch { /* best effort */ } // 057: a load that had no anchor starts now
}

/** Not a message to answer: an edit (087: the stored copy changes; an answer it got may need a correction), a reaction
 *  or a poll vote. Recorded only for chats that are on (#10). True: dealt with. */
async function notAMessage(channel, msg) {
  if (!msg.kind || msg.kind === 'text') return false;
  if (!isChatEnabled(msg.chat)) return true;
  if (msg.kind === 'edited') await onEdited(channel, msg); else recordEvent(msg);
  return true;
}

/** What one incoming message carries through the steps below. */
function incomingState(msg) {
  // A media caption can address the agent ("!panduga what is this?"); the stored text is the placeholder.
  const wake = msg.caption || msg.text;
  const lower = wake.trim().toLowerCase();
  const groupAgent = msg.isGroup ? agentForChat(msg.chat) : null;
  // #34: would this message have woken an agent? (Only then is staying silent worth explaining.)
  const wakes = !msg.isGroup || msg.mentioned || msg.replyToAgent || listAgents().some((b) => findTrigger(b, lower));
  const sender = whoOf(msg);
  const quiet = (reason, agentId = groupAgent?.id || '') => silenceReason(reason, { chat: msg.chat, agent: agentId, sender });
  return { msg, wake, lower, groupAgent, wakes, quiet, openAgent: null, rowId: 0 };
}

/** Admin helpers for organizers of any agent: "!groupid" in a group, "!groups" in a direct chat. True: answered. */
async function organizerHelper(channel, { msg, lower }) {
  if (!isAnyOrganizer(msg.phone)) return false;
  if (msg.isGroup && lower === '!groupid') { await channel.send(msg.chat, `Group id: ${msg.chat}`, { quoted: msg.raw }); return true; }
  if (msg.isGroup || lower !== '!groups') return false;
  await channel.send(msg.chat, (await channel.listChats()).map((g) => `${g.name} (${g.size})\n${g.id}`).join('\n\n') || 'No groups.');
  return true;
}

/**
 * Silent by default (#10): a chat that is off is ignored completely — nothing stored, no model call — except the
 * organizers' helpers (answered, nothing stored) and direct messages to an agent explicitly set to answer anyone
 * (s.openAgent). True: the message ends here.
 */
async function chatOffGate(channel, s) {
  const { msg } = s;
  if (isChatEnabled(msg.chat)) return false;
  if (await organizerHelper(channel, s)) return true;
  s.openAgent = msg.isGroup ? null : await agentForDm(msg, channel, { openOnly: true });
  if (s.openAgent) return false;
  ignoredCounts.set(msg.chat, (ignoredCounts.get(msg.chat) || 0) + 1);
  countStat('ignored', { chat: msg.chat }); // weekly summary (041): counts only
  if (s.wakes) s.quiet('chat_off', s.groupAgent?.id || agentForChat(msg.chat)?.id || '');
  return true;
}

/**
 * A message that counts: who wrote it (075: across channels, ids and phone only; 079: which agents may see them), its
 * read receipt (080: after the read delay, answered or not), and in groups the stored message (everything said, bound
 * or not, paused or not, so agents have context). 082: replies to list messages are counted and "stop" / "start" are
 * answered by the Sending module (no model): then true, the message ends here.
 */
async function rememberOrIntercept(channel, s) {
  const { msg, groupAgent } = s;
  msg.personId = notePerson(msg);
  if (!s.openAgent) { notePersonChat(msg.personId, msg.chat, 'wrote'); queueRead(msg); }
  if (!msg.isGroup) return !!msg.personId && interceptMessage(msg, channel);
  s.rowId = logMessage({
    channel: msg.channel, chat: msg.chat, agent: groupAgent?.id || '', msgId: msg.msgId, sender: msg.phone,
    name: msg.senderName, text: msg.text, quoted: msg.quoted, ts: msg.ts, senderJid: msg.senderJid,
  });
  summarizeLater(msg.chat, groupAgent);
  return false;
}

/** The agent that answers this message, or null: why nobody answers is recorded (#34). */
async function answeringAgent(channel, s) {
  const { msg, groupAgent, lower, quiet } = s;
  const agent = msg.isGroup ? groupAgent : s.openAgent || await agentForDm(msg, channel);
  if (agent?.enabled) return agent;
  if (!msg.isGroup) {
    const d = dmSilence(msg); quiet(d.reason, d.agent);
    // 077: a channel without phone numbers does not know who this is yet: offer to link their number
    if (d.reason === 'role_not_allowed' && !msg.phone && !capsOf(msg.chat)?.phoneNumbers) await channel.askForPhone?.(msg.chat, 'I answer only people I know here.').catch(recordFailure('Asking for a phone number', { chat: msg.chat }));
  } else if (!groupAgent) { if (s.wakes) quiet('no_agent', ''); } else if (msg.mentioned || msg.replyToAgent || findTrigger(groupAgent, lower)) quiet('agent_disabled');
  return null;
}

/** 091: what people say teaches Duniya about them (stored chats only): preferences, promises, family ties (suggested). */
function learnAboutWriter({ msg, rowId }, agent) {
  noteWriter(msg.personId);
  try { noteCues(agent, msg); } catch { /* a suggestion is optional */ }
  noteCommitments(agent, msg, rowId).catch(() => {}); // it records its own failures; a turn never waits for it
}

/** 089: the owner corrects the agent right after its answer here ("no, it's Chary who…"): a lesson is proposed. */
function proposeLessonFromOwner({ msg, wake }, agent) {
  if (userForPhone(msg.phone)?.role !== 'owner') return;
  const last = lastAgentMessage(msg.chat);
  if (last?.agent === agent.id && Date.now() - last.ts < 15 * 60000) lessonFromCorrection(agent, { chat: msg.chat, text: wake, answer: last.text, msg: last.id })?.catch(recordFailure('Proposing a lesson', { agent: agent.id, chat: msg.chat }));
}

const isAddressed = (agent, msg, lower) => !msg.isGroup || (agent.respondToMentions && (msg.mentioned || msg.replyToAgent)) || !!findTrigger(agent, lower);

/**
 * Built-in answers (054): quick replies and !help work without a trigger (the command is the address); the FAQ answers
 * messages that wake the agent (or every group message when the agent is set so). No model call. True: answered (or
 * held back by the rate limit).
 */
async function answerBuiltin(channel, s, { agent, role, addressed, isConfirm }) {
  const { msg, wake, quiet } = s;
  if (isConfirm || !hasBuiltins(agent)) return false;
  const stripped = stripTriggers(agent, wake);
  const ans = builtinAnswer(agent, { texts: [wake, stripped], question: stripped, role,
    faqAllowed: !msg.mediaInfo && (addressed || (msg.isGroup && agent.faq.wholeGroup)),
    values: { name: msg.senderName || '', date: todayText(agent.timezone) } });
  if (!ans) return false;
  if (ans.text.includes('{group}')) ans.text = fillPlaceholders(ans.text, { group: msg.isGroup ? await channel.chatName?.(msg.chat).catch(() => '') || 'the group' : 'this chat' });
  if (rateLimited(`${agent.id}:${msg.phone || msg.senderJid}`)) { quiet('rate_limited', agent.id); return true; }
  countStat('handled', { agent: agent.id });
  activity('message.in', { agent: agent.id, chat: msg.chat, summary: `${whoOf(msg)} (${role}): ${stripped || wake}`, detail: { answeredBy: ans.label } });
  await deliver(channel, msg, agent, ans.text, { textOnly: true });
  const kind = ans.kind === 'faq' ? 'faq' : 'quick reply';
  recordUsage({ ...usageTag(kind, { agent: agent.id, chat: msg.chat }), provider: 'built-in', model: kind, cost: 0, priced: 'free' });
  return true;
}

/**
 * May this message start a turn? 076: not woken, it may still be for the agent (a follow-up to it, or "answer when
 * needed"): then the agent judges, text only. Returns { judge }, or null with the reason recorded.
 */
function admitTurn(s, { agent, addressed, isConfirm }) {
  const { msg, quiet } = s;
  const triggered = addressed || isConfirm;
  const judge = !triggered && !msg.mediaInfo && shouldJudge(agent, msg);
  if (!triggered && !judge) { quiet('not_addressed', agent.id); return null; }
  if (rateLimited(judge ? `${agent.id}:${msg.chat}:judge` : `${agent.id}:${msg.phone || msg.senderJid}`)) { quiet('rate_limited', agent.id); return null; }
  return { judge };
}

/**
 * Photos & voice (043): photos, PDFs and voice notes addressed to the agent go through the media queue (a small server
 * does one at a time; nobody has to resend). Only chats that are on get this far.
 */
async function queueTurn(channel, s, { agent, role, addressed }) {
  const { msg } = s;
  try {
    enqueue({ kind: 'turn', chat: msg.chat, msgId: msg.msgId, senderJid: msg.senderJid, agent: agent.id,
      payload: { msg: packMsg(msg), agent: agent.id, role, addressed, rowId: s.rowId } });
  } catch (e) {
    if (e.code !== 'overloaded') throw e;
    s.quiet('overloaded', agent.id);
    if (Date.now() - (overloadedAt.get(msg.chat) || 0) <= OVERLOADED_NOTE_GAP) return;
    overloadedAt.set(msg.chat, Date.now());
    await channel.send(msg.chat, 'I’m overloaded right now — please send that again in a few minutes.', { quoted: msg.raw });
  }
}

// 087: one turn at a time per agent and chat. Messages that arrive while the agent works here wait (turns.js); when the
// turn ends they are handled together in one follow-up turn that sees the reply just sent and may stay quiet.
const WAITED_NOTE = 'These messages arrived while you were answering; your answer is already in the conversation above. Do not repeat it or send the same thing again. Answer or act only if something new needs you; otherwise answer exactly [quiet].';
async function serialTurn(channel, msg, opts) {
  const key = `${opts.agent.id}|${msg.chat}`;
  if (!claimTurn(key, { msg, opts })) return; // handled when the running turn ends
  try { await runTurn(channel, msg, opts); } finally {
    const waiting = releaseTurn(key);
    // "confirm ABCD" stays its own turn; the other messages that waited become one
    for (const w of waiting.filter((x) => x.opts.solo)) await serialTurn(channel, w.msg, w.opts);
    const rest = waiting.filter((x) => !x.opts.solo);
    if (rest.length) {
      const last = rest.at(-1);
      const text = rest.length === 1 ? last.msg.text : rest.map((w) => `${whoOf(w.msg)}: ${w.msg.text}`).join('\n');
      const role = rest.every((w) => w.opts.role === 'organizer') ? 'organizer' : 'participant'; // the least of the senders
      await serialTurn(channel, { ...last.msg, text, caption: '', arrived: Math.min(...rest.map((w) => w.msg.arrived || Date.now())) }, { ...last.opts, role, addressed: rest.some((w) => w.opts.addressed), judge: false,
        note: WAITED_NOTE, mayStayQuiet: true });
    }
  }
}

/**
 * 087: a person edited their message. The stored copy changes (marked edited; the summary is rebuilt if needed). When
 * the agent already answered it and the meaning changed, the agent gets one follow-up turn to correct itself (with
 * edit_my_last_message) or stay quiet.
 */
async function onEdited(channel, msg) {
  const before = editStoredMessage(msg.chat, msg.target, msg.text, 'sender');
  if (!before || before.from_agent) return;
  forgetChanged(msg.chat);
  const agent = msg.isGroup ? agentForChat(msg.chat) : agentForChat(msg.chat) || (before.agent ? getAgent(before.agent) : null);
  activity('memory.history', { agent: agent?.id || '', chat: msg.chat, summary: `${whoOf(msg)} edited a message; the stored copy was updated` });
  if (!agent?.enabled || getSetting('paused', false)) return;
  if (!agentAnsweredAfter(msg.chat, before.id, agent.id, before.ts + 30 * 60000) || similarity(before.text, msg.text) >= 0.8) return; // not answered, or only a typo fixed
  const role = await resolveRole(agent, msg, channel);
  const quiet = (reason, agentId = agent.id) => silenceReason(reason, { chat: msg.chat, agent: agentId, sender: whoOf(msg) });
  msg.personId = notePerson(msg);
  await serialTurn(channel, { ...msg, kind: 'text', msgId: msg.target }, { agent, role, addressed: true, rowId: before.id, quiet, judge: false, mayStayQuiet: true,
    note: `${whoOf(msg)} edited the message you answered. Before: "${clip(before.text, 300)}". Now: "${clip(msg.text, 300)}". If your answer is now wrong, correct it with edit_my_last_message (or answer again if you cannot edit). If it is still right, answer exactly [quiet].` });
}

// 069: graceful shutdown — new messages are left for after the restart; turns already running may finish.
let inFlight = 0; let closing = false;
const idleWaiters = [];
/** Stop taking messages and wait (at most `ms`) for the turns that are running. Resolves true when all finished. */
export function closeRouter(ms = 6000) {
  closing = true;
  if (!inFlight) return Promise.resolve(true);
  return new Promise((resolve) => { const t = setTimeout(() => resolve(false), ms); idleWaiters.push(() => { clearTimeout(t); resolve(true); }); });
}

const hasBuiltins = (agent) => !!(agent.quickReplies?.length || agent.help || agent.faq?.items?.length);

/**
 * Welcome (054): people joined a group ({ chat, participants: [{ jid, phone }] } from the channel). Only chats that
 * are on with an enabled agent whose welcome is on; see welcome.js.
 */
export function createJoinHandler(channel) {
  return async (ev) => {
    try { noteJoin(channel, ev); } catch (e) { activity('error', { chat: ev?.chat, summary: `Welcome failed: ${e.message}` }); }
  };
}

const overloadedAt = new Map(); // chat → when it was last told the queue is full
const OVERLOADED_NOTE_GAP = 5 * 60 * 1000; // ms before a chat is told again

/** 094: a found GIF / sticker posted on its own after the answer (never fails the answer). */
const postAfter = async (media) => { const m = await media; if (m) await postMedia(m).catch(recordFailure('Sharing a picture after the answer', { agent: m.ctx.agent.id, chat: m.ctx.chat })); };

/** A voice note as the answer (the text is kept in history). Returns the stored answer's id. */
async function sendVoiceNote(channel, msg, agent, { text, voice, media }) {
  await readWhenDue(channel, msg); // 080: read before the answer
  const sent = await channel.sendMedia(msg.chat, { kind: 'audio', base64: voice.buffer.toString('base64'), mimetype: 'audio/ogg', voiceNote: true, ...(quoteOf(msg).quote ? { quote: quoteOf(msg).quote } : {}) });
  const notice = !msg.isGroup ? dmNoticeOnce(msg.phone || msg.chat) : null; // 044: once per person
  if (notice) await channel.send(msg.chat, `_${notice}_`).catch(() => {}); // the answer is out: the notice is tried again with the next one
  countStat('reply', { agent: agent.id });
  const id = logMessage({ channel: msg.channel, chat: msg.chat, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text, fromAgent: true });
  activity('message.out', { agent: agent.id, chat: msg.chat, summary: `🔊 ${text}`, detail: { voice: voice.by, ...(id ? { msg: id } : {}) } });
  await postAfter(media);
  return id;
}

/** The answer as text, at a human pace. Returns the stored answer's id. */
async function sendText(channel, msg, agent, text, { typingSince, media }) {
  await paceReply(channel, msg, text, (await typingSince?.catch(() => 0)) || 0); // 080: read, then typing for the reply's length
  if (!msg.isGroup) { const notice = dmNoticeOnce(msg.phone || msg.chat); if (notice) text = `${text}\n\n_${notice}_`; } // 044: once per person
  // 094: a GIF found for this answer (searched while it was typing) carries a short answer as its caption: one message
  const m = await media;
  let id = fitsCaption(m, text) ? await postMedia(m, { text, quote: quoteOf(msg).quote }).catch(() => null) : null;
  const together = id !== null;
  if (!together) {
    const sent = await channel.send(msg.chat, text, quoteOf(msg));
    id = logMessage({ channel: msg.channel, chat: msg.chat, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text, fromAgent: true });
  }
  countStat('reply', { agent: agent.id });
  // 072: the stored answer's id, so Activity can show and change its rating and open it in the chat
  activity('message.out', { agent: agent.id, chat: msg.chat, summary: text, ...(id ? { detail: { msg: id } } : {}) });
  if (!together) await postAfter(m);
  return id;
}

/** 087: the same answer it just gave here (two turns raced, or it repeats itself) is not sent again; a new one is noted. */
function alreadySaid(msg, agent, text, since) {
  if (!isDuplicate(msg.chat, agent.id, { kind: 'text', text }, since)) { noteSent(msg.chat, agent.id, { kind: 'text', text }); return false; }
  silenceReason('already_answered', { chat: msg.chat, agent: agent.id, sender: whoOf(msg) });
  return true;
}

/** Send a reply (as a voice note when the agent's setting asks for it) and remember it. Returns the stored answer's id. */
async function deliver(channel, msg, agent, text, { voiceIn = false, voiceNow = false, textOnly = false, typingSince = null, again = false, since = msg.arrived || Date.now(), media = null } = {}) {
  // Built-in answers are commands people ask for; `again`: the second leg of a voice answer (already checked).
  if (!textOnly && !again && alreadySaid(msg, agent, text, since)) return undefined;
  if (msg.isGroup) agentSpoke(msg.chat, agent.id); // 076: replies right after this may be follow-ups
  const spoken = !textOnly && wantsVoice(agent, { voiceIn, text }); // built-in answers (054): always text
  if (spoken && voiceNow) {
    const voice = await speak(text, { agent, chat: msg.chat }).catch(() => null); // no voice: the answer goes out as text
    if (voice) return sendVoiceNote(channel, msg, agent, { text, voice, media });
  } else if (spoken) {
    // A text turn whose answer should be spoken: the voice note is made in the media queue (falls back to text).
    try {
      enqueue({ kind: 'voice', chat: msg.chat, msgId: msg.msgId, senderJid: msg.senderJid, agent: agent.id, payload: { msg: packMsg(msg), agent: agent.id, text } });
      await postAfter(media);
      return undefined;
    } catch { /* queue full: send it as text */ }
  }
  return sendText(channel, msg, agent, text, { typingSince, media });
}

/** One agent turn for a routed message (inline for text; from the media queue for photos and voice notes). */
/** What the agent reads of a message: a voice note's transcript, a media caption after its placeholder, or the text;
 *  without the agent's triggers. */
function turnWords(agent, msg, media) {
  const voiceIn = msg.mediaInfo?.type === 'audio' && !!media?.transcript;
  const base = voiceIn ? media.transcript : msg.caption ? `${msg.text.replace(/:.*$/s, ']')} ${stripTriggers(agent, msg.caption)}`.trim() : stripTriggers(agent, msg.text);
  return { voiceIn, text: voiceIn ? stripTriggers(agent, base) || base : base };
}

/** The context of an agent turn (runner.js) for a message from a channel. */
async function turnContext(channel, msg, { agent, role, rowId, text, media, judge, note }) {
  return {
    // #113: the name the owner knows them by (phone contact name unless switched off on the Contacts page)
    agent, role, chat: msg.chat, senderName: agentName({ phone: msg.phone, jid: msg.senderJid, fallbackName: msg.senderName }) || msg.senderName, requester: msg.phone,
    // 079: who wrote (People), and whether it is the owner (verified identity on any app: owner-level People access)
    personId: msg.personId || '', ownerTurn: userForPhone(msg.phone)?.role === 'owner',
    // 057: the sender's group member tag (chats that are on only)
    senderTag: msg.isGroup ? memberTag(msg.chat, { phone: msg.phone, jid: msg.senderJid }) : '',
    text, isGroup: msg.isGroup, source: msg.channel, msgRowId: rowId, msgId: msg.msgId, senderJid: msg.senderJid,
    chatName: msg.isGroup ? await channel.chatName?.(msg.chat) : '',
    attachments: media?.blocks || [], mediaNote: media?.note || '', unaddressed: judge, turnNote: note, since: msg.arrived || Date.now(),
  };
}

/**
 * Run the agent. An error becomes a short apology (nothing when nobody asked it). 074: an agent app waiting for its
 * turn on a small server shows ⏳ on the message, taken back when the answer is out.
 */
async function askAgent(channel, msg, ctx, { judged, quiet }) {
  const mref = msg.msgId ? { msgId: msg.msgId, fromMe: false, participant: msg.senderJid || undefined } : null;
  let waited = false;
  if (mref) ctx.onWait = () => { waited = true; channel.react?.(msg.chat, mref, '⏳')?.catch?.(() => {}); }; // a courtesy: the turn goes on without it
  try {
    return await runAgent(ctx);
  } catch (e) {
    activity('error', { agent: ctx.agent.id, chat: msg.chat, summary: `Agent failed: ${e.message}` });
    quiet('model_error', ctx.agent.id); ctx.share = null; // never a GIF after an error
    return judged ? '' : 'Sorry, I hit an error. Please try again in a minute.'; // nobody asked it: no error message
  } finally {
    if (waited) channel.react?.(msg.chat, mref, '')?.catch?.(() => {}); // the ⏳ may stay: nothing to do about it
  }
}

/**
 * The agent's answer to a message: { out, share, typingSince }. `out` is '' when nothing goes out ([quiet] / [done],
 * no reply, an error nobody asked about); the reason is recorded.
 */
async function modelAnswer(channel, msg, o) {
  const { agent, judged, quiet } = o;
  // 080: the message is read after its read delay, then "typing…" shows; the model works meanwhile
  const typingSince = judged ? null : readWhenDue(channel, msg).then(async () => { await channel.typing?.(msg.chat); return Date.now(); });
  const ctx = await turnContext(channel, msg, o);
  let out = await askAgent(channel, msg, ctx, o);
  const verdict = verdictOf(out); // [quiet] / [done] are never sent (087: also after it corrected itself with an edit)
  if (verdict) {
    if (verdict === 'done') closeFollowups(msg.chat);
    quiet('not_for_me', agent.id);
    return { out: '', share: null, typingSince };
  }
  if (judged && ctx.modelError) out = '';
  if (judged && out) { countStat('handled', { agent: agent.id }); o.logIn(); } // 076: a judged message is logged only when answered
  if (ctx.modelError) quiet('model_error', agent.id); else if (!out) quiet('no_reply', agent.id);
  return { out, share: !ctx.modelError && ctx.share ? { ctx, ...ctx.share } : null, typingSince };
}

/** A photo, PDF or voice note of a queued turn, made ready for the model. `done`: the turn ends here (over budget, or
 *  answered without the model). */
async function inboundMedia(channel, msg, { agent, quiet }) {
  const media = await prepareInbound(msg, { agent, chat: msg.chat });
  if (media?.quiet) { quiet('budget', agent.id); return { media, done: true }; }
  if (media?.reply) { await deliver(channel, msg, agent, media.reply); return { media, done: true }; }
  if (media?.transcript && msg.msgId) setMessageText(msg.chat, msg.msgId, `🎤 ${media.transcript}`);
  return { media, done: false };
}

/**
 * One turn for a message: a queued turn's media, "confirm CODE" / "cancel CODE", else the agent; then the answer goes
 * out (with what it shares). queued: from the media queue; judge (076): nobody addressed the agent, it decides;
 * mayStayQuiet (087): a follow-up turn for messages that arrived while it answered.
 */
async function runTurn(channel, msg, { agent, role, addressed, rowId, quiet, queued = false, judge = false, note = '', mayStayQuiet = false }) {
  let media = null;
  try {
    if (queued) {
      const inbound = await inboundMedia(channel, msg, { agent, quiet });
      media = inbound.media;
      if (inbound.done) return;
    }
    const { voiceIn, text } = turnWords(agent, msg, media);
    const judged = judge || mayStayQuiet; // 087: it may stay quiet: logged and counted only when it answers
    const confirmed = await handleConfirmCommand({ agent, text, role, chat: msg.chat });
    if (confirmed === undefined && !addressed && !judged) return; // looked like "cancel ABCD" but isn't ours
    const logIn = () => activity('message.in', {
      agent: agent.id, chat: msg.chat,
      summary: `${whoOf(msg)} (${role}): ${voiceIn ? `🎤 ${text}` : text}`,
      detail: { phone: msg.phone, isGroup: msg.isGroup, quoted: msg.quoted || undefined, ...(judge ? { judged: true } : {}), ...(media?.blocks?.length ? { attachments: media.blocks.map((b) => b.type) } : {}) },
    });
    if (!judged) { countStat('handled', { agent: agent.id }); logIn(); } // 076: a judged message is logged only when answered
    let answer = { out: confirmed, share: null, typingSince: null };
    if (confirmed === undefined) {
      if (!text) return;
      answer = await modelAnswer(channel, msg, { agent, role, rowId, text, media, judge, judged, note, quiet, logIn });
    }
    if (!answer.out) return;
    const found = answer.share ? findMedia(answer.share.ctx, answer.share) : null; // searched while the answer is typed
    const id = await deliver(channel, msg, agent, answer.out, { voiceIn, voiceNow: queued, typingSince: answer.typingSince, media: found });
    if (judge && msg.isGroup) noteJudgedAnswer(id, agent.id, msg.chat); // 089: feedback on it teaches when to join in
  } finally {
    media?.cleanup?.();
  }
}

/** Media queue handlers (043): queued photo / voice-note turns, pictures and voice replies. */
function registerMediaHandlers(channel) {
  setQueueChannel(channel);
  const quietFor = (msg) => (reason, agentId) => silenceReason(reason, { chat: msg.chat, agent: agentId, sender: msg.senderName || '' });
  registerJobHandler('turn', {
    async run(p) {
      const agent = getAgent(p.agent);
      if (!agent?.enabled || getSetting('paused', false)) return;
      const msg = unpackMsg(channel, p.msg);
      await runTurn(channel, msg, { agent, role: p.role, addressed: p.addressed, rowId: p.rowId, quiet: quietFor(msg), queued: true });
    },
    async stale(p) {
      const msg = unpackMsg(channel, p.msg);
      await channel.send(msg.chat, `Sorry, I couldn’t get to your ${msg.mediaInfo?.type === 'audio' ? 'voice note' : 'photo'} in time. Please send it again if you still need an answer.`, quoteOf(msg)).catch(recordFailure('The apology for a late answer', { chat: msg.chat }));
    },
    async failed(p) {
      const msg = unpackMsg(channel, p.msg);
      await channel.send(msg.chat, 'Sorry, something went wrong with that. Please try again in a minute.', quoteOf(msg)).catch(recordFailure('The apology for a failed answer', { chat: msg.chat }));
    },
  });
  registerJobHandler('image', {
    async run(p) {
      const agent = p.owner ? { id: p.agent } : getAgent(p.agent); // 059: the owner assistant is not a stored agent
      if (!agent) return;
      let image = null;
      if (p.imageFile) {
        try { image = { buffer: readFileSync(p.imageFile), mimetype: p.mimetype || 'image/png' }; } catch { throw Object.assign(new Error('The photo to change is gone (the server restarted); please send it again'), { permanent: true }); }
      }
      try { await createImage(p.input, { agent, chat: p.chat, image }); } finally { if (p.imageFile && !image) rmSync(p.imageFile, { force: true }); }
      if (p.imageFile) rmSync(p.imageFile, { force: true });
    },
    async stale(p) { if (p.imageFile) rmSync(p.imageFile, { force: true }); await channel.send(p.chat, 'Sorry, I couldn’t make that picture in time. Ask me again if you still want it.').catch(recordFailure('The apology for a late picture', { chat: p.chat })); },
    async failed(p, job, e) { if (p.imageFile) rmSync(p.imageFile, { force: true }); await channel.send(p.chat, `Sorry, I couldn’t make that picture${e?.permanent ? ` (${e.message})` : ''}.`).catch(recordFailure('The apology for a failed picture', { chat: p.chat })); },
  });
  const voiceText = async (p) => { const agent = getAgent(p.agent) || { id: p.agent, media: { voiceReply: 'never' } }; await deliver(channel, unpackMsg(channel, p.msg), agent, p.text, { again: true }); };
  registerJobHandler('voice', {
    async run(p) {
      const agent = getAgent(p.agent);
      if (!agent) return;
      await deliver(channel, unpackMsg(channel, p.msg), agent, p.text, { voiceIn: true, voiceNow: true, again: true });
    },
    stale: voiceText, // the answer itself is never dropped: sent as text
    failed: voiceText,
  });
  startQueue();
}
