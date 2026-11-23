// Photos & voice (043, issue #48): what connected providers can do beyond text, and the code that uses it.
//  - Photos in: WhatsApp photos (stickers optional, PDFs) sent to an agent go to vision-capable models as image /
//    document blocks; a model that can't see gets a vision fallback model (Settings) or says so kindly.
//  - Voice notes in: transcribed (OpenAI API → OpenRouter → on-server engine), then handled as text.
//  - Create images: tool media__create_image, only when a capable provider is connected (OpenAI gpt-image models,
//    OpenRouter image models). Sign in with ChatGPT is not used for this: OpenAI lists image generation and the
//    transcription API as unsupported for ChatGPT plan usage (SIWC preview limitations).
//  - Voice replies: per agent never / when they sent a voice note / always (OpenAI TTS → OpenRouter → on-server).
// Photo bytes are never stored in the database: they live in temp files under DATA_DIR/media-tmp that are deleted
// after the turn (the last photo of a chat is kept 15 minutes so "make it a cartoon" can follow it). History keeps
// only the "[image: caption]" placeholder; voice notes are stored as "🎤 transcript".
// Every provider call is counted in usage (and so in spending caps); heavy work goes through the small-server queue.
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, bad, clip } from './config.js';
import { getSetting, updateSettings } from './store.js';
import { providers, providerModels, resolveModel, parseRef, accountById, warmModels } from './providers/index.js';
import { recordUsage, priceFor, usageTag } from './usage.js';
import { checkBudget } from './budget.js';
import { activity } from './events.js';
import { logMessage } from './db.js';
import { mediaDetail, storedMedia } from './message-media.js';
import { MAX_MEDIA_BYTES, sniffType } from './media.js';
import { runJob, optionalPaused } from './resources.js';
import { transcribeLocal, speakLocal, engineReady, hasFfmpeg, convertAudio, localStatus } from './speech-local.js';
import { chatChannel } from './chat-tools.js';

const TMP = join(DATA_DIR, 'media-tmp');
const LAST_PHOTO_MS = 15 * 60000;

// ---------- agent settings ----------
export const MEDIA_DEFAULTS = Object.freeze({
  photos: true, documents: true, stickers: false, voiceNotes: true, voiceReply: 'never', createImages: { organizer: true, participant: false },
});
export const VOICE_REPLY = ['never', 'voice', 'always'];
/** The agent's "Photos & voice" settings with defaults. */
export const agentMedia = (agent) => ({ ...MEDIA_DEFAULTS, ...(agent?.media || {}), createImages: { ...MEDIA_DEFAULTS.createImages, ...(agent?.media?.createImages || {}) } });

// ---------- server settings ----------
export const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const SETTINGS_DEFAULTS = { visionFallback: '', voice: 'alloy', maxVoiceSeconds: 300, imageModel: '', imagePrices: {}, local: { listen: false, speak: false } };
export function mediaSettings() {
  const s = getSetting('media', {}) || {};
  return { ...SETTINGS_DEFAULTS, ...s, imagePrices: { ...(s.imagePrices || {}) }, local: { ...SETTINGS_DEFAULTS.local, ...(s.local || {}) } };
}
const REF = /^[a-z][a-z0-9-]{1,30}:[A-Za-z0-9._:/@+-]{1,120}$/;
// One setting of a patch, checked: the value to store, or a plain error.
const modelRef = (message, field) => (v) => { const ref = String(v || '').trim(); if (ref && !REF.test(ref)) throw bad(message, field); return ref; };
function imagePrices(prices) {
  const out = {};
  for (const [ref, v] of Object.entries(prices || {})) {
    if (!REF.test(ref)) throw bad(`"${ref}" is not provider:model`, 'imagePrices');
    if (v === '' || v == null) continue;
    const n = Number(v); if (!(n >= 0 && n <= 10)) throw bad('Price per image: 0–10 USD', 'imagePrices');
    out[ref] = n;
  }
  return out;
}
const MEDIA_FIELDS = {
  visionFallback: modelRef('Vision fallback must be a model (provider:model) or empty', 'visionFallback'),
  imageModel: modelRef('Image model must look like provider:model, or be empty for automatic', 'imageModel'),
  voice: (v) => { if (!VOICES.includes(v)) throw bad(`Voice must be one of ${VOICES.join(', ')}`, 'voice'); return v; },
  maxVoiceSeconds: (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 10 || n > 1800) throw bad('Longest voice note: 10–1800 seconds', 'maxVoiceSeconds'); return n; },
  imagePrices,
};
/** Validate and save a patch of the server's photo & voice settings. */
export function setMediaSettings(patch = {}) {
  const cur = mediaSettings();
  const next = { ...cur };
  for (const [field, checked] of Object.entries(MEDIA_FIELDS)) if (field in patch) next[field] = checked(patch[field]);
  if (patch.local) {
    const pick = (k) => (patch.local[k] !== undefined ? !!patch.local[k] : cur.local[k]);
    next.local = { listen: pick('listen'), speak: pick('speak') };
  }
  updateSettings({ media: next });
  return mediaSettings();
}

