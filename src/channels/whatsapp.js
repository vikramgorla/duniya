import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
  normalizeMessageContent, isJidGroup, isPnUser, isLidUser, jidNormalizedUser, Browsers,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, digits } from '../core/config.js';
import { activity } from '../core/events.js';

const logger = pino({ level: process.env.BAILEYS_LOG || 'warn' });
const AUTH_DIR = resolve(DATA_DIR, 'whatsapp-auth');

/**
 * WhatsApp channel (linked device via Baileys).
 * Channel interface used by the router/panel:
 *   start(onMessage), send(chat, text, opts), listChats(), status(), pair(phone), logout(), restart()
 */
export function createWhatsAppChannel() {
  let sock = null;
  let onMessage = () => {};
  let onHistory = () => {};
  let state = { status: 'starting', qr: null, pairingCode: null, me: null, since: Date.now(), lastError: null };
  let retries = 0;
  let stopping = false;
  const groupCache = new Map();

  const setState = (patch) => {
    const before = state.status;
    state = { ...state, ...patch };
    if (patch.status && patch.status !== before) {
      state.since = Date.now();
      activity('channel.status', { summary: `WhatsApp: ${patch.status}`, detail: { me: state.me, error: state.lastError } });
    }
  };

  async function connect() {
    stopping = false;
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    sock = makeWASocket({
      auth, version, logger,
      browser: Browsers.ubuntu('whatsapp-agent-duniya'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      cachedGroupMetadata: async (jid) => groupCache.get(jid)?.meta,
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
          rmSync(AUTH_DIR, { recursive: true, force: true });
          setState({ status: 'logged_out', qr: null, me: null, lastError: 'Logged out — scan a new QR' });
          setTimeout(connect, 2000);
          return;
        }
        const delay = Math.min(60000, 2000 * 2 ** retries++);
        setState({ status: 'reconnecting', lastError: msg });
        setTimeout(() => { if (mySock === sock) connect(); }, delay);
      }
    });

    // History delivered on link/reconnect (store only, never answered)
    sock.ev.on('messaging-history.set', async ({ messages }) => {
      await deliverHistory(messages || []);
    });

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
    || c?.videoMessage?.caption || c?.documentMessage?.caption || '';

  async function phoneOf(jid, alt) {
    for (const j of [alt, jid]) if (isPnUser(j)) return digits(jidNormalizedUser(j).split('@')[0]);
    if (isLidUser(jid)) {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
      if (pn) return digits(jidNormalizedUser(pn).split('@')[0]);
    }
    return '';
  }

  async function normalize(msg, { includeOwn = false } = {}) {
    if (!msg?.message || (msg.key.fromMe && !includeOwn)) return null;
    const chat = msg.key.remoteJid;
    if (!chat || chat === 'status@broadcast' || chat.endsWith('@newsletter')) return null;
    const c = normalizeMessageContent(msg.message);
    const text = textOf(c);
    if (!text.trim()) return null;
    const isGroup = !!isJidGroup(chat);
    const fromMe = !!msg.key.fromMe;
    const senderJid = fromMe ? sock.user?.id : isGroup ? msg.key.participant : chat;
    const phone = fromMe ? '' : await phoneOf(senderJid, isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt);
    const ctx = c?.extendedTextMessage?.contextInfo || c?.imageMessage?.contextInfo || c?.videoMessage?.contextInfo;
    const quoted = ctx?.quotedMessage ? textOf(normalizeMessageContent(ctx.quotedMessage)).slice(0, 500) : '';
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
    const ts = Number(msg.messageTimestamp || 0) * 1000 || Date.now();
    return {
      channel: 'whatsapp', raw: msg, chat, isGroup, text, phone, senderJid, fromMe, quoted, msgId: msg.key.id || null, ts,
      senderName: fromMe ? 'Assistant' : msg.pushName || phone || 'someone',
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

  return {
    id: 'whatsapp',
    async start(handler, { onHistory: historyHandler } = {}) {
      onMessage = handler;
      if (historyHandler) onHistory = historyHandler;
      await connect();
    },
    /** Sends text; returns { msgId } of the sent message. */
    async send(chat, text, { quoted } = {}) {
      if (state.status !== 'open') throw new Error('WhatsApp is not connected');
      const sent = await sock.sendMessage(chat, { text }, quoted ? { quoted } : undefined);
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
      rmSync(AUTH_DIR, { recursive: true, force: true });
      setState({ status: 'logged_out', me: null, qr: null, pairingCode: null });
      setTimeout(connect, 1000);
    },
    async restart() {
      stopping = true;
      try { sock?.end(undefined); } catch { /* ignore */ }
      setState({ status: 'starting' });
      setTimeout(connect, 500);
    },
  };
}
