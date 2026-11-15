// Panel API client core (027): OAuth token exchange, refresh with rotation, Bearer requests. Pure TypeScript with an
// injected fetch so it can be unit-tested with node; the React side (auth.tsx) stores tokens in the secure store.

export const CLIENT_ID = 'duniya-mobile';
export const SCOPE = 'duniya';

export interface Tokens { accessToken: string; refreshToken: string; expiresAt: number }
export interface Session extends Tokens { server: string }
export interface Endpoints { authorization: string; token: string; revocation?: string; clientId: string; resource: string }

export class ApiError extends Error {
  status: number; field?: string;
  constructor(message: string, status: number, field?: string) { super(message); this.status = status; this.field = field; }
}
/** A readable response body (WHATWG streams: expo/fetch on phones, the browser on web). */
export interface BodyReader { read(): Promise<{ done: boolean; value?: Uint8Array }> }
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json(): Promise<any>; text(): Promise<string>; body?: { getReader(): BodyReader } | null;
}>;

const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const offline = () => new ApiError('Cannot reach the server. Check your connection.', 0);

/** Reads the server's OAuth metadata. Throws a plain-language error when the server is not Duniya or too old. */
export async function discover(server: string, fetchFn: Fetch): Promise<Endpoints> {
  let prm; let as;
  try {
    prm = await fetchFn(`${server}/.well-known/oauth-protected-resource/api`);
    as = await fetchFn(`${server}/.well-known/oauth-authorization-server`);
  } catch { throw offline(); }
  if (prm.status === 404 || !prm.ok || !as.ok) {
    throw new ApiError(as.ok ? 'This Duniya server is too old for the app. Update it first (panel → Server → Update).' : 'No Duniya panel answers at this address. Check it in your panel: Settings → Mobile app.', prm.status || as.status);
  }
  const p = await prm.json(); const a = await as.json();
  return { authorization: a.authorization_endpoint, token: a.token_endpoint, revocation: a.revocation_endpoint, clientId: p.mobile_client_id || CLIENT_ID, resource: p.resource };
}

function toTokens(j: any, now: number): Tokens {
  if (!j?.access_token || !j?.refresh_token) throw new ApiError('The server did not return a sign-in', 400);
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: now + (Number(j.expires_in) || 3600) * 1000 };
}
async function tokenCall(server: string, body: Record<string, string>, fetchFn: Fetch, now: () => number): Promise<Tokens> {
  let r;
  try { r = await fetchFn(`${server}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form(body) }); } catch { throw offline(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error_description || j.error || `Sign-in failed (${r.status})`, r.status === 400 ? 401 : r.status);
  return toTokens(j, now());
}

export function exchangeCode(server: string, { code, codeVerifier, redirectUri, clientId = CLIENT_ID }: { code: string; codeVerifier: string; redirectUri: string; clientId?: string }, fetchFn: Fetch, now = Date.now) {
  return tokenCall(server, { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: codeVerifier, redirect_uri: redirectUri, resource: `${server}/api` }, fetchFn, now);
}
export function refreshTokens(server: string, refreshToken: string, fetchFn: Fetch, now = Date.now) {
  return tokenCall(server, { grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken, resource: `${server}/api` }, fetchFn, now);
}
export async function revoke(server: string, token: string, fetchFn: Fetch) {
  try { await fetchFn(`${server}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token, client_id: CLIENT_ID }) }); } catch { /* offline: tokens expire */ }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  /** POST answered with newline-delimited JSON events (#66). onEvent gets every event but 'done' / 'ping';
   *  resolves with the 'done' event, rejects on an 'error' event. Without a readable body, all events come at the end. */
  stream<T>(path: string, body: unknown, onEvent: (e: StreamEvent) => void): Promise<T>;
}

// ---------- streamed answers (#66) ----------
export type StreamEvent = { type: string; [k: string]: any };

/** Splits text chunks into lines and parses each as JSON. Broken lines are skipped; an 'error' event throws. */
export function ndjsonReader(onEvent: (e: StreamEvent) => void) {
  let buf = ''; let done: StreamEvent | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    let e: StreamEvent; try { e = JSON.parse(line); } catch { return; }
    if (!e || typeof e.type !== 'string') return;
    if (e.type === 'error') throw new ApiError(String(e.error || 'Something went wrong'), Number(e.status) || 400);
    if (e.type === 'done') done = e; else if (e.type !== 'ping') onEvent(e);
  };
  return {
    push(chunk: string) { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); take(line); } },
    end(): StreamEvent {
      take(buf); buf = '';
      if (!done) throw new ApiError('The answer was cut off. Please ask again.', 0);
      return done;
    },
  };
}

