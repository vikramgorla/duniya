// ChatGPT plan usage via "Sign in with ChatGPT" (OpenAI open-source flow), adapted for headless servers:
// the owner completes sign-in in their browser and pastes the final loopback address back into the panel.
// Contract: developers.openai.com/siwc/token-sharing-open-source/*
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { getSecret, setSecret, getSetting, updateSettings } from '../store.js';
import { verifyIdToken } from './jwt.js';

export const id = 'chatgpt';
const AUTH_BASE = () => (process.env.OPENAI_AUTH_BASE || 'https://auth.openai.com').replace(/\/+$/, '');
const ISSUER = () => process.env.OPENAI_AUTH_ISSUER || 'https://auth.openai.com';
const API_BASE = () => (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
const RESOURCE = 'https://api.openai.com/v1';
const REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const APP_NAME = 'whatsapp-agent-duniya';
const CRED = 'CHATGPT_CREDENTIALS';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pending = new Map(); // state -> { verifier, nonce, clientId, registering, at }

export function credentials() {
  const raw = getSecret(CRED);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
const saveCredentials = (c) => setSecret(CRED, JSON.stringify(c));
export const configured = () => !!credentials()?.access_token;

function hostId() {
  let h = getSetting('siwcHostId');
  if (!h) { h = `urn:uuid:${randomUUID()}`; updateSettings({ siwcHostId: h }); }
  return h;
}

/** Step 1: build the authorize URL. */
export function startSignIn() {
  for (const [s, p] of pending) if (Date.now() - p.at > 15 * 60000) pending.delete(s);
  const saved = credentials();
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const clientId = saved?.client_id || 'dynamic_agent_client';
  const params = new URLSearchParams({
    client_id: clientId,
    ext_agent_host_id: hostId(),
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    resource: RESOURCE,
    state, nonce,
    code_challenge_method: 'S256',
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
  });
  if (!saved) params.set('agent_name_hint', APP_NAME);
  else {
    if (saved.id_token) params.set('id_token_hint', saved.id_token);
    if (saved.email) params.set('login_hint', saved.email);
  }
  pending.set(state, { verifier, nonce, clientId, registering: !saved, at: Date.now() });
  return { authorizeUrl: `${AUTH_BASE()}/api/accounts/authorize?${params}`, redirectUri: REDIRECT_URI, expiresIn: 900 };
}

async function tokenRequest(form) {
  const res = await fetch(`${AUTH_BASE()}/api/accounts/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form), signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || `token endpoint ${res.status}`), { code: json.error, status: 400 });
  return json;
}
const scopesOf = (t) => (Array.isArray(t.scopes) ? t.scopes : String(t.scope || '').split(/[\s+]+/)).filter(Boolean);

/** Step 2: the owner pastes the address their browser ended on. */
export async function completeSignIn(callbackUrl) {
  let url;
  try { url = new URL(String(callbackUrl).trim()); } catch { throw Object.assign(new Error('Paste the full address from the browser (starting with http://127.0.0.1)'), { status: 400 }); }
  const q = url.searchParams;
  if (q.get('error')) {
    throw Object.assign(new Error(q.get('error') === 'access_denied' ? 'Sign-in was cancelled or plan usage was declined' : `OpenAI returned ${q.get('error')}`), { status: 400 });
  }
  const p = pending.get(q.get('state') || '');
  if (!p) throw Object.assign(new Error('This sign-in link is unknown or expired. Start again.'), { status: 400 });
  pending.delete(q.get('state'));
  const issued = q.get('client_id');
  if (p.registering && !issued) throw Object.assign(new Error('Registration incomplete: no client id returned. Start again.'), { status: 400 });
  if (!p.registering && issued && issued !== p.clientId) throw Object.assign(new Error('Unexpected client id in the response'), { status: 400 });
  const clientId = p.registering ? issued : p.clientId;
  const code = q.get('code');
  if (!code) throw Object.assign(new Error('The address has no authorization code'), { status: 400 });

  const tok = await tokenRequest({
    grant_type: 'authorization_code', client_id: clientId, code, code_verifier: p.verifier,
    redirect_uri: REDIRECT_URI, resource: RESOURCE,
  });
  const claims = await verifyIdToken(tok.id_token, { issuer: ISSUER(), audience: clientId, nonce: p.nonce, discoveryBase: AUTH_BASE() });
  const scopes = scopesOf(tok);
  if (!scopes.includes(PLAN_SCOPE)) {
    throw Object.assign(new Error('Signed in, but ChatGPT plan usage was not granted (Plus or Pro required, and allow plan usage on the consent screen)'), { status: 400 });
  }
  const creds = {
    client_id: clientId, ext_agent_host_id: hostId(), email: claims.email || '', issuer: claims.iss, subject: claims.sub,
    id_token: tok.id_token, access_token: tok.access_token, refresh_token: tok.refresh_token, token_type: tok.token_type || 'Bearer',
    expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000, scopes, saved_at: new Date().toISOString(),
  };
  saveCredentials(creds);
  return { email: creds.email };
}

let refreshing = null;
async function accessToken() {
  const c = credentials();
  if (!c?.access_token) throw new Error('ChatGPT is not connected (Models → Sign in with ChatGPT)');
  if (c.expires_at - Date.now() > 5 * 60000) return c.access_token;
  refreshing ??= (async () => {
    try {
      const tok = await tokenRequest({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: c.refresh_token });
      const next = {
        ...c, access_token: tok.access_token, refresh_token: tok.refresh_token || c.refresh_token,
        id_token: tok.id_token || c.id_token, expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
        scopes: tok.scope || tok.scopes ? scopesOf(tok) : c.scopes, saved_at: new Date().toISOString(),
      };
      saveCredentials(next);
      return next.access_token;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

export async function disconnect() {
  const c = credentials();
  if (c?.refresh_token) {
    try {
      const disc = await (await fetch(`${AUTH_BASE()}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) })).json();
      if (disc.revocation_endpoint) {
        await fetch(disc.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: c.refresh_token, token_type_hint: 'refresh_token', client_id: c.client_id }) });
      }
    } catch { /* best effort */ }
  }
  setSecret(CRED, '');
}

