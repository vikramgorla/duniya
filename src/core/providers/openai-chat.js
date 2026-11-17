// OpenAI Chat Completions adapter: used for OpenAI API keys and any OpenAI-compatible endpoint.
// Internal message format is Anthropic-style blocks; this converts both ways.
// Photos & voice (043): image/document blocks become content parts; OpenAI and OpenRouter adapters also carry
// transcribe / speak / createImage for their documented audio and image endpoints (other endpoints: none).

const dataUrl = (src) => `data:${src.media_type};base64,${src.data}`;
/** Anthropic-style image/document blocks → Chat Completions content parts (null for blocks that are not media). */
function mediaPart(b) {
  if (b.type === 'image' && b.source?.type === 'base64') return { type: 'image_url', image_url: { url: dataUrl(b.source) } };
  if (b.type === 'document' && b.source?.type === 'base64') return { type: 'file', file: { filename: b.title || 'document.pdf', file_data: dataUrl(b.source) } };
  return null;
}

function toChatMessages(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      const results = blocks.filter((b) => b.type === 'tool_result');
      for (const r of results) {
        const content = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
        out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: r.is_error ? `ERROR: ${content}` : content });
      }
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const media = blocks.map(mediaPart).filter(Boolean);
      if (media.length) out.push({ role: 'user', content: [...(text ? [{ type: 'text', text }] : []), ...media] });
      else if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

const toChatTools = (tools = []) => tools.map((t) => ({
  type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } },
}));

function fromChatResponse(json) {
  const choice = json.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];
  if (msg.content) content.push({ type: 'text', text: msg.content });
  for (const c of msg.tool_calls || []) {
    let input;
    try { input = c.function?.arguments ? JSON.parse(c.function.arguments) : {}; } catch { input = { _raw: c.function?.arguments }; }
    content.push({ type: 'tool_use', id: c.id, name: c.function?.name, input });
  }
  const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
  return { content, stop_reason: stop, usage: { input_tokens: json.usage?.prompt_tokens || 0, output_tokens: json.usage?.completion_tokens || 0 } };
}

async function request(url, key, body, { raw = false, timeout = 120000 } = {}) {
  const form = body instanceof FormData;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body && !form ? { 'content-type': 'application/json' } : {}) },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (raw && res.ok) return { buffer: Buffer.from(await res.arrayBuffer()), type: String(res.headers.get('content-type') || '').split(';')[0].trim() };
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const err = new Error(json?.error?.message || `${res.status} ${text.slice(0, 200)}`);
    // status, code and headers let the fallback chain (042) classify the failure and respect Retry-After.
    err.status = res.status; err.code = json?.error?.code || json?.error?.type; err.headers = res.headers; err.error = json;
    throw err;
  }
  return json;
}

/**
 * Read a Chat Completions SSE stream (047, #83): text deltas go to onText as they arrive; tool-call deltas are joined by
 * index; the last chunk's usage (stream_options.include_usage) is kept. Returns a non-streamed response shape for
 * fromChatResponse. Only this response is held in memory. A server that ignored `stream` and answered JSON still works.
 */