// ---------- capabilities ----------
const VISION_NAME = /vision|vl\b|-vl|gpt-4o|gpt-4\.1|gpt-5|o3|o4|claude|gemini|llava|pixtral|llama-?3\.2.*vision|llama-?4|qwen.*vl|gemma-?3|grok-.*vision|mistral-(small|medium)-3/i;
const OPENAI_NO_VISION = /^(gpt-3\.5|o1-mini|o3-mini|gpt-4-|gpt-4$|davinci|babbage)/i;
const IMAGE_PREF = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];
const STT_PREF = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'];
const OPENROUTER = { stt: 'openai/gpt-4o-mini-transcribe', tts: 'openai/gpt-4o-mini-tts-2025-12-15' };
const paidMedia = (p) => p.configured && p.adapter?.media && !p.freeOnly; // free-only OpenRouter: no paid media calls

const listed = async (p) => (p.type === 'anthropic' ? [] : (await providerModels(p)).models || []);
const imageModelCache = new Map(); // account -> { at, models }
async function imageModelsOf(p) {
  if (p.type === 'openai') return (await listed(p)).map((m) => m.id).filter((id) => /^gpt-image/.test(id))
    .sort((a, b) => (IMAGE_PREF.indexOf(a) + 1 || 99) - (IMAGE_PREF.indexOf(b) + 1 || 99));
  if (p.type === 'openrouter' && p.adapter?.listImageModels) {
    const hit = imageModelCache.get(p.id);
    if (hit && Date.now() - hit.at < 3600000) return hit.models;
    const models = await p.adapter.listImageModels().then((l) => l.map((m) => m.id), () => []);
    models.sort((a, b) => (/gpt-image|gemini/.test(b) ? 1 : 0) - (/gpt-image|gemini/.test(a) ? 1 : 0));
    imageModelCache.set(p.id, { at: Date.now(), models });
    return models;
  }
  return [];
}
export const clearImageModelCache = () => imageModelCache.clear();

/** Does this model (account:model) take images? */
export async function modelSeesImages(ref) {
  const r = parseRef(ref);
  const p = r && accountById(r.provider);
  if (!p) return false;
  if (p.type === 'anthropic' || p.type === 'chatgpt') return true;
  if (['copilot', 'claudecode', 'codex'].includes(p.type)) return false; // agent apps (074) get the conversation as text only
  if (p.type === 'openai') return !OPENAI_NO_VISION.test(r.model);
  const m = (await listed(p).catch(() => [])).find((x) => x.id === r.model);
  if (Array.isArray(m?.inputs)) return m.inputs.includes('image');
  return VISION_NAME.test(r.model);
}