/** Reads a streamed response: chunk by chunk when the body is readable, else the whole text at the end. */
export async function readStream(r: { text(): Promise<string>; body?: { getReader(): BodyReader } | null }, onEvent: (e: StreamEvent) => void) {
  const lines = ndjsonReader(onEvent);
  const reader = r.body && typeof r.body.getReader === 'function' && typeof TextDecoder !== 'undefined' ? r.body.getReader() : null;
  if (reader) {
    const dec = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) lines.push(dec.decode(value, { stream: true })); }
    lines.push(dec.decode());
  } else lines.push(await r.text());
  return lines.end();
}

/** Ask box state from the events: tool steps (names only) and the latest text. */
export interface AskStep { step: 'thinking' | 'tool' | 'held'; tool?: string; ok?: boolean }
export interface AskProgress { steps: AskStep[]; text: string }
export function applyAskEvent(p: AskProgress, e: StreamEvent): AskProgress {
  if (e.type === 'step' && ['thinking', 'tool', 'held'].includes(e.step)) return { ...p, steps: [...p.steps, { step: e.step, tool: e.tool, ok: e.ok }] };
  if (e.type === 'text' && typeof e.text === 'string') return { ...p, text: e.text };
  return p;
}
/** "search messages" from "search_messages"; list_/get_ prefixes dropped. */
export const toolWords = (name = '') => name.replace(/^(get|list)_/, '').replace(/_/g, ' ');
/** One short line per step for the app: "✓ chat recap", "⏸ change held: set agent enabled", "✕ usage failed". */
export function stepLabel(s: AskStep): string {
  if (s.step === 'held') return `⏸ change held: ${toolWords(s.tool)}`;
  return s.ok ? `✓ ${toolWords(s.tool)}` : `✕ ${toolWords(s.tool)} failed`;
}

/**
 * Bearer client. Refreshes the access token shortly before it expires or after a 401 (once, shared by concurrent
 * calls). When refreshing fails with "invalid", the session is over: onSignedOut() and a 401 error.
 */
export function createClient({ getSession, saveTokens, onSignedOut, fetchFn, streamFetchFn = fetchFn, now = Date.now }: {
  getSession: () => Session | null; saveTokens: (t: Tokens) => void | Promise<void>; onSignedOut: (reason: string) => void; fetchFn: Fetch; streamFetchFn?: Fetch; now?: () => number;
}): ApiClient {
  let refreshing: Promise<Session> | null = null;
  const refresh = (s: Session): Promise<Session> => {
    if (!refreshing) {
      refreshing = refreshTokens(s.server, s.refreshToken, fetchFn, now)
        .then(async (t) => { await saveTokens(t); return { ...s, ...t }; })
        .catch((e: ApiError) => {
          if (e.status === 401) onSignedOut('Your sign-in ended. Sign in again.');
          throw e;
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  };
  async function open(method: string, path: string, body: unknown, f: Fetch, accept: string) {
    let s = getSession();
    if (!s) throw new ApiError('Not signed in', 401);
    if (s.expiresAt - now() < 60_000) s = await refresh(s);
    const send = (tok: string) => f(`${s!.server}${path}`, {
      method, headers: { authorization: `Bearer ${tok}`, accept, ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    }).catch(() => { throw offline(); });
    let r = await send(s.accessToken);
    if (r.status === 401) { s = await refresh(s); r = await send(s.accessToken); }
    return r;
  }
  const failure = async (r: { status: number; text(): Promise<string> }) => {
    const text = await r.text();
    let data: any; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    return new ApiError(data?.error || `Request failed (${r.status})`, r.status, data?.field);
  };
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await open(method, path, body, fetchFn, 'application/json');
    const text = await r.text();
    let data: any; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!r.ok) throw new ApiError(data?.error || `Request failed (${r.status})`, r.status, data?.field);
    return data as T;
  }
  async function stream<T>(path: string, body: unknown, onEvent: (e: StreamEvent) => void): Promise<T> {
    const r = await open('POST', path, body, streamFetchFn, 'application/x-ndjson');
    if (!r.ok) throw await failure(r);
    return (await readStream(r, onEvent)) as T;
  }
  return {
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p), stream,
  };
}
