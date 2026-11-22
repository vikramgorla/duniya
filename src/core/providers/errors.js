// @ts-check
// Provider error classification (042, issue #43): decides whether a failed model call may move on to the next
// account/model in the fallback chain, whether it trips that account's circuit breaker, and for how long.
//
// reason: rate_limit | quota | server | network | timeout | auth | model_not_found | unavailable | bad_request
//  - next:    try the next candidate (never for bad_request: a different provider would get the same bad request)
//  - breaker: pause this account (rate limits, quota, outages, network, expired sign-in)

export const REASON_TEXT = Object.freeze({
  rate_limit: 'rate limit',
  quota: 'usage limit reached',
  server: 'provider error',
  network: 'network error',
  timeout: 'timed out',
  auth: 'sign-in expired or key rejected',
  model_not_found: 'model not available',
  unavailable: 'not connected',
  bad_request: 'request refused',
});

const QUOTA_RE = /quota|usage limit|usage_limit|insufficient[_ ](credit|funds|balance|quota)|credit balance|out of credits|billing|payment required|exceeded your current|limit (reached|exceeded)|exhausted/i;
const RATE_RE = /rate.?limit|too many requests|overloaded|capacity/i;
const AUTH_RE = /invalid api key|incorrect api key|invalid x-api-key|unauthori[sz]ed|authentication|not authenticated|bad credentials|token (has )?expired|invalid_grant|sign.?in expired|refresh token/i;
const MODEL_RE = /model[^.]{0,80}(not found|does not exist|not supported|is not available|unknown|no longer available|not_found)|unknown model|no such model|model_not_found|invalid model/i;
const POLICY_RE = /content.?policy|moderation|flagged|safety|violat/i;
const NET_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