/** What one account can do, with a plain "how to enable" hint for what it can't. */
async function accountCaps(p) {
  const row = { id: p.id, type: p.type, name: p.name, connected: !!p.configured };
  const how = {};
  if (p.type === 'anthropic') Object.assign(row, { sees: 'yes', hears: false, creates: false, speaks: false });
  else if (p.type === 'chatgpt') {
    Object.assign(row, { sees: 'yes', hears: false, creates: false, speaks: false });
    how.hears = how.creates = 'OpenAI does not offer this for ChatGPT plan sign-in yet. Add an OpenAI API key or OpenRouter for it.';
  } else if (['copilot', 'claudecode', 'codex'].includes(p.type)) {
    Object.assign(row, { sees: 'no', hears: false, creates: false, speaks: false });
    how.sees = 'Not through the agent app (it gets text only). Choose a vision fallback model under Settings → Photos & voice.';
  } else if (p.type === 'openai') {
    const img = p.configured ? await imageModelsOf(p).catch(() => []) : [];
    Object.assign(row, { sees: 'yes', hears: true, creates: img.length > 0, speaks: true, imageModel: img[0] || '' });
    if (!img.length) how.creates = 'No gpt-image model is listed for this key. Check the key’s project has image models enabled (OpenAI may ask for organization verification).';
  } else if (p.type === 'openrouter') {
    const free = !!p.freeOnly;
    const img = p.configured && !free ? await imageModelsOf(p) : [];
    Object.assign(row, { sees: 'some', hears: !free, creates: !free && img.length > 0, speaks: !free && hasFfmpeg(), imageModel: img[0] || '' });
    if (free) how.hears = how.creates = how.speaks = 'Turn off “Free models only” for OpenRouter (these are paid calls).';
    else if (!hasFfmpeg()) how.speaks = 'Needs ffmpeg on the server (the installer adds it; update the app).';
  } else {
    Object.assign(row, { sees: 'some', hears: false, creates: false, speaks: false });
    how.hears = how.creates = how.speaks = 'Not available through generic OpenAI-compatible endpoints.';
  }
  row.how = how;
  return row;
}

/** Capabilities of every connected account, plus the on-server engines and what the app will use. */
export async function capabilities() {
  const s = mediaSettings();
  const local = localStatus();
  const rows = [];
  for (const p of providers().filter((x) => x.configured)) rows.push(await accountCaps(p));
  const localListen = s.local.listen && engineReady('stt');
  const localSpeak = s.local.speak && engineReady('tts') && local.ffmpeg;
  return {
    providers: rows, local, settings: s,
    summary: {
      sees: rows.some((r) => r.sees !== 'no'), hears: rows.some((r) => r.hears) || localListen, creates: rows.some((r) => r.creates), speaks: rows.some((r) => r.speaks) || localSpeak,
      localListen, localSpeak,
    },
  };
}

// ---------- temp files ----------
const lastPhoto = new Map(); // chat -> { file, mimetype, at }
function tempPath(ext) { mkdirSync(TMP, { recursive: true, mode: 0o700 }); return join(TMP, `${randomUUID()}.${ext}`); }
function sweepTemp() {
  try {
    const keep = new Set([...lastPhoto.values()].filter((x) => Date.now() - x.at < LAST_PHOTO_MS).map((x) => x.file));
    for (const [chat, x] of lastPhoto) if (!keep.has(x.file)) lastPhoto.delete(chat);
    for (const f of readdirSync(TMP)) {
      const full = join(TMP, f);
      if (!keep.has(full) && Date.now() - statSync(full).mtimeMs > LAST_PHOTO_MS) rmSync(full, { force: true });
    }
  } catch { /* nothing to sweep */ }
}
// Files older than 15 minutes go (also leftovers of a previous run; queued jobs older than that are answered with an
// apology anyway).
sweepTemp();
setInterval(sweepTemp, 5 * 60000).unref?.();

// ---------- usage ----------
function usageRow({ agent, chat, p, model, feature, usage = {}, cost, perImage }) {
  try {
    let known = cost;
    let priced = 'provider';
    if (known === undefined && perImage !== undefined) { known = perImage; priced = 'set'; }
    if (known === undefined && p?.type === 'local') { known = 0; priced = 'free'; }
    recordUsage({ ...usageTag(feature, { agent: agent?.id, chat }), provider: p.type === 'compatible' ? p.id : p.type, account: p.id, model,
      input: usage.input_tokens || 0, output: usage.output_tokens || 0, ...(known !== undefined ? { cost: known, priced } : {}) });
  } catch { /* never fail because of bookkeeping */ }
}
const LOCAL = { id: 'local', type: 'local', name: 'On-server engine' };

// ---------- voice notes in ----------
/** Providers that can transcribe, in the order they are tried. */
async function sttCandidates() {
  const out = [];
  for (const p of providers().filter(paidMedia)) {
    if (p.type === 'openai') {
      const ids = (await listed(p).catch(() => [])).map((m) => m.id);
      out.push({ p, model: STT_PREF.find((m) => ids.includes(m)) || STT_PREF[0] });
    } else if (p.type === 'openrouter') out.push({ p, model: OPENROUTER.stt });
  }
  if (mediaSettings().local.listen && engineReady('stt')) out.push({ p: LOCAL, model: 'whisper-tiny' });
  return out;
}
export const canHear = async () => (await sttCandidates()).length > 0;

