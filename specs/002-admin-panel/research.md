# Research: Admin Panel

## Framework

- **Decision**: `node:http` + hand-rolled router; single static HTML file with vanilla JS.
- **Rationale**: ~15 routes; zero build; minimal RAM; easy to audit.
- **Alternatives**: Express/Fastify (dependency for little gain), React/Vite (build pipeline, bigger surface).

## Live updates

- **Decision**: Server-Sent Events (`/api/events`) with 25 s keep-alive comments.
- **Rationale**: one-way stream is all we need; works through Cloudflare Tunnel; auto-reconnect in browsers.
- **Alternatives**: WebSockets (bidirectional not needed), polling (latency/cost).

## Authentication

- **Decision**: single admin password; scrypt hash in `admin.json` once changed in the panel (bootstrap from
  `ADMIN_PASSWORD` env); random 256-bit session token in an HttpOnly, SameSite=Strict, Secure-when-HTTPS cookie;
  sessions in memory (a restart logs out); 5 failed logins per IP per minute (`CF-Connecting-IP` aware).
- **CSRF**: SameSite=Strict + mutations must be `application/json` (cross-site forms cannot send that without
  CORS preflight, which we never allow).
- **Defense in depth**: put Cloudflare Access (email OTP) in front of the hostname.

## Rendering untrusted text

- **Decision**: build DOM with a tiny `h()` helper that only uses `textContent`; CSP blocks external scripts,
  frames and form targets.

## Updating code from the panel

- **Decision**: `deploy/update.sh` fast-forwards to `origin/<branch>`, runs `npm ci` only if the lockfile changed,
  then the process exits and systemd restarts it.
- **Rationale**: no inbound SSH needed; no infra change; data dir untouched.
