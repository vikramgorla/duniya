import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
  normalizeMessageContent, isJidGroup, isPnUser, isLidUser, jidNormalizedUser, Browsers,
  decryptPollVote, BufferJSON, sha256,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, digits } from '../core/config.js';
import { activity } from '../core/events.js';
import { loadMedia } from '../core/media.js';
import { savePoll, getPoll } from '../core/db.js';
import { syncWhatsAppContacts } from '../core/contacts.js';

const logger = pino({ level: process.env.BAILEYS_LOG || 'warn' });
const AUTH_DIR = resolve(DATA_DIR, 'whatsapp-auth');

/**
 * WhatsApp channel (linked device via Baileys).
 * Channel interface used by the router/panel:
 *   start(onMessage), send(chat, text, opts), listChats(), status(), pair(phone), logout(), restart()
 * plus the WhatsApp actions of 026 (media, location, contact, react, edit/delete, polls, groups, profile, block).
 * `deps` lets tests pass a fake socket (makeSocket), auth state and version lookup.
 */
export function createWhatsAppChannel({ number = 'main', label = 'Main', authDir = AUTH_DIR, deps = {} } = {}) {
  const makeSocket = deps.makeSocket || makeWASocket;
  const authState = deps.authState || useMultiFileAuthState;
  const fetchVersion = deps.fetchVersion || fetchLatestBaileysVersion;
  const mediaOpts = deps.media || {};
  const storeKey = (jid) => (number === 'main' ? jid : `${number}#${jid}`); // same ids as the registry
  const AUTH = authDir;
  let sock = null;
  let onMessage = () => {};
  let onHistory = () => {};
  let state = { status: 'starting', qr: null, pairingCode: null, me: null, since: Date.now(), lastError: null };
  let retries = 0;
  let stopping = false;
  let removed = false;
  const groupCache = new Map();

  const setState = (patch) => {
    const before = state.status;
    state = { ...state, ...patch };
    if (patch.status && patch.status !== before) {
      state.since = Date.now();
      activity('channel.status', { summary: `WhatsApp${number === 'main' ? '' : ` (${label})`}: ${patch.status}`, detail: { number, me: state.me, error: state.lastError } });
    }
  };

  async function connect() {
    stopping = false;
    const { state: auth, saveCreds } = await authState(AUTH);
    const { version } = await fetchVersion().catch(() => ({ version: undefined }));
    sock = makeSocket({
      auth, version, logger,
      browser: Browsers.ubuntu('whatsapp-agent-duniya'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      cachedGroupMetadata: async (jid) => groupCache.get(jid)?.meta,
      // Baileys asks for a message it sent when a recipient needs it re-sent; we keep polls (for votes) only.
      getMessage: async (key) => storedPollMessage(key.remoteJid, key.id) || undefined,
    });
    const mySock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (mySock !== sock) return;
      if (qr) setState({ status: 'qr', qr });
      if (connection === 'open') {
        retries = 0;
        setState({ status: 'open', qr: null, pairingCode: null, me: sock.user?.id || null, lastError: null });
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const msg = lastDisconnect?.error?.message || String(code || '');
        if (stopping) return;
        if (code === DisconnectReason.loggedOut) {
          rmSync(AUTH, { recursive: true, force: true });
          setState({ status: 'logged_out', qr: null, me: null, lastError: 'Logged out — scan a new QR' });
          setTimeout(connect, 2000);
          return;
        }
        if (removed) return;
        const delay = Math.min(60000, 2000 * 2 ** retries++);
        setState({ status: 'reconnecting', lastError: msg });
        setTimeout(() => { if (mySock === sock) connect(); }, delay);
      }
    });

    // History delivered on link/reconnect (store only, never answered)
    sock.ev.on('messaging-history.set', async ({ messages, contacts }) => {
      if (contacts?.length) syncWhatsAppContacts(contacts);
      await deliverHistory(messages || []);
    });
    // Address-book names from the phone (#11); stored only, never shared with participants unless the owner says so.
    sock.ev.on('contacts.upsert', (list) => { syncWhatsAppContacts(list || []); });
    sock.ev.on('contacts.update', (list) => { syncWhatsAppContacts(list || []); });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') { await deliverHistory(messages || []); return; }
      for (const msg of messages) {
        try {
          const info = await normalize(msg);
          if (info) await onMessage(info);
        } catch (e) {
          activity('error', { summary: `Message handling failed: ${e.message}`, detail: { stack: e.stack } });
        }
      }
    });
  }

  async function deliverHistory(messages) {
    const out = [];
    for (const m of messages) {
      try { const info = await normalize(m, { includeOwn: true }); if (info) out.push(info); } catch { /* skip */ }
    }
    if (out.length) {
      try { await onHistory(out); } catch (e) { activity('error', { summary: `History store failed: ${e.message}` }); }
    }
  }

  const textOf = (c) => c?.conversation || c?.extendedTextMessage?.text || c?.imageMessage?.caption
    || c?.videoMessage?.caption || c?.documentMessage?.caption || c?.documentWithCaptionMessage?.message?.documentMessage?.caption || '';
  const pollOf = (c) => c?.pollCreationMessage || c?.pollCreationMessageV2 || c?.pollCreationMessageV3 || null;
  const clip = (t, n = 200) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };

  /** Text the agents see for messages without plain text: a placeholder, never the media itself. */
  function describe(c) {
    if (!c) return '';
    const cap = (m) => (m?.caption ? `: ${clip(m.caption, 300)}` : '');
    if (c.imageMessage) return `[image${cap(c.imageMessage)}]`;
    if (c.videoMessage) return `[${c.videoMessage.gifPlayback ? 'GIF' : 'video'}${cap(c.videoMessage)}]`;
    if (c.stickerMessage) return '[sticker]';
    if (c.audioMessage) return c.audioMessage.ptt ? '[voice note]' : '[audio]';
    const doc = c.documentMessage || c.documentWithCaptionMessage?.message?.documentMessage;
    if (doc) return `[document: ${clip(doc.fileName || doc.title || 'file', 120)}${doc.caption ? ` — ${clip(doc.caption, 200)}` : ''}]`;
    if (c.locationMessage || c.liveLocationMessage) {
      const l = c.locationMessage || c.liveLocationMessage;
      return `[location${l.name ? `: ${clip(l.name, 100)}` : ''}${l.address ? `, ${clip(l.address, 120)}` : ''} (${Number(l.degreesLatitude).toFixed(5)}, ${Number(l.degreesLongitude).toFixed(5)})]`;
    }
    if (c.contactMessage) return `[contact: ${clip(c.contactMessage.displayName || 'contact', 80)}]`;
    if (c.contactsArrayMessage) return `[contacts: ${(c.contactsArrayMessage.contacts || []).map((x) => clip(x.displayName, 40)).join(', ')}]`;
    const poll = pollOf(c);
    if (poll) return `[poll: ${clip(poll.name, 200)} — ${(poll.options || []).map((o) => clip(o.optionName, 60)).join(' / ')}${poll.selectableOptionsCount === 1 ? '' : ' (several answers allowed)'}]`;
    return '';
  }

  async function phoneOf(jid, alt) {
    for (const j of [alt, jid]) if (isPnUser(j)) return digits(jidNormalizedUser(j).split('@')[0]);
    if (isLidUser(jid)) {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
      if (pn) return digits(jidNormalizedUser(pn).split('@')[0]);
    }
    return '';
  }

  // ---------- polls: keep the creation message so votes (encrypted per voter) can be decrypted ----------
  function storedPollMessage(jid, id) {
    const p = jid && id ? getPoll(storeKey(jid), id) : null;
    if (!p?.message) return null;
    try { return JSON.parse(p.message, BufferJSON.reviver); } catch { return null; }
  }
  function keepPoll(jid, msgId, message, creator, ts) {
    const c = normalizeMessageContent(message);
    const poll = pollOf(c);
    if (!poll || !msgId) return;
    // Only what decryption needs: the options and the poll's secret.
    const keep = { messageContextInfo: { messageSecret: c.messageContextInfo?.messageSecret || message.messageContextInfo?.messageSecret } };
    if (c.pollCreationMessageV3) keep.pollCreationMessageV3 = poll; else if (c.pollCreationMessageV2) keep.pollCreationMessageV2 = poll; else keep.pollCreationMessage = poll;
    savePoll({ chat: storeKey(jid), msgId, name: poll.name || '', options: (poll.options || []).map((o) => o.optionName || ''),
      selectable: poll.selectableOptionsCount ?? 0, creator: creator || '', message: JSON.stringify(keep, BufferJSON.replacer), ts });
  }
  /** Decrypt a vote; tries the PN and LID forms of creator and voter (WhatsApp signs with whichever the client used). */
  function decryptVote(chat, upd, msgKey) {
    const creationKey = upd.pollCreationMessageKey;
    const poll = getPoll(storeKey(chat), creationKey?.id);
    const stored = storedPollMessage(chat, creationKey?.id);
    const secret = stored?.messageContextInfo?.messageSecret;
    if (!poll || !secret || !upd.vote) return null;
    const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
    const creators = [...new Set([...(creationKey.fromMe ? me : []), poll.creator, creationKey.participantAlt, creationKey.participant, creationKey.remoteJidAlt, creationKey.remoteJid, ...me]
      .filter(Boolean).map(jidNormalizedUser))];
    const voters = [...new Set([msgKey.participantAlt, msgKey.participant, msgKey.remoteJidAlt, msgKey.remoteJid].filter((j) => j && !isJidGroup(j)).map(jidNormalizedUser))];
    for (const pollCreatorJid of creators) {
      for (const voterJid of voters) {
        try {
          const vote = decryptPollVote(upd.vote, { pollEncKey: secret, pollCreatorJid, pollMsgId: creationKey.id, voterJid });
          const byHash = new Map(poll.options.map((o) => [sha256(Buffer.from(o)).toString('hex'), o]));
          const selected = (vote.selectedOptions || []).map((h) => byHash.get(Buffer.from(h).toString('hex')) || 'Unknown');
          return { pollId: creationKey.id, selected };
        } catch { /* try the next combination */ }
      }
    }
    return null;
  }

  async function normalize(msg, { includeOwn = false } = {}) {
    if (!msg?.message || (msg.key.fromMe && !includeOwn)) return null;
    const chat = msg.key.remoteJid;
    if (!chat || chat === 'status@broadcast' || chat.endsWith('@newsletter')) return null;
    const c = normalizeMessageContent(msg.message);
    if (!c || c.protocolMessage) return null;
    const isGroup = !!isJidGroup(chat);
    const fromMe = !!msg.key.fromMe;
    const senderJid = fromMe ? sock.user?.id : isGroup ? msg.key.participant : chat;
    const phone = fromMe ? '' : await phoneOf(senderJid, isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt);
    const ts = Number(msg.messageTimestamp || 0) * 1000 || Date.now();
    const base = { channel: 'whatsapp', raw: msg, chat, isGroup, phone, senderJid, fromMe, msgId: msg.key.id || null, ts,
      senderName: fromMe ? 'Assistant' : msg.pushName || phone || 'someone' };
    // Reactions and poll votes are events about another message: stored, never answered.
    if (c.reactionMessage) {
      if (includeOwn) return null;
      return { ...base, kind: 'reaction', text: '', target: c.reactionMessage.key?.id || '', emoji: c.reactionMessage.text || '' };
    }
    if (c.pollUpdateMessage) {
      if (includeOwn) return null;
      const vote = decryptVote(chat, c.pollUpdateMessage, msg.key);
      if (!vote) { activity('system', { summary: 'A poll vote could not be read (poll not created while this app was running)' }); return null; }
      return { ...base, kind: 'poll_vote', text: '', ...vote };
    }
    if (pollOf(c)) {
      const creator = fromMe ? jidNormalizedUser(sock.user?.id || '') : isGroup ? (msg.key.participantAlt || msg.key.participant) : (msg.key.remoteJidAlt || chat);
      keepPoll(chat, msg.key.id, msg.message, creator, ts);
    }
    const text = textOf(c) && !c.imageMessage && !c.videoMessage && !c.documentMessage && !c.documentWithCaptionMessage ? textOf(c) : (describe(c) || textOf(c));
    if (!String(text).trim()) return null;
    const ctx = c?.extendedTextMessage?.contextInfo || c?.imageMessage?.contextInfo || c?.videoMessage?.contextInfo
      || c?.documentMessage?.contextInfo || c?.audioMessage?.contextInfo || c?.stickerMessage?.contextInfo || c?.locationMessage?.contextInfo;
    const quotedMsg = ctx?.quotedMessage ? normalizeMessageContent(ctx.quotedMessage) : null;
    const quoted = quotedMsg ? (textOf(quotedMsg) || describe(quotedMsg)).slice(0, 500) : '';
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
    return {
      ...base, kind: 'text', text, quoted, media: !!describe(c), caption: describe(c) ? textOf(c) : '',
      mentioned: (ctx?.mentionedJid || []).some((j) => botIds.includes(jidNormalizedUser(j))),
      replyToBot: !!ctx?.participant && botIds.includes(jidNormalizedUser(ctx.participant)),
    };
  }

  async function groupMeta(jid) {
    const hit = groupCache.get(jid);
    if (hit && Date.now() - hit.at < 10 * 60000) return hit.meta;
    const meta = await sock.groupMetadata(jid);
    groupCache.set(jid, { at: Date.now(), meta });
    return meta;
  }

  // ---------- helpers for the WhatsApp actions (026) ----------
  const ready = () => { if (state.status !== 'open' || !sock) throw Object.assign(new Error('WhatsApp is not connected'), { status: 409 }); return sock; };
  const needGroup = (jid) => { if (!isJidGroup(jid)) throw Object.assign(new Error('This only works in a group'), { status: 400 }); };
  /** A phone number (any format) or a jid → jid. */
  const toJid = (who) => {
    const v = String(who || '').trim();
    if (v.includes('@')) return jidNormalizedUser(v);
    const d = digits(v);
    if (d.length < 6) throw Object.assign(new Error(`"${v}" is not a phone number with country code`), { status: 400 });
    return `${d}@s.whatsapp.net`;
  };
  /** Message key from a stored-message reference { msgId, fromMe, participant }. */
  const keyOf = (jid, ref) => {
    if (!ref?.msgId) throw Object.assign(new Error('Which message? (msg id missing)'), { status: 400 });
    return { remoteJid: jid, id: String(ref.msgId), fromMe: !!ref.fromMe, ...(isJidGroup(jid) && !ref.fromMe && ref.participant ? { participant: ref.participant } : {}) };
  };
  const quotedOf = (jid, ref) => (ref?.msgId ? { key: keyOf(jid, ref), message: { conversation: String(ref.text || '') } } : undefined);
  const sentId = (sent) => ({ msgId: sent?.key?.id || null });
  const invalidate = (jid) => groupCache.delete(jid);
  async function participantsInfo(meta) {
    const out = [];
    for (const p of meta.participants || []) {
      let phone = '';
      for (const j of [p.phoneNumber, p.id]) if (!phone && j && isPnUser(j)) phone = digits(jidNormalizedUser(j).split('@')[0]);
      if (!phone && isLidUser(p.id)) {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID(p.id).catch(() => null);
        if (pn) phone = digits(jidNormalizedUser(pn).split('@')[0]);
      }
      out.push({ phone, jid: p.id, admin: p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : null });
    }
    return out;
  }

  return {
    id: 'whatsapp', number, label,
    /** Send media from { url } or { base64, mimetype }. kind: image | gif | video | sticker | audio | document. */
    async sendMedia(jid, { kind, url, base64, mimetype, caption = '', fileName = '', voiceNote = true, quote } = {}) {
      const s = ready();
      const m = await loadMedia(kind, { url, base64, mimetype, fileName }, mediaOpts);
      let content;
      if (kind === 'image' || (kind === 'gif' && m.mimetype === 'image/gif')) content = { image: m.buffer, caption, mimetype: m.mimetype };
      else if (kind === 'gif') content = { video: m.buffer, gifPlayback: true, caption, mimetype: m.mimetype };
      else if (kind === 'video') content = { video: m.buffer, caption, mimetype: m.mimetype };
      else if (kind === 'sticker') content = { sticker: m.buffer };
      else if (kind === 'audio') content = { audio: m.buffer, mimetype: m.mimetype === 'audio/ogg' ? 'audio/ogg; codecs=opus' : m.mimetype, ptt: !!voiceNote && m.mimetype === 'audio/ogg' };
      else content = { document: m.buffer, mimetype: m.mimetype, fileName: m.fileName, caption };
      const sent = await s.sendMessage(jid, content, quote ? { quoted: quotedOf(jid, quote) } : undefined);
      return { ...sentId(sent), mimetype: m.mimetype, bytes: m.buffer.length, asStill: kind === 'gif' && m.mimetype === 'image/gif' };
    },
    async sendLocation(jid, { latitude, longitude, name = '', address = '' }) {
      const lat = Number(latitude); const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw Object.assign(new Error('latitude/longitude out of range'), { status: 400 });
      return sentId(await ready().sendMessage(jid, { location: { degreesLatitude: lat, degreesLongitude: lng, name, address } }));
    },
    async sendContact(jid, { name, phone, org = '' }) {
      const d = digits(phone);
      if (!name || d.length < 6) throw Object.assign(new Error('A contact needs a name and a phone number with country code'), { status: 400 });
      const esc = (v) => String(v).replace(/[\\;,\n]/g, ' ');
      const vcard = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(name)}`, org ? `ORG:${esc(org)};` : '', `TEL;type=CELL;type=VOICE;waid=${d}:+${d}`, 'END:VCARD'].filter(Boolean).join('\n');
      return sentId(await ready().sendMessage(jid, { contacts: { displayName: String(name), contacts: [{ vcard }] } }));
    },
    /** React to a message; an empty emoji removes the reaction. */
    async react(jid, ref, emoji = '') { await ready().sendMessage(jid, { react: { text: String(emoji || ''), key: keyOf(jid, ref) } }); return { ok: true }; },
    async editMessage(jid, msgId, text) { return sentId(await ready().sendMessage(jid, { edit: keyOf(jid, { msgId, fromMe: true }), text: String(text) })); },
    async deleteMessage(jid, ref) { await ready().sendMessage(jid, { delete: keyOf(jid, ref) }); return { ok: true }; },
    async markRead(jid, refs = []) { await ready().readMessages(refs.map((r) => keyOf(jid, r))); return { ok: true }; },
    async presence(jid, kind = 'composing') {
      if (!['composing', 'recording', 'paused', 'available', 'unavailable'].includes(kind)) throw Object.assign(new Error('Unknown presence'), { status: 400 });
      await ready().sendPresenceUpdate(kind, jid); return { ok: true };
    },
    /** Create a poll; the creation message is kept so votes can be decrypted. */
    async sendPoll(jid, { name, options, multi = false }) {
      const values = [...new Set((options || []).map((o) => String(o).trim()).filter(Boolean))];
      if (!String(name || '').trim() || values.length < 2 || values.length > 12) throw Object.assign(new Error('A poll needs a question and 2–12 different options'), { status: 400 });
      const s = ready();
      const sent = await s.sendMessage(jid, { poll: { name: String(name).trim(), values, selectableCount: multi ? 0 : 1 } });
      if (sent?.message) keepPoll(jid, sent.key.id, sent.message, jidNormalizedUser(s.user?.id || ''), Date.now());
      return sentId(sent);
    },
    // ---------- groups ----------
    async groupInfo(jid) {
      needGroup(jid); ready();
      invalidate(jid);
      const meta = await groupMeta(jid);
      return { id: jid, subject: meta.subject || '', description: meta.desc || '', owner: meta.owner || '', size: meta.size || meta.participants?.length || 0,
        createdAt: meta.creation ? meta.creation * 1000 : null, announcement: !!meta.announce, locked: !!meta.restrict, joinApproval: !!meta.joinApprovalMode,
        memberAddMode: meta.memberAddMode ? 'all' : 'admins', participants: await participantsInfo(meta) };
    },
    async groupCreate(subject, people = []) {
      const meta = await ready().groupCreate(String(subject || '').trim().slice(0, 100) || 'New group', people.map(toJid));
      return { id: meta.id, subject: meta.subject };
    },
    async groupInviteLink(jid) { needGroup(jid); const code = await ready().groupInviteCode(jid); return { link: code ? `https://chat.whatsapp.com/${code}` : '' }; },
    async groupRevokeInvite(jid) { needGroup(jid); const code = await ready().groupRevokeInvite(jid); return { link: code ? `https://chat.whatsapp.com/${code}` : '' }; },
    /** action: add | remove | promote | demote. Returns [{ who, status }] (status 200 = done). */
    async groupParticipants(jid, people, action) {
      needGroup(jid);
      if (!['add', 'remove', 'promote', 'demote'].includes(action)) throw Object.assign(new Error('Unknown action'), { status: 400 });
      const list = (people || []).map(toJid);
      if (!list.length) throw Object.assign(new Error('Name at least one person (phone number)'), { status: 400 });
      const res = await ready().groupParticipantsUpdate(jid, list, action);
      invalidate(jid);
      return (res || []).map((r) => ({ who: r.jid, status: String(r.status), ok: String(r.status) === '200' }));
    },
    async groupSubject(jid, subject) { needGroup(jid); await ready().groupUpdateSubject(jid, String(subject).slice(0, 100)); invalidate(jid); return { ok: true }; },
    async groupDescription(jid, description) { needGroup(jid); await ready().groupUpdateDescription(jid, String(description || '').slice(0, 2048) || undefined); invalidate(jid); return { ok: true }; },
    async groupPicture(jid, src) {
      needGroup(jid);
      const m = await loadMedia('image', src, mediaOpts);
      await ready().updateProfilePicture(jid, m.buffer); return { ok: true };
    },
    /** { announcement: only admins send, locked: only admins edit info, joinApproval: admins approve joins } */
    async groupSettings(jid, { announcement, locked, joinApproval } = {}) {
      needGroup(jid); const s = ready();
      if (announcement !== undefined) await s.groupSettingUpdate(jid, announcement ? 'announcement' : 'not_announcement');
      if (locked !== undefined) await s.groupSettingUpdate(jid, locked ? 'locked' : 'unlocked');
      if (joinApproval !== undefined) await s.groupJoinApprovalMode(jid, joinApproval ? 'on' : 'off');
      invalidate(jid);
      return { ok: true };
    },
    async groupLeave(jid) { needGroup(jid); await ready().groupLeave(jid); invalidate(jid); return { ok: true }; },
    // ---------- profile & block ----------
    async profile(who) {
      const s = ready(); const jid = toJid(who);
      const [picture, status] = await Promise.all([
        s.profilePictureUrl(jid, 'image').catch(() => null),
        s.fetchStatus(jid).then((r) => r?.[0]?.status).catch(() => null),
      ]);
      return { jid, phone: await phoneOf(jid), about: status?.status || '', aboutSetAt: status?.setAt ? new Date(status.setAt).getTime() : null, pictureUrl: picture || '' };
    },
    async setProfileName(name) { await ready().updateProfileName(String(name).slice(0, 25)); return { ok: true }; },
    async setProfileStatus(text) { await ready().updateProfileStatus(String(text).slice(0, 139)); return { ok: true }; },
    async block(who) { const jid = toJid(who); await ready().updateBlockStatus(jid, 'block'); return { jid }; },
    async unblock(who) { const jid = toJid(who); await ready().updateBlockStatus(jid, 'unblock'); return { jid }; },

    async start(handler, { onHistory: historyHandler } = {}) {
      onMessage = handler;
      if (historyHandler) onHistory = historyHandler;
      await connect();
    },
    /** Sends text; returns { msgId } of the sent message. */
    async send(chat, text, { quoted, quote } = {}) {
      if (state.status !== 'open') throw new Error('WhatsApp is not connected');
      const q = quoted || quotedOf(chat, quote);
      const sent = await sock.sendMessage(chat, { text }, q ? { quoted: q } : undefined);
      return { msgId: sent?.key?.id || null };
    },
    async chatName(chat) {
      if (!isJidGroup(chat) || state.status !== 'open') return '';
      try { return (await groupMeta(chat)).subject || ''; } catch { return ''; }
    },
    async typing(chat) { await sock?.sendPresenceUpdate('composing', chat).catch(() => {}); },
    async listChats() {
      if (state.status !== 'open') return [];
      const all = await sock.groupFetchAllParticipating();
      return Object.values(all).map((g) => ({ id: g.id, name: g.subject, size: g.participants?.length || 0 }));
    },
    /** Group members: [{ phone, jid, admin }] (phone digits when WhatsApp shares it). */
    async groupMembers(groupJid) {
      const meta = await groupMeta(groupJid);
      const out = [];
      for (const p of meta.participants || []) {
        let phone = '';
        for (const j of [p.phoneNumber, p.id]) if (!phone && j && isPnUser(j)) phone = digits(jidNormalizedUser(j).split('@')[0]);
        if (!phone && isLidUser(p.id)) {
          const pn = await sock.signalRepository?.lidMapping?.getPNForLID(p.id).catch(() => null);
          if (pn) phone = digits(jidNormalizedUser(pn).split('@')[0]);
        }
        out.push({ phone, jid: p.id, admin: p.admin === 'admin' || p.admin === 'superadmin' });
      }
      return out;
    },
    /** Is this sender (phone digits or jid) a member of the group? */
    async isMember(groupJid, phone, jid) {
      try {
        const meta = await groupMeta(groupJid);
        return meta.participants.some((p) => [p.id, p.lid, p.phoneNumber].filter(Boolean)
          .some((id) => id === jid || (phone && digits(id.split('@')[0]) === phone)));
      } catch { return false; }
    },
    async status() {
      return {
        ...state,
        qrDataUrl: state.qr ? await QRCode.toDataURL(state.qr, { margin: 1, width: 280 }) : null,
        qr: undefined,
      };
    },
    async pair(phone) {
      const p = digits(phone);
      if (p.length < 8) throw new Error('Enter the full number with country code');
      if (state.status === 'open') throw new Error('Already connected');
      const code = await sock.requestPairingCode(p);
      setState({ pairingCode: code });
      return code;
    },
    async logout() {
      stopping = true;
      try { await sock?.logout(); } catch { /* ignore */ }
      rmSync(AUTH, { recursive: true, force: true });
      setState({ status: 'logged_out', me: null, qr: null, pairingCode: null });
      setTimeout(connect, 1000);
    },
    /** Unlink and stop for good (number removed). */
    async remove() {
      removed = true; stopping = true;
      try { await sock?.logout(); } catch { /* ignore */ }
      try { sock?.end(undefined); } catch { /* ignore */ }
      rmSync(AUTH, { recursive: true, force: true });
    },
    async restart() {
      stopping = true;
      try { sock?.end(undefined); } catch { /* ignore */ }
      setState({ status: 'starting' });
      setTimeout(connect, 500);
    },
  };
}