/** Transcribe audio with the first provider that works. Returns { text, by }; throws { code: 'no_engine' } if none. */
export async function transcribe(buffer, mimetype, { agent, chat } = {}) {
  const cands = await sttCandidates();
  if (!cands.length) throw Object.assign(new Error('No provider that can listen to voice notes is connected'), { code: 'no_engine' });
  const errors = [];
  for (const { p, model } of cands) {
    try {
      if (p.type === 'local') {
        const text = await transcribeLocal(buffer);
        usageRow({ agent, chat, p, model, feature: 'transcribe' });
        return { text, by: 'on-server engine' };
      }
      const r = await runJob('Transcription', () => p.adapter.transcribe({ model, buffer, mimetype }), { timeoutMs: 120000 });
      usageRow({ agent, chat, p, model, feature: 'transcribe', usage: r.usage, cost: r.cost });
      return { text: r.text, by: `${p.name} · ${model}` };
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
    }
  }
  throw Object.assign(new Error(`Transcription failed (${errors.join('; ')})`), { code: 'stt_failed' });
}

// ---------- photos in ----------
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const declaredBytes = (info) => Number(info?.size || 0);
/** What an inbound media message is, for this agent: 'audio' | 'image' | 'document' | null (not handled). */
export function inboundKind(msg, agent) {
  const info = msg?.mediaInfo; const m = agentMedia(agent);
  if (!info || typeof msg.fetchMedia !== 'function') return null;
  if (info.type === 'audio') return m.voiceNotes ? 'audio' : null;
  if (info.type === 'image') return m.photos ? 'image' : null;
  if (info.type === 'sticker') return m.photos && m.stickers ? 'image' : null;
  if (info.type === 'document') return m.documents && info.mimetype === 'application/pdf' ? 'document' : null;
  return null;
}

/**
 * Get an inbound photo, PDF or voice note ready for the agent turn. Only called for chats that are on and messages
 * addressed to the agent. Returns null (handle as before) or
 * { kind, text?, transcript?, blocks: [image/document blocks], reply? (answer this instead of running the agent), cleanup() }.
 */
export async function prepareInbound(msg, { agent, chat }) {
  const kind = inboundKind(msg, agent);
  if (!kind) return null;
  const info = msg.mediaInfo; const s = mediaSettings();
  const files = [];
  const done = { kind, blocks: [], cleanup: () => { for (const f of files) if (![...lastPhoto.values()].some((x) => x.file === f)) rmSync(f, { force: true }); } };
  if (declaredBytes(info) > MAX_MEDIA_BYTES) { // rejected by WhatsApp's declared size, before downloading anything
    const limit = Math.round(MAX_MEDIA_BYTES / 1048576);
    if (kind === 'audio') return { ...done, reply: `That voice note is too large for me (limit ${limit} MB). Could you type it, or send a shorter one?` };
    return { ...done, note: `(The ${kind === 'image' ? 'photo' : 'file'} is larger than ${limit} MB, so it was not opened. Tell them briefly.)` };
  }
  if (kind === 'audio') {
    if (info.seconds && info.seconds > s.maxVoiceSeconds) return { ...done, reply: `That voice note is longer than I can listen to (${Math.round(s.maxVoiceSeconds / 60)} min max). Could you send a shorter one or type it?` };
    if (!(await canHear())) return { ...done, reply: 'Sorry, I can’t listen to voice notes here yet. Please type your message.' };
    const budget = await checkBudget(agent, chat).catch(() => ({ action: 'ok' }));
    if (budget.action === 'quiet') return { ...done, quiet: true }; // the agent turn stays quiet too (040)
    try {
      const buffer = await runJob('Voice note download', () => msg.fetchMedia(), { timeoutMs: 60000 });
      const r = await transcribe(buffer, info.mimetype || 'audio/ogg', { agent, chat });
      if (!r.text) return { ...done, reply: 'I couldn’t make out any words in that voice note. Could you try again or type it?' };
      activity('media.voice', { agent: agent.id, chat, summary: `🎤 ${clip(r.text, 200)} (${r.by})` });
      return { ...done, text: r.text, transcript: r.text };
    } catch (e) {
      activity('error', { agent: agent.id, chat, summary: `Voice note not transcribed: ${e.message}` });
      return { ...done, reply: 'Sorry, I couldn’t listen to that voice note just now. Please type your message or try again in a minute.' };
    }
  }
  // photo / sticker / PDF
  try {
    const buffer = await runJob('Photo download', () => msg.fetchMedia(), { timeoutMs: 60000 });
    if (buffer.length > MAX_MEDIA_BYTES) return { ...done, note: '(The file was too large to open. Tell them briefly.)' };
    const type = sniffType(buffer) || info.mimetype || '';
    if (kind === 'image' && !IMAGE_TYPES.includes(type)) return { ...done, note: '(They sent a picture in a format you cannot open.)' };
    if (kind === 'document' && type !== 'application/pdf') return null;
    const file = tempPath(kind === 'image' ? (type.split('/')[1] || 'img') : 'pdf');
    writeFileSync(file, buffer, { mode: 0o600 });
    files.push(file);
    if (kind === 'image') {
      const prev = lastPhoto.get(chat);
      if (prev && prev.file !== file) rmSync(prev.file, { force: true });
      lastPhoto.set(chat, { file, mimetype: type, at: Date.now() });
    }
    const source = { type: 'base64', media_type: type, data: buffer.toString('base64') };
    done.blocks.push(kind === 'image' ? { type: 'image', source } : { type: 'document', source, title: clip(info.fileName || 'document.pdf', 100) });
    return done;
  } catch (e) {
    done.cleanup();
    activity('error', { agent: agent.id, chat, summary: `Photo not downloaded: ${e.message}` });
    return { ...done, note: '(They sent a photo but it could not be downloaded. Tell them briefly.)' };
  }
}