export async function listModels() {
  const res = await fetch(`${API_BASE()}/models`, { headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `models ${res.status}`);
  return (json.models || []).filter((m) => (m.visibility ?? 'list') === 'list').map((m) => ({ id: m.slug, label: m.display_name || m.slug }));
}

// ---------- Responses API (store:false, stream:true) ----------
export function toResponsesInput(messages) {
  const input = [];
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === 'text') {
        input.push(m.role === 'assistant'
          ? { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: b.text }] }
          : { type: 'message', role: 'user', content: [{ type: 'input_text', text: b.text }] });
      } else if (b.type === 'tool_use') {
        input.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) });
      } else if (b.type === 'tool_result') {
        const out = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        input.push({ type: 'function_call_output', call_id: b.tool_use_id, output: b.is_error ? `ERROR: ${out}` : out });
      }
    }
  }
  return input;
}

function fromOutputItems(items = []) {
  const content = [];
  for (const it of items) {
    if (it.type === 'message') {
      const text = (it.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
      if (text) content.push({ type: 'text', text });
    } else if (it.type === 'function_call') {
      let input = {};
      try { input = it.arguments ? JSON.parse(it.arguments) : {}; } catch { input = { _raw: it.arguments }; }
      content.push({ type: 'tool_use', id: it.call_id, name: it.name, input });
    }
  }
  return content;
}

export async function chat({ model, system, messages, tools }) {
  const body = {
    model, instructions: system, input: toResponsesInput(messages), store: false, stream: true,
    ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} }, strict: false })) } : {}),
  };
  const res = await fetch(`${API_BASE()}/responses`, {
    method: 'POST', headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw Object.assign(new Error(json.error?.message || `ChatGPT request failed (${res.status})`), { code: json.error?.code, status: res.status });
  }
  const items = [];
  let completed = null;
  let buf = '';
  const decoder = new TextDecoder();
  const handle = (data) => {
    if (!data || data === '[DONE]') return;
    const ev = JSON.parse(data);
    if (ev.type === 'response.output_item.done' && ev.item) items.push(ev.item);
    else if (ev.type === 'response.completed') completed = ev.response || {};
    else if (ev.type === 'response.failed' || ev.type === 'error') {
      const e = ev.response?.error || ev.error || {};
      throw Object.assign(new Error(e.message || 'ChatGPT request failed'), { code: e.code });
    } else if (ev.type === 'response.incomplete') completed = { ...(ev.response || {}), incomplete: true };
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      handle(data);
    }
  }
  if (!completed) throw new Error('ChatGPT stream ended before completion');
  const content = fromOutputItems(completed.output?.length ? completed.output : items);
  const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : completed.incomplete ? 'max_tokens' : 'end_turn';
  return { content, stop_reason: stop, usage: { input_tokens: completed.usage?.input_tokens || 0, output_tokens: completed.usage?.output_tokens || 0 } };
}