const QUOTA_CODES = new Set(['insufficient_quota', 'subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'copilot_limit', 'usage_limit_reached', 'billing_hard_limit_reached', 'credits_exhausted']);
const RATE_CODES = new Set(['rate_limit_exceeded', 'rate_limit_error', 'overloaded_error']);
const AUTH_CODES = new Set(['invalid_api_key', 'authentication_error', 'permission_error', 'invalid_grant', 'signin_expired', 'token_expired', 'unauthorized']);
const APP_CODES = new Set(['low_memory', 'app_busy', 'app_missing', 'app_start', 'small_server']);
const MODEL_CODES = new Set(['model_not_found', 'not_found_error', 'unknown_model']);

/** A header of the response an error carries (a Headers object or a plain one). */
const headerOf = (e, name) => { const h = e?.headers; return typeof h?.get === 'function' ? h.get(name) : h?.[name]; };

/** Retry-After (seconds or an HTTP date) or retry-after-ms. */
function fromHeaders(e, now) {
  const ra = headerOf(e, 'retry-after');
  if (ra != null && ra !== '') {
    const s = Number(ra);
    if (Number.isFinite(s) && s >= 0) return s * 1000;
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  const ms = headerOf(e, 'retry-after-ms');
  return ms != null && Number.isFinite(Number(ms)) ? Number(ms) : null;
}
/** Milliseconds until a moment given as seconds, milliseconds or a date; null when there is none or it has passed. */
function untilMoment(at, now) {
  if (!at) return null;
  const t = typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : Date.parse(at);
  return Number.isFinite(t) && t > now ? t - now : null;
}
const bodyOf = (e) => e?.error?.error || e?.error || e?.body?.error || {};
/** A reset the provider wrote into the error's body: seconds from now, or a moment. */
function fromBody(e, now) {
  const body = bodyOf(e);
  const secs = Number(body.resets_in_seconds ?? body.reset_in_seconds ?? e?.resetsInSeconds);
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  return untilMoment(body.resets_at ?? body.reset_at ?? e?.resetsAt, now);
}
const HOUR = 3600000; const MINUTE = 60000; const SECOND = 1000; // ms
/** "try again in 20s" in the error's own words. */
function fromWords(e) {
  const m = String(e?.message || '').match(/try again in (\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?)\b/i);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  return Math.round(Number(m[1]) * (unit === 'ms' ? 1 : unit.startsWith('h') ? HOUR : unit.startsWith('m') ? MINUTE : SECOND));
}
/** Milliseconds until a provider says we may try again: what the adapter found, a header, a reset time in the body, or the message. */
export function retryAfterMs(e, now = Date.now()) {
  if (Number.isFinite(e?.retryAfterMs) && e.retryAfterMs > 0) return e.retryAfterMs;
  return fromHeaders(e, now) ?? fromBody(e, now) ?? fromWords(e);
}

/** The reason a provider's own error code names (the surest sign), or ''. */
function byCode(code, status) {
  // 074: an agent app that could not start here (memory, busy, not downloaded) — the next model answers, no pause
  if (code === 'no_model' || code === 'free_only' || APP_CODES.has(code)) return 'unavailable';
  if (QUOTA_CODES.has(code)) return 'quota';
  if (AUTH_CODES.has(code)) return 'auth';
  if (MODEL_CODES.has(code) && status !== 401 && status !== 403) return 'model_not_found';
  if (RATE_CODES.has(code)) return status === 529 || code === 'overloaded_error' ? 'server' : 'rate_limit';
  return '';
}
/** The reason an HTTP error status gives (with the message, where one status means several things), or ''. */
function byStatus(status, msg) {
  if (status === 429) return QUOTA_RE.test(msg) ? 'quota' : 'rate_limit';
  if (status === 402) return 'quota';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  if (status === 401) return 'auth';
  if (status === 403) return POLICY_RE.test(msg) ? 'bad_request' : QUOTA_RE.test(msg) ? 'quota' : 'auth';
  if (status === 404) return 'model_not_found';
  if (status < 400) return '';
  // Some providers report an empty balance as a 400 ("Your credit balance is too low"); that is a quota problem.
  if (QUOTA_RE.test(msg) && !POLICY_RE.test(msg)) return 'quota';
  return MODEL_RE.test(msg) ? 'model_not_found' : 'bad_request';
}
const TIMEOUT_NAMES = new Set(['TimeoutError', 'AbortError', 'APIConnectionTimeoutError']);
const isTimeout = (name, msg) => TIMEOUT_NAMES.has(name) || /timed? ?out|did not answer in time/i.test(msg);
// The Anthropic SDK wraps fetch errors once more (a stream cut mid-way: AnthropicError → TypeError "terminated" → UND_ERR_SOCKET).
const causeCodeOf = (e) => String(e?.cause?.code || e?.cause?.cause?.code || e?.code || '').toUpperCase();
const isNetwork = (e, name, msg) => NET_CODES.has(causeCodeOf(e)) || name === 'APIConnectionError'
  || /fetch failed|socket hang up|network|ECONNRE|ENOTFOUND|connection (closed|error|refused)|^terminated$/i.test(msg);
/** Without an HTTP status: network failures, timeouts, SDK errors, or what the message says (SDK-based adapters, Copilot). */
function byWords(e, msg) {
  const name = String(e?.name || '');
  if (isTimeout(name, msg)) return 'timeout';
  if (isNetwork(e, name, msg)) return 'network';
  if (QUOTA_RE.test(msg)) return 'quota';
  if (RATE_RE.test(msg)) return 'rate_limit';
  if (AUTH_RE.test(msg)) return 'auth';
  if (MODEL_RE.test(msg)) return 'model_not_found';
  if (POLICY_RE.test(msg)) return 'bad_request';
  return 'server'; // unknown errors without a status (e.g. "stream ended before completion") are treated as provider errors
}

const statusOf = (e) => Number(e?.status || e?.statusCode || 0) || 0;
const codeOf = (e) => String(e?.code || e?.error?.error?.type || e?.error?.type || '').toLowerCase();
const NEVER_PAUSES = ['bad_request', 'model_not_found', 'unavailable']; // the account is fine; the request or the model is not
const SAYS_WHEN = ['rate_limit', 'quota']; // reasons a provider gives a time to come back for
/**
 * Classify a provider error. Returns { reason, next, breaker, retryAfterMs, text }.
 * Adapters attach `status` (HTTP), `code` (provider error code) and optionally `headers` / `retryAfterMs`.
 */
export function classify(e) {
  const status = statusOf(e);
  const msg = String(e?.message || e || '');
  const reason = byCode(codeOf(e), status) || byStatus(status, msg) || byWords(e, msg);
  return { reason, text: REASON_TEXT[reason], next: reason !== 'bad_request', breaker: !NEVER_PAUSES.includes(reason), retryAfterMs: SAYS_WHEN.includes(reason) ? retryAfterMs(e) : null };
}