/**
 * Before the model call (runner): does the chosen model see images? Returns { model, attachments, note }:
 * the same model, the vision fallback model (Settings), or no attachments and a note asking the model to say kindly
 * that it can't look at photos.
 */
export async function planAttachments(modelRef, attachments = []) {
  if (!attachments.length) return { model: modelRef, attachments, note: '' };
  let ref = modelRef;
  try {
    const parsed = parseRef(modelRef);
    if (!parsed || parsed.model === 'auto') { await warmModels(); const r = resolveModel(modelRef, 'agent'); ref = r.ref; }
  } catch { return { model: modelRef, attachments: [], note: '' }; }
  if (await modelSeesImages(ref)) return { model: modelRef, attachments, note: '' };
  const fb = mediaSettings().visionFallback;
  const fbp = fb && accountById(parseRef(fb)?.provider || '');
  if (fbp?.configured && await modelSeesImages(fb)) return { model: fb, attachments, note: '', viaFallback: true };
  return { model: modelRef, attachments: [], note: noVisionNote(attachments) };
}

/** The note for a model that gets the turn without its photos / files. */
export function noVisionNote(attachments = []) {
  const what = attachments.some((b) => b.type === 'image') ? 'a photo' : 'a file';
  return `(They sent ${what}, but your current model cannot look at photos or files. Say so kindly in one short sentence — an admin can choose a model that sees images — and answer any text they wrote.)`;
}

/**
 * Model-call options for a turn that carries photos / files (#67): fallback skips accounts that cannot see them
 * (e.g. Copilot) and tries the vision fallback model (Settings) after the chain.
 */
export function visionCallOptions() {
  const fb = mediaSettings().visionFallback;
  return { accept: (ref) => modelSeesImages(ref), lastResort: fb ? [fb] : [] };
}

// ---------- create images ----------
/** Providers that can create images, in the order they are tried: the chosen image model first. */
async function imageCandidates() {
  const s = mediaSettings();
  const out = [];
  const pref = parseRef(s.imageModel);
  if (pref) { const p = accountById(pref.provider); if (p && paidMedia(p)) out.push({ p, model: pref.model }); }
  for (const p of providers().filter(paidMedia)) {
    const models = await imageModelsOf(p).catch(() => []);
    if (models.length && !out.some((c) => c.p.id === p.id && c.model === models[0])) out.push({ p, model: models[0] });
  }
  return out;
}
export const canCreateImages = async () => (await imageCandidates()).length > 0;
/** May this role create images in this agent (agent switch + a capable provider)? */
export async function imageToolAllowed(agent, role) {
  if (!agentMedia(agent).createImages[role]) return false;
  return canCreateImages();
}
const SIZES = ['1024x1024', '1024x1536', '1536x1024', 'auto'];

