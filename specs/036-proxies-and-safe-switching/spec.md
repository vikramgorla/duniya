# Feature Specification: Domains behind any proxy/CDN, safe switching, provider-neutral access

**Feature Branch**: `feat/31-33-domain-gcp` | **Created**: 2026-11-15 | **Status**: Implemented | **Issue**: #31

**Input** (owner): "do you support custom domain setting when the https for that domain is issued outside like
cloudflare dns proxy". Refined by the owner during implementation: fully automatic (no certificate uploads); any proxy
"or similar"; reachability proof instead of comparing DNS with the server IP; never support unencrypted
proxy→server ("Flexible"); two-step domain switch with explicit confirmation from the new address; access lock-down as
a trial with automatic undo; provider-neutral presets.

## User Scenarios & Testing

### Story 1 — Domain behind a proxy/CDN (P1)
The owner types `agents.example.org` (proxied by any CDN) and taps **Check**. DNS points to the CDN, not here; the
check still succeeds because a one-time token served by this app at `/.well-known/duniya-check/<token>` is fetched
through the domain. The hint says "behind a proxy/CDN (looks like Cloudflare)".
**Acceptance**: 1. Domains that reach the server through any proxy are accepted; 2. domains that don't are refused with
the reason (DNS missing / wrong / proxy error 52x / blocked by a rule); 3. a proxy that talks plain HTTP to the
server is a blocking error ("set SSL mode Full (strict)").

### Story 2 — Automatic HTTPS behind the proxy (P1)
Caddy asks Let's Encrypt (HTTP-01 through the proxy) and falls back to its internal CA (2 h certificates), so the proxy
connects encrypted immediately ("Full"). The card shows per address: "Encrypted to the proxy with a temporary
certificate — set SSL/TLS mode Full" → "Let's Encrypt certificate … you can set Full (strict)", and, when ACME keeps
failing, the web server's reason with the exact fix (e.g. a WAF rule blocking `/.well-known/acme-challenge/`).

### Story 3 — Two-step domain switch (P1)
**Add this domain** serves it next to the current address. Opening the panel at the new address offers **Confirm —
new address works** (accepted only from a request that arrived through the new domain via the web server). The new
domain becomes the main address; the old keeps working until the owner clicks **Turn off** (then it forwards). Cancel /
go back at any step. Nothing switches off on a timer.

### Story 4 — Access lock-down as a trial (P1)
**Only a proxy/CDN** (Amazon CloudFront, Bunny CDN, Cloudflare, Fastly, Gcore — official lists refreshed daily — or own
ranges) and/or **own list**. A stricter rule is applied as a trial: a countdown (10 min) starts once active; the owner
confirms from a request that passed the new rules, otherwise the previous rules are restored automatically. A warning
(needs confirmation) comes first if the rule would block the current request.

### Story 5 — No open ports (P2)
The card points to installer tunnels: Cloudflare Tunnel, Tailscale (Funnel for public), other tunnels via
`--local-only` (frp, ngrok, Pangolin, zrok) — listed neutrally.

### Edge cases
- Caddy 2.6 (Debian 12 / Ubuntu 24.04 packages): no `client_ip`/`trusted_proxies`; proxy + own list refused. A proxy
  using `X-Forwarded-For` + own list needs Caddy 2.8 (`trusted_proxies_strict`).
- Rollback health check probes 127.0.0.1 with the domain as SNI; proxied addresses accept the temporary certificate.
- The on-demand internal certificate on the `https://` catch-all is only allowed (Caddy `ask`) for a domain being checked.

## Requirements
- **FR-001** `webconfig.mjs`: keys `host`, `aliases`, `redirectHosts`, `proxiedHosts`, `access {proxy, allow}`,
  `proxyRanges`; unknown keys refused; Caddyfile with `skip_install_trust`, `on_demand_tls ask`, per-host fallback
  issuers, `header_up X-Duniya-Client-IP {client_ip}` + `X-Duniya-Origin-Scheme {scheme}`, `http://` and `https://`
  catch-alls answering only the reachability path; env `CHECK_STRICT` / `CHECK_PROXIED`.
- **FR-002** Helper checks every served address on 127.0.0.1 (`-k` only for proxied ones), rolls back otherwise.
- **FR-003** App: `/.well-known/duniya-check/<token>` + `/.well-known/duniya-check-ask` (local Caddy only); reachability
  via https then http with redirect following; Flexible detection.
- **FR-004** API (owner): `GET /api/web`, `POST /api/web/check`, `POST /api/web/preview`, `POST /api/web/domain`,
  `/domain/confirm`, `/domain/finish`, `/domain/cancel`, `PUT /api/web/access`, `/access/confirm`, `/access/undo`,
  `POST /api/web/ranges/refresh`.
- **FR-005** Daily range refresh for the applied provider; a change re-applies (not during a trial).
- **FR-006** Client IP for the app: `X-Duniya-Client-IP` set by Caddy wins over client-supplied headers.

## Success Criteria
- A proxied domain is set up without uploads and without the panel ever being unreachable; tests in
  `test/web-access.test.js` cover validation, generation (also with real Caddy when installed), helper apply/rollback,
  reachability (proxy, Flexible), the switch steps, the trial + automatic undo, range downloads and recovery.
