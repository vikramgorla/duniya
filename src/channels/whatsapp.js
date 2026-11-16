import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
  normalizeMessageContent, isJidGroup, isPnUser, isLidUser, jidNormalizedUser, Browsers,
  decryptPollVote, BufferJSON, sha256, downloadMediaMessage, proto,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, digits } from '../core/config.js';
import { activity, bus } from '../core/events.js';
import { loadMedia, MAX_MEDIA_BYTES } from '../core/media.js';
import { savePoll, getPoll, kvGet, kvSet } from '../core/db.js';
import { syncWhatsAppContacts, mapLid, unmappedLids } from '../core/contacts.js';

const logger = pino({ level: process.env.BAILEYS_LOG || 'warn' });
// 057: address-book names live in the app-state collection "critical_unblock_low" (contactAction / lidContactAction).
const CONTACTS_COLLECTION = 'critical_unblock_low';
const NAMES_SCHEMA = '057'; // bump to make every number take one fresh contacts snapshot after an update
const NAMES_FIRST_MS = Number(process.env.NAMES_REFRESH_FIRST_MS ?? 30000);
const NAMES_EVERY_MS = 24 * 3600000;
const NAMES_MIN_GAP_MS = 10 * 60000;
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
  let onJoin = () => {};
  let onMemberTag = () => {};
  let onPhoneActive = () => {};
  let onGroupChange = () => {};
  let namesDueAt = 0; // 057: checked by the shared upkeep tick; no timer of its own
  let namesBusy = false;
  let namesLast = 0;
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
    bus.emit('status'); // live panel (058): a new QR or pairing code shows without polling
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
        namesDueAt = Date.now() + NAMES_FIRST_MS; // after the initial sync settles
        try { onPhoneActive({ reason: 'connected' }); } catch { /* best effort */ }
      }
      if (connection === 'close') {
        namesDueAt = 0;
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
    // #91: batches the phone sends on demand (fetchHistory) come here too, with syncType ON_DEMAND.
    sock.ev.on('messaging-history.set', async ({ messages, contacts, chats, syncType, lidPnMappings }) => {
      for (const m of lidPnMappings || []) safe(() => mapLid(m.lid, m.pn));
      if (contacts?.length) syncContacts(contacts);
      captureTags(messages || []);
      captureHistoryTags(chats);
      await deliverHistory(messages || [], { onDemand: syncType === proto.HistorySync.HistorySyncType.ON_DEMAND, chats: (chats || []).map((c) => c.id).filter(Boolean) });
    });
    // Address-book names from the phone (#11); stored only, never shared with participants unless the owner says so.
    // 057: address-book (name), business (verifiedName) and profile (notify) names are kept apart, so a profile-name
    // update never replaces the address-book name. LID-only entries wait for the LID↔phone mapping.
    sock.ev.on('contacts.upsert', (list) => { syncContacts(list || []); });
    sock.ev.on('contacts.update', (list) => { syncContacts(list || []); });
    sock.ev.on('lid-mapping.update', (m) => { for (const x of Array.isArray(m) ? m : [m]) safe(() => mapLid(x?.lid, x?.pn)); });
    // 057: group member tags. Baileys emits this for tag changes; captureTags() also reads the tag on every message.
    sock.ev.on('group.member-tag.update', (e) => { if (mySock === sock) emitTag(e.groupId, e.participant, e.participantAlt, e.label, Number(e.messageTimestamp) * 1000 || Date.now()); });

    // Welcome (054): people added to a group, joined by invite link or let in after a join request. This Baileys version
    // reports all of them as action "add" (stub types GROUP_PARTICIPANT_ADD / _INVITE / _ADD_REQUEST_JOIN); "invite"
    // and "join" are accepted too. Participants are contacts ({ id, phoneNumber }) or plain jids. The number itself is
    // skipped (its own join is not a new member).
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
      if (mySock !== sock || !isJidGroup(id)) return;
      groupCache.delete(id);
      safe(() => onGroupChange({ chat: id, action })); // 057: member list (LID↔phone pairs) refreshes on the next upkeep tick
      if (!['add', 'invite', 'join'].includes(action)) return;
      const meUser = sock.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0] : '';
      const meLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid).split('@')[0] : '';
      const people = [];
      for (const p of participants || []) {
        const jid = typeof p === 'string' ? p : p?.id;
        if (!jid) continue;
        const user = jidNormalizedUser(jid).split('@')[0];
        if (user && (user === meUser || user === meLid)) continue;
        let phone = '';
        for (const j of [typeof p === 'object' ? p.phoneNumber : '', jid]) if (!phone && j && isPnUser(j)) phone = digits(jidNormalizedUser(j).split('@')[0]);
        people.push({ jid, phone });
      }
      if (!people.length) return;
      try { await onJoin({ chat: id, participants: people }); } catch (e) { activity('error', { summary: `Welcome handling failed: ${e.message}` }); }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      captureTags(messages || []);
      // #91/057: a message the owner wrote on the phone means the phone is online: pending history loads retry now.
      if (type === 'notify' && (messages || []).some((m) => m?.key?.fromMe)) safe(() => onPhoneActive({ reason: 'phone_message' }));
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

  const safe = (fn) => { try { return fn(); } catch (e) { activity('error', { summary: `WhatsApp names: ${e.message}` }); return undefined; } };
  const pnOf = (j) => (j && isPnUser(j) ? digits(jidNormalizedUser(j).split('@')[0]) : '');
  /** Store synced names, then ask Baileys for the phone of LIDs we only know by name (bounded, in the background). */
  function syncContacts(list) {
    for (const c of list) if (c?.lid && c?.phoneNumber) safe(() => mapLid(c.lid, c.phoneNumber));
    safe(() => syncWhatsAppContacts(list));
    resolveLids().catch(() => {});
  }
  let resolving = false;
  async function resolveLids() {
    const lm = sock?.signalRepository?.lidMapping;
    if (resolving || typeof lm?.getPNForLID !== 'function') return 0;
    resolving = true; let n = 0;
    try {
      for (const lid of unmappedLids(300)) {
        const pn = await lm.getPNForLID(lid).catch(() => null);
        if (pn && mapLid(lid, jidNormalizedUser(pn))) n++;
      }
    } finally { resolving = false; }
    return n;
  }
  /**
   * 057: group member tags. The sender's tag rides along on every group message (contextInfo.memberLabel of the
   * message itself; quoted messages and mentions are other people and are not read). Tag changes also arrive as
   * GROUP_MEMBER_LABEL_CHANGE protocol messages, and history-sync group metadata lists them per participant.
   * A memberLabel with an empty label means the tag was removed; no memberLabel at all says nothing.
   */
  function emitTag(groupJid, participant, participantAlt, label, ts) {
    if (!groupJid || !isJidGroup(groupJid) || !participant) return;
    const phone = pnOf(participantAlt) || pnOf(participant);
    safe(() => onMemberTag({ chat: groupJid, participant: jidNormalizedUser(participant), phone, label: String(label || ''), ts }));
  }
  const num = (v) => Number(v?.low ?? v ?? 0) || 0;
  /** contextInfo of the message itself (any message type), never of a quoted message. */
  function ownContextInfo(c) {
    if (!c || typeof c !== 'object') return null;
    for (const v of Object.values(c)) if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
    return null;
  }
  function captureTags(messages) {
    for (const m of messages) {
      const k = m?.key || {};
      if (!k.remoteJid || !isJidGroup(k.remoteJid) || !m.message) continue;
      const msgTs = num(m.messageTimestamp) * 1000 || Date.now();
      const pm = m.message.protocolMessage;
      if (pm?.type === proto.Message.ProtocolMessage.Type.GROUP_MEMBER_LABEL_CHANGE) {
        if (k.fromMe) continue; // our own number's tag is not needed
        emitTag(k.remoteJid, k.participant, k.participantAlt, pm.memberLabel?.label || '', num(pm.memberLabel?.labelTimestamp) * 1000 || msgTs);
        continue;
      }
      if (k.fromMe || !k.participant) continue;
      let ml;
      try { ml = ownContextInfo(normalizeMessageContent(m.message))?.memberLabel || null; } catch { ml = null; }
      if (ml) emitTag(k.remoteJid, k.participant, k.participantAlt, ml.label || '', num(ml.labelTimestamp) * 1000 || msgTs);
    }
  }
  /** History-sync group metadata: Conversation.participant[] = { userJid, memberLabel? }. */
  function captureHistoryTags(chats) {
    for (const c of chats || []) {
      if (!c?.id || !isJidGroup(c.id) || !Array.isArray(c.participant)) continue;
      for (const p of c.participant) if (p?.userJid && p.memberLabel) emitTag(c.id, p.userJid, '', p.memberLabel.label || '', num(p.memberLabel.labelTimestamp) * 1000 || 1);
    }
  }
  /**
   * 057: address-book names, automatically. A linked device gets them through app-state sync. Baileys syncs every
   * collection once at link, and later only when WhatsApp says a collection changed. So after each connect (and once
   * a day) we ask for the changes of the contacts collection — a small request. Once per number (and again when
   * NAMES_SCHEMA changes) we ask for a full snapshot of it, so names lost to the old single-name bug come back.
   */
  async function refreshNames({ snapshot = false, force = false } = {}) {
    const s = sock;
    if (!s || state.status !== 'open' || typeof s.resyncAppState !== 'function') return { ok: false, reason: 'not_connected' };
    if (namesBusy) return { ok: false, reason: 'busy' };
    if (!force && Date.now() - namesLast < NAMES_MIN_GAP_MS) return { ok: false, reason: 'recent' };
    const snapKey = `contactsSnapshot:${number}`;
    const full = snapshot || kvGet(snapKey) !== NAMES_SCHEMA;
    namesBusy = true; namesLast = Date.now();
    try {
      if (full && s.authState?.keys?.set) await s.authState.keys.set({ 'app-state-sync-version': { [CONTACTS_COLLECTION]: null } });
      await s.resyncAppState([CONTACTS_COLLECTION], false);
      if (full) kvSet(snapKey, NAMES_SCHEMA);
      kvSet(`contactsRefreshedAt:${number}`, Date.now());
      const mapped = await resolveLids().catch(() => 0);
      return { ok: true, snapshot: full, mapped };
    } catch (e) {
      activity('system', { summary: `Could not refresh contact names from WhatsApp${number === 'main' ? '' : ` (${label})`}: ${String(e.message || e).slice(0, 160)}; will try again later` });
      return { ok: false, reason: 'failed' };
    } finally { namesBusy = false; }
  }
  /** Shared upkeep tick (057): refresh names when due (after connect, then daily). */
  async function upkeep() {
    if (state.status !== 'open' || !namesDueAt || Date.now() < namesDueAt) return { ok: false, reason: 'not_due' };
    namesDueAt = Date.now() + NAMES_EVERY_MS;
    return refreshNames({ force: true });
  }

  /**
   * #91: the key of a real message (what fetchHistory needs as an anchor), for every chat, also chats that are off:
   * ids and time only, never content or names.
   */
  function anchorKeyOf(m) {
    const k = m?.key; const jid = k?.remoteJid;
    if (!k?.id || !jid || jid === 'status@broadcast' || jid.endsWith('@newsletter') || !m.message) return null;
    const c = normalizeMessageContent(m.message);
    if (!c || c.protocolMessage || c.reactionMessage || c.pollUpdateMessage) return null;
    const ts = Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0) * 1000;
    if (!ts) return null;
    const isGroup = !!isJidGroup(jid);
    return { chat: jid, isGroup, msgId: k.id, fromMe: !!k.fromMe, participant: isGroup && !k.fromMe ? k.participant || '' : '', ts };
  }

  async function deliverHistory(messages, meta = {}) {
    const out = [];
    const keys = [];
    for (const m of messages) {
      const key = anchorKeyOf(m); if (key) keys.push(key);
      try { const info = await normalize(m, { includeOwn: true }); if (info) out.push(info); } catch { /* skip */ }
    }
    if (out.length || keys.length || meta.onDemand) {
      try { await onHistory(out, { ...meta, keys }); } catch (e) { activity('error', { summary: `History store failed: ${e.message}` }); }
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

  /**
   * Photos & voice (043): what an inbound media message is, without downloading it. `size` is WhatsApp's declared
   * size, so oversized files are refused before any download.
   */
  function mediaInfoOf(c) {
    const num = (v) => (v == null ? 0 : Number(typeof v === 'object' && v.low !== undefined ? v.low + (v.high || 0) * 2 ** 32 : v));
    const doc = c.documentMessage || c.documentWithCaptionMessage?.message?.documentMessage;
    if (c.imageMessage) return { type: 'image', mimetype: c.imageMessage.mimetype || 'image/jpeg', size: num(c.imageMessage.fileLength) };
    if (c.stickerMessage) return { type: 'sticker', mimetype: c.stickerMessage.mimetype || 'image/webp', size: num(c.stickerMessage.fileLength) };
    if (c.audioMessage) return { type: 'audio', mimetype: String(c.audioMessage.mimetype || 'audio/ogg').split(';')[0], size: num(c.audioMessage.fileLength), seconds: num(c.audioMessage.seconds), ptt: !!c.audioMessage.ptt };
    if (doc) return { type: 'document', mimetype: doc.mimetype || '', size: num(doc.fileLength), fileName: doc.fileName || '' };
    return null;
  }
  /** Only what a later download needs (key + media message), serialisable, so a queued job survives a restart. */
  const mediaRefOf = (msg) => JSON.stringify({ key: msg.key, message: msg.message }, BufferJSON.replacer);
  async function downloadRef(ref, declared = 0) {
    if (declared > MAX_MEDIA_BYTES) throw Object.assign(new Error('Media is too large'), { status: 413 });
    const m = typeof ref === 'string' ? JSON.parse(ref, BufferJSON.reviver) : ref;
    const buf = await downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
    if (buf.length > MAX_MEDIA_BYTES) throw Object.assign(new Error('Media is too large'), { status: 413 });
    return buf;
  }

  async function phoneOf(jid, alt) {
    for (const j of [alt, jid]) {
      if (isPnUser(j)) {
        const p = digits(jidNormalizedUser(j).split('@')[0]);
        if (isLidUser(jid)) safe(() => mapLid(jidNormalizedUser(jid), p)); // 057: remember who this LID is
        return p;
      }
    }
    if (isLidUser(jid)) {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
      if (pn) { const p = digits(jidNormalizedUser(pn).split('@')[0]); safe(() => mapLid(jidNormalizedUser(jid), p)); return p; }
    }
    return '';
  }
  /** Phone of a group participant { id, phoneNumber?, lid? }; remembers LID↔phone pairs (057). */
  async function participantPhone(p) {
    let phone = '';
    for (const j of [p.phoneNumber, p.id]) if (!phone && j && isPnUser(j)) phone = digits(jidNormalizedUser(j).split('@')[0]);
    const lid = [p.id, p.lid].find((j) => j && isLidUser(j));
    if (!phone && lid) {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null);
      if (pn) phone = digits(jidNormalizedUser(pn).split('@')[0]);
    }
    if (phone && lid) safe(() => mapLid(jidNormalizedUser(lid), phone));
    return phone;
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
    const selfIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
    const mediaInfo = includeOwn ? null : mediaInfoOf(c);
    const media = mediaInfo ? { mediaInfo, mediaRef: mediaRefOf(msg), fetchMedia: () => downloadRef(msg, mediaInfo.size) } : {};
    return {
      ...base, ...media, kind: 'text', text, quoted, media: !!describe(c), caption: describe(c) ? textOf(c) : '',
      mentioned: (ctx?.mentionedJid || []).some((j) => selfIds.includes(jidNormalizedUser(j))),
      replyToAgent: !!ctx?.participant && selfIds.includes(jidNormalizedUser(ctx.participant)),
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
      const phone = await participantPhone(p);
      out.push({ phone, jid: p.id, admin: p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : null });
    }
    return out;
  }

  return {
    id: 'whatsapp', number, label,
    /** Download the media of a message from its stored reference (043: queued photo / voice-note jobs). */
    async downloadMedia(jid, ref, declared = 0) { ready(); return downloadRef(ref, declared); },
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
    /** 049: { exists, jid, lid } for a phone number (lid: '' when WhatsApp has not shared it). */
    async lookupNumber(who) {
      const s = ready(); const jid = toJid(who);
      const [r] = (await s.onWhatsApp(jid)) || [];
      const lid = await s.signalRepository?.lidMapping?.getLIDForPN?.(jid).catch(() => null);
      return { jid, exists: !!r?.exists, lid: lid ? jidNormalizedUser(lid) : '' };
    },
    async block(who) { const jid = toJid(who); await ready().updateBlockStatus(jid, 'block'); return { jid }; },
    async unblock(who) { const jid = toJid(who); await ready().updateBlockStatus(jid, 'unblock'); return { jid }; },

    /**
     * #91: ask the linked phone for up to `count` (max 50) messages before `anchor` { msgId, fromMe, participant, ts ms }.
     * The answer arrives later as a history batch (onHistory with onDemand: true); the phone must be online.
     */
    async fetchHistory(jid, count, anchor) {
      const s = ready();
      if (!anchor?.msgId) throw Object.assign(new Error('No message of this chat is known yet'), { status: 409 });
      const key = { remoteJid: jid, id: String(anchor.msgId), fromMe: !!anchor.fromMe, ...(isJidGroup(jid) && !anchor.fromMe && anchor.participant ? { participant: anchor.participant } : {}) };
      return s.fetchMessageHistory(Math.max(1, Math.min(50, Number(count) || 50)), key, Number(anchor.ts) || Date.now());
    },
    /** 057: refresh address-book names now (also runs by itself after connect and daily, from the upkeep tick). */
    async refreshNames(opts = {}) { return refreshNames({ ...opts, force: true }); },
    upkeep,
    /** 057: re-read a group's member list (LID↔phone pairs); called by the upkeep tick for chats that are on. */
    async refreshGroup(jid) { needGroup(jid); ready(); invalidate(jid); const meta = await groupMeta(jid); for (const p of meta.participants || []) await participantPhone(p); return { members: meta.participants?.length || 0 }; },
    async start(handler, { onHistory: historyHandler, onJoin: joinHandler, onMemberTag: tagHandler, onPhoneActive: activeHandler, onGroupChange: groupHandler } = {}) {
      if (groupHandler) onGroupChange = groupHandler;
      if (tagHandler) onMemberTag = tagHandler;
      if (activeHandler) onPhoneActive = activeHandler;
      onMessage = handler;
      if (historyHandler) onHistory = historyHandler;
      if (joinHandler) onJoin = joinHandler;
      await connect();
    },
    /** Sends text; returns { msgId } of the sent message. */
    async send(chat, text, { quoted, quote, mentions } = {}) {
      if (state.status !== 'open') throw new Error('WhatsApp is not connected');
      const q = quoted || quotedOf(chat, quote);
      const sent = await sock.sendMessage(chat, { text, ...(mentions?.length ? { mentions } : {}) }, q ? { quoted: q } : undefined);
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
        const phone = await participantPhone(p);
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
      removed = true; stopping = true; namesDueAt = 0;
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