export const mediaTools = [
  { name: 'create_image', annotations: { readOnlyHint: false, destructiveHint: false }, roles: ['organizer', 'participant'],
    description: 'Create a picture from a description and send it to this chat as a WhatsApp image with a caption. To change a photo someone just sent, set edit_of to "last_photo". Only when someone asks for a picture.',
    input_schema: { type: 'object', properties: {
      prompt: { type: 'string', description: 'What the picture should show, in detail', maxLength: 4000 },
      size: { type: 'string', enum: SIZES, description: 'square 1024x1024 (default), portrait 1024x1536, landscape 1536x1024' },
      caption: { type: 'string', description: 'Short caption sent with the picture', maxLength: 300 },
      edit_of: { type: 'string', enum: ['last_photo'], description: '"last_photo" = change the photo most recently sent in this chat (within 15 minutes) instead of starting from nothing' },
    }, required: ['prompt'] },
    async run(input, ctx) { return queueImage(input, ctx); } },
];

/**
 * The tool call queues the picture (media-queue.js) and returns at once, so the reply goes out while the picture is
 * made; the queue sends it when ready (⏳ on the request if it has to wait). A photo to change is copied to its own
 * temp file for the job (never into the database).
 */
async function queueImage(input, ctx) {
  const { agent, chat } = ctx;
  if (!String(input.prompt || '').trim()) throw new Error('Describe the picture');
  if (optionalPaused()) throw new Error('The server is low on memory, so creating pictures is paused for now. Try again later.');
  const budget = await checkBudget(agent, chat).catch(() => ({ action: 'ok' }));
  if (budget.action === 'quiet') throw new Error('The monthly spending cap is reached, so no pictures can be created until it resets.');
  let imageFile = '';
  if (input.edit_of === 'last_photo') {
    const src = recentPhoto(chat, ctx.attachments);
    if (!src) throw new Error('There is no recent photo in this chat to change. Ask them to send the photo again with the request.');
    imageFile = tempPath(src.mimetype.split('/')[1] || 'img');
    writeFileSync(imageFile, src.buffer, { mode: 0o600 });
  }
  const { enqueue } = await import('./media-queue.js');
  try {
    enqueue({ kind: 'image', chat, msgId: ctx.msgId || '', senderJid: ctx.senderJid || '', agent: agent.id,
      payload: { agent: agent.id, ...(ctx.ownerChat === chat ? { owner: true } : {}), chat, input: { prompt: input.prompt, size: input.size, caption: input.caption, edit_of: input.edit_of }, imageFile, mimetype: imageFile ? `image/${imageFile.split('.').pop()}` : '' } });
  } catch (e) {
    if (imageFile) rmSync(imageFile, { force: true });
    if (e.code === 'overloaded') throw new Error('Too many pictures and voice notes are waiting right now; ask them to try again in a few minutes.', { cause: e });
    throw e;
  }
  return { queued: true, note: 'The picture is being made and will appear in the chat shortly (usually within a minute). Say so briefly; do not promise a link.' };
}
function recentPhoto(chat, attachments) {
  const att = (attachments || []).find((b) => b.type === 'image');
  if (att) return { buffer: Buffer.from(att.source.data, 'base64'), mimetype: att.source.media_type };
  const last = lastPhoto.get(chat);
  if (last && Date.now() - last.at < LAST_PHOTO_MS) { try { return { buffer: readFileSync(last.file), mimetype: last.mimetype }; } catch { /* swept */ } }
  return null;
}

/** A created picture goes to the chat and (096) into its stored messages, so the panel shows it. Returns what was sent. */
async function postPicture(r, { agent, chat, caption, keep, said, size }) {
  const ch = chatChannel();
  if (!ch) throw new Error('WhatsApp is not available here');
  const sent = await ch.sendMedia(chat, { kind: 'image', base64: r.buffer.toString('base64'), mimetype: r.mimetype, caption });
  const media = storedMedia(sent);
  const id = keep ? logMessage({ chat, agent: agent.id, msgId: sent?.msgId || null, sender: 'agent', name: 'Assistant', text: `[image${caption ? `: ${caption}` : ''}]`, fromAgent: true, media }) : 0;
  activity('media.image', { agent: agent.id, chat, summary: said, detail: { size: size || 'default', bytes: r.buffer.length, ...(id ? { msg: id, ...mediaDetail(media) } : {}) } });
  return sent;
}
/**
 * The image job (queue): the provider chain, usage, and the send. `image`: { buffer, mimetype } to change. `keep`: the
 * picture is stored with the chat's messages (096; not in the owner assistant's own chat, which lives elsewhere).
 */