export async function readChatStream(res, onText) {
  if (!String(res.headers.get('content-type') || '').includes('text/event-stream')) {
    const json = JSON.parse(await res.text());
    const text = json?.choices?.[0]?.message?.content;
    if (text) onText(text);
    return json;
  }
  let content = ''; let finish = null; let usage = null; let ended = false;
  const calls = []; // index -> { id, function: { name, arguments } }
  const handle = (data) => {
    if (!data) return;
    if (data === '[DONE]') { ended = true; return; }
    let ev; try { ev = JSON.parse(data); } catch { return; }
    if (ev.error) throw Object.assign(new Error(ev.error.message || 'The provider stopped the answer'), { code: ev.error.code || ev.error.type, status: Number(ev.error.status) || undefined, error: ev });
    if (ev.usage) usage = ev.usage;
    const ch = ev.choices?.[0];
    if (!ch) return;
    const d = ch.delta || {};
    if (typeof d.content === 'string' && d.content) { content += d.content; onText(d.content); }
    for (const tc of d.tool_calls || []) {
      const i = Number.isInteger(tc.index) ? tc.index : calls.length;
      const c = calls[i] || (calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.function.name += tc.function.name;
      if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  };
  let buf = '';
  const dec = new TextDecoder();
  const frames = () => {
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      handle(frame.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n'));
    }
  };
  for await (const chunk of res.body) { buf += dec.decode(chunk, { stream: true }); frames(); }
  buf += `${dec.decode()}\n\n`; frames();
  if (!finish && !ended) throw new Error('The answer stream ended before completion');
  const message = { content: content || null, ...(calls.length ? { tool_calls: calls.filter(Boolean) } : {}) };
  return { choices: [{ message, finish_reason: finish || 'stop' }], usage: usage || {} };
}

async function streamRequest(url, key, body, onText, { timeout = 120000, signal = undefined } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([AbortSignal.timeout(timeout), signal]) : AbortSignal.timeout(timeout), // 066: Stop
  });
  if (!res.ok) {
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    throw fail(json?.error?.message || `${res.status} ${text.slice(0, 200)}`, res.status, { code: json?.error?.code || json?.error?.type, headers: res.headers, error: json });
  }
  return readChatStream(res, onText);
}

/** Which documented media endpoints a base URL has: OpenAI's own API, OpenRouter, or none. */
function mediaFlavor(baseUrl, official) {
  if (official) return 'openai';
  const host = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } };
  const h = host(baseUrl);
  return /(^|\.)openrouter\.ai$/.test(h) || (process.env.OPENROUTER_API_BASE && h === host(process.env.OPENROUTER_API_BASE)) ? 'openrouter' : '';
}
const AUDIO_FORMAT = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/flac': 'flac' };
const usageOf = (u = {}) => ({ input_tokens: u.input_tokens ?? u.prompt_tokens ?? 0, output_tokens: u.output_tokens ?? u.completion_tokens ?? 0, ...(u.seconds ? { seconds: u.seconds } : {}) });
const costOf = (u) => (u && Number.isFinite(Number(u.cost)) && u.cost !== null && u.cost !== '' ? Number(u.cost) : undefined);

/**
 * Media endpoints (043). OpenAI: /audio/transcriptions (multipart), /audio/speech, /images/generations|edits.
 * OpenRouter: /audio/transcriptions (JSON input_audio), /audio/speech, /images (input_references for edits).
 * Each returns usage and, where the provider reports it (OpenRouter), the cost in USD.
 */
