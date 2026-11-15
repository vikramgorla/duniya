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
const MODEL_CODES = new Set(['model_not_found', 'not_found_error', 'unknown_model']);

/** Milliseconds until a provider says we may try again, from a Retry-After header or a reset time in the body. */
export function retryAfterMs(e, now = Date.now()) {
  if (Number.isFinite(e?.retryAfterMs) && e.retryAfterMs > 0) return e.retryAfterMs;
  const h = e?.headers;
  const get = (k) => (typeof h?.get === 'function' ? h.get(k) : h?.[k]);
  const ra = get?.('retry-after');
  if (ra != null && ra !== '') {
    const s = Number(ra);
    if (Number.isFinite(s) && s >= 0) return s * 1000;
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  const ms = get?.('retry-after-ms');
  if (ms != null && Number.isFinite(Number(ms))) return Number(ms);
  const body = e?.error?.error || e?.error || e?.body?.error || {};
  const secs = body.resets_in_seconds ?? body.reset_in_seconds ?? e?.resetsInSeconds;
  if (Number.isFinite(Number(secs)) && Number(secs) > 0) return Number(secs) * 1000;
  const at = body.resets_at ?? body.reset_at ?? e?.resetsAt;
  if (at) {
    const t = typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : Date.parse(at);
    if (Number.isFinite(t) && t > now) return t - now;
  }
  const m = String(e?.message || '').match(/try again in (\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?)\b/i);
  if (m) {
    const n = Number(m[1]); const u = m[2].toLowerCase();
    return Math.round(n * (u === 'ms' ? 1 : u.startsWith('h') ? 3600000 : u.startsWith('m') && u !== 'ms' ? 60000 : 1000));
  }
  return null;
}

/**
 * Classify a provider error. Returns { reason, next, breaker, retryAfterMs, text }.
 * Adapters attach `status` (HTTP), `code` (provider error code) and optionally `headers` / `retryAfterMs`.
 */
export function classify(e) {
  const status = Number(e?.status || e?.statusCode || 0) || 0;
  const code = String(e?.code || e?.error?.error?.type || e?.error?.type || '').toLowerCase();
  const msg = String(e?.message || e || '');
  const causeCode = String(e?.cause?.code || e?.code || '').toUpperCase();
  const name = String(e?.name || '');
  const out = (reason) => ({
    reason, text: REASON_TEXT[reason],
    next: reason !== 'bad_request',
    breaker: !['bad_request', 'model_not_found', 'unavailable'].includes(reason),
    retryAfterMs: ['rate_limit', 'quota'].includes(reason) ? retryAfterMs(e) : null,
  });

  if (code === 'no_model' || code === 'free_only') return out('unavailable');
  if (QUOTA_CODES.has(code)) return out('quota');
  if (AUTH_CODES.has(code)) return out('auth');
  if (MODEL_CODES.has(code) && status !== 401 && status !== 403) return out('model_not_found');
  if (RATE_CODES.has(code)) return out(status === 529 || code === 'overloaded_error' ? 'server' : 'rate_limit');

  if (status === 429) return out(QUOTA_RE.test(msg) ? 'quota' : 'rate_limit');
  if (status === 402) return out('quota');
  if (status === 408) return out('timeout');
  if (status >= 500) return out('server');
  if (status === 401) return out('auth');
  if (status === 403) return out(POLICY_RE.test(msg) ? 'bad_request' : QUOTA_RE.test(msg) ? 'quota' : 'auth');
  if (status === 404) return out('model_not_found');
  if (status >= 400) {
    // Some providers report an empty balance as a 400 ("Your credit balance is too low"); that is a quota problem.
    if (QUOTA_RE.test(msg) && !POLICY_RE.test(msg)) return out('quota');
    if (MODEL_RE.test(msg)) return out('model_not_found');
    return out('bad_request');
  }

  // No HTTP status: network failures, timeouts, SDK errors, or messages from SDK-based adapters (Copilot).
  if (name === 'TimeoutError' || name === 'AbortError' || name === 'APIConnectionTimeoutError' || /timed? ?out|did not answer in time/i.test(msg)) return out('timeout');
  if (NET_CODES.has(causeCode) || name === 'APIConnectionError' || /fetch failed|socket hang up|network|ECONNRE|ENOTFOUND|connection (closed|error|refused)/i.test(msg)) return out('network');
  if (QUOTA_RE.test(msg)) return out('quota');
  if (RATE_RE.test(msg)) return out('rate_limit');
  if (AUTH_RE.test(msg)) return out('auth');
  if (MODEL_RE.test(msg)) return out('model_not_found');
  if (POLICY_RE.test(msg)) return out('bad_request');
  // Unknown errors without a status (e.g. "stream ended before completion") are treated as provider errors.
  return out('server');
}