export async function createImage(input, { agent, chat, image = null, keep = true }) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('Describe the picture'), { permanent: true });
  const size = SIZES.includes(input.size) && input.size !== 'auto' ? input.size : undefined;
  const cands = (await imageCandidates()).filter((c) => !image || c.p.type === 'openai' || c.p.type === 'openrouter');
  if (!cands.length) throw Object.assign(new Error('No connected provider can create pictures.'), { permanent: true });
  const errors = [];
  for (const { p, model } of cands) {
    try {
      const r = await runJob('Image creation', () => p.adapter.createImage({ model, prompt, size, image }), { timeoutMs: 300000 });
      const ref = `${p.id}:${model}`;
      const perImage = mediaSettings().imagePrices[ref] ?? mediaSettings().imagePrices[`${p.type}:${model}`];
      const tokenPrice = priceFor(p.type, model);
      usageRow({ agent, chat, p, model, feature: 'image', usage: r.usage, cost: r.cost, perImage: r.cost === undefined && perImage === undefined && tokenPrice ? undefined : perImage });
      const caption = clip(input.caption || '', 300);
      const sent = await postPicture(r, { agent, chat, caption, keep, said: `Created a picture with ${p.name} · ${model}${image ? ' (edit)' : ''}: ${clip(prompt, 160)}`, size });
      return { sent: true, msgId: sent?.msgId || null, caption, note: 'The picture is already in the chat; do not describe how to download it.' };
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
    }
  }
  throw new Error(`Could not create the picture (${errors.join('; ').slice(0, 400)})`);
}

// ---------- voice replies ----------
async function ttsCandidates() {
  const out = [];
  for (const p of providers().filter(paidMedia)) {
    if (p.type === 'openai') out.push({ p, model: 'gpt-4o-mini-tts', format: 'opus' });
    else if (p.type === 'openrouter' && hasFfmpeg()) out.push({ p, model: OPENROUTER.tts, format: 'mp3' });
  }
  const s = mediaSettings();
  if (s.local.speak && engineReady('tts') && hasFfmpeg()) out.push({ p: LOCAL, model: 'piper-amy' });
  return out;
}
export const canSpeak = async () => (await ttsCandidates()).length > 0;
const TTS_MAX_CHARS = 1500;
/** Should this reply be a voice note? (agent setting, the inbound message, and replies that must stay text). */
export function wantsVoice(agent, { voiceIn = false, text = '' } = {}) {
  const mode = agentMedia(agent).voiceReply;
  if (mode === 'never' || (mode === 'voice' && !voiceIn)) return false;
  if (!text || text.length > TTS_MAX_CHARS) return false;
  if (/\b(confirm|cancel) [A-Z0-9]{4}\b/.test(text) || /https?:\/\//.test(text)) return false; // codes and links stay readable
  return true;
}
/** Turn reply text into an Ogg/Opus voice note. Returns { buffer, by } or null when no engine could. */
export async function speak(text, { agent, chat } = {}) {
  const spoken = String(text).replace(/[*_~`]/g, '').replace(/^\s*-\s+/gm, '');
  const budget = await checkBudget(agent, chat).catch(() => ({ action: 'ok' }));
  if (budget.action === 'quiet') return null;
  for (const { p, model, format } of await ttsCandidates()) {
    try {
      if (p.type === 'local') {
        const buffer = await speakLocal(spoken);
        usageRow({ agent, chat, p, model, feature: 'speech' });
        return { buffer, by: 'on-server engine' };
      }
      const r = await runJob('Voice reply', () => p.adapter.speak({ model, voice: mediaSettings().voice, text: spoken, format }), { timeoutMs: 90000 });
      const buffer = format === 'opus' ? r.buffer : await runJob('Audio conversion', () => convertAudio(r.buffer, 'ogg'), { timeoutMs: 90000 });
      usageRow({ agent, chat, p, model, feature: 'speech', usage: { input_tokens: Math.ceil(spoken.length / 4) } });
      return { buffer, by: `${p.name} · ${model}` };
    } catch (e) {
      activity('error', { agent: agent?.id || '', chat, summary: `Voice reply with ${p.name} failed: ${e.message}` });
    }
  }
  return null;
}