function mediaMethods(base, key, flavor) {
  if (!flavor) return {};
  return {
    media: flavor,
    /** OpenRouter lists image models separately (/images/models); OpenAI's are in /models (gpt-image-*). */
    ...(flavor === 'openrouter' ? { async listImageModels() {
      const json = await request(`${base}/images/models`, key());
      return (json?.data || []).filter((m) => m?.id).map((m) => ({ id: m.id, label: m.name || m.id, inputs: m.architecture?.input_modalities || ['text'] }));
    } } : {}),
    async transcribe({ model, buffer, mimetype = 'audio/ogg', language }) {
      const format = AUDIO_FORMAT[mimetype] || 'ogg';
      let json;
      if (flavor === 'openai') {
        const form = new FormData();
        form.append('model', model);
        form.append('file', new Blob([buffer], { type: mimetype }), `voice.${format}`);
        if (language) form.append('language', language);
        json = await request(`${base}/audio/transcriptions`, key(), form);
      } else {
        json = await request(`${base}/audio/transcriptions`, key(), { model, input_audio: { data: Buffer.from(buffer).toString('base64'), format }, ...(language ? { language } : {}) });
      }
      return { text: String(json?.text || '').trim(), usage: usageOf(json?.usage), cost: costOf(json?.usage) };
    },
    async speak({ model, voice = 'alloy', text, format = flavor === 'openai' ? 'opus' : 'mp3', instructions }) {
      const got = await request(`${base}/audio/speech`, key(), { model, voice, input: text, response_format: format, ...(instructions ? { instructions } : {}) }, { raw: true });
      return { buffer: got.buffer, mimetype: format === 'opus' ? 'audio/ogg' : format === 'mp3' ? 'audio/mpeg' : got.type };
    },
    async createImage({ model, prompt, size, image }) {
      let json;
      if (flavor === 'openai') {
        if (image) {
          const form = new FormData();
          form.append('model', model); form.append('prompt', prompt);
          if (size) form.append('size', size);
          form.append('image[]', new Blob([image.buffer], { type: image.mimetype }), `photo.${(image.mimetype.split('/')[1] || 'png')}`);
          json = await request(`${base}/images/edits`, key(), form, { timeout: 300000 });
        } else {
          json = await request(`${base}/images/generations`, key(), { model, prompt, n: 1, ...(size ? { size } : {}) }, { timeout: 300000 });
        }
      } else {
        json = await request(`${base}/images`, key(), { model, prompt, n: 1, ...(size ? { size } : {}),
          ...(image ? { input_references: [{ image_url: `data:${image.mimetype};base64,${Buffer.from(image.buffer).toString('base64')}` }] } : {}) }, { timeout: 300000 });
      }
      const d = json?.data?.[0] || {};
      if (!d.b64_json) throw Object.assign(new Error('The provider returned no image'), { code: 'no_image' });
      return { buffer: Buffer.from(d.b64_json, 'base64'), mimetype: d.media_type || `image/${json?.output_format || 'png'}`, usage: usageOf(json?.usage), cost: costOf(json?.usage),
        revisedPrompt: d.revised_prompt || '' };
    },
  };
}

/** Create an adapter for a base URL ("https://api.openai.com/v1", "https://openrouter.ai/api/v1", …). */
export function chatCompletionsProvider({ baseUrl, key, official = false }) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    ...mediaMethods(base, key, mediaFlavor(base, official)),
    async listModels() {
      const json = await request(`${base}/models`, key());
      // OpenRouter-style listings publish prices (USD per token): keep them as USD per 1M tokens for usage costs.
      const per1M = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) || Number(v) < 0 ? undefined : Number(v) * 1e6);
      return (json.data || json.models || []).map((m) => {
        const pin = per1M(m.pricing?.prompt); const pout = per1M(m.pricing?.completion);
        const ins = m.architecture?.input_modalities; const outs = m.architecture?.output_modalities;
        return { id: m.id || m.slug, label: m.name || m.display_name || m.id || m.slug, ...(pin !== undefined && pout !== undefined ? { price: { in: pin, out: pout } } : {}),
          ...(Array.isArray(ins) ? { inputs: ins } : {}), ...(Array.isArray(outs) ? { outputs: outs } : {}) };
      }).filter((m) => m.id);
    },
    streams: true,
    async chat({ model, system, messages, tools, maxTokens, onText = null, signal = undefined }) {
      const body = {
        model, messages: toChatMessages(system, messages),
        ...(tools?.length ? { tools: toChatTools(tools) } : {}),
        ...(official ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      };
      if (onText) {
        let started = false;
        const forward = (d) => { started = true; onText(d); };
        try {
          return fromChatResponse(await streamRequest(`${base}/chat/completions`, key(), { ...body, stream: true, stream_options: { include_usage: true } }, forward, { signal }));
        } catch (e) {
          // Some OpenAI-compatible servers refuse `stream` / `stream_options` (400 / 422): ask the same account once more
          // without streaming. Any other failure goes to the fallback chain.
          if (started || signal?.aborted || !(e.status === 400 || e.status === 422)) throw e;
        }
      }
      return fromChatResponse(await request(`${base}/chat/completions`, key(), body));
    },
  };
}import { fail } from '../config.js';

