# Feature Specification: Custom domain and IP allow-list

**Feature Branch**: `feat/i4-infra-signin` | **Created**: 2026-11-15 | **Status**: Implemented | **Issue**: #9

**Input**: "Set a custom domain from the panel (HTTPS certificate automatic), and an allow-list of client IPs for the
panel/origin — with a one-tap 'Only Cloudflare' preset that keeps Cloudflare's published IP ranges up to date.
Applied through the root maintenance helper — no SSH. Safe rollback if the domain does not resolve."

## User Scenarios & Testing

### Story 1 — Own domain (P1)
Settings → Web address & access. The owner types `agents.example.org` and taps **Check DNS**. If it does not point
here, the card shows the exact record (`A agents.example.org → 141.147.1.2`) with copy buttons. When it does (or goes
through Cloudflare), **Use this domain** asks for confirmation and applies it; the card shows "Getting the HTTPS
certificate…" (survives reloads) and then "Live at https://agents.example.org". The old address forwards to the new.

**Acceptance**
1. Apply is refused (nothing changes) while DNS is missing/wrong.
2. If HTTPS does not come up within 4 minutes, the previous Caddyfile is restored automatically and the card says so.
3. On success PUBLIC_URL (app.env and the running app), DUNIYA_EXPOSURE and install.conf are updated; re-running the
   installer keeps the domain and the access rules.

### Story 2 — Only Cloudflare (P1)
One tap on **Only Cloudflare** + **Apply access**: only Cloudflare's edge may connect (origin lock-down). The ranges
come from https://www.cloudflare.com/ips-v4 and /ips-v6, refreshed daily; a change re-applies the web server.
Behind Cloudflare the real visitor address is used (`TRUST_PROXY=cloudflare`; on Caddy ≥ 2.7 also
`trusted_proxies` + `client_ip`).

### Story 3 — Own list (P2)
**Only my list** with IPs/CIDRs; "Always allow my current address" is on by default. A list that would shut out the
person applying, or Only Cloudflare while not using the panel through Cloudflare, needs an explicit confirmation.

### Story 4 — Locked out (P1)
`sudo duniya open-access` removes every restriction (keeps the address).

### Edge cases
- Tunnel / local-only / Docker installs: the card explains where the address is set instead (no form).
- Old servers without the new helper: "re-run the installer once".
- Caddy 2.6 (Ubuntu 24.04/Debian 12 packages) has no `client_ip`/`trusted_proxies`: Only Cloudflare uses `remote_ip`;
  Only Cloudflare **plus** an own list is refused with a clear message.
- A broken Cloudflare download is refused; the built-in list is used until a good one arrives.

## Requirements
- **FR-001** Pure, dependency-free `deploy/ops/webconfig.mjs`: domain regex (labels, letter TLD, no IPs), CIDR parser
  (canonical output), unknown keys refused, Caddyfile renderer, env values; CLI `render`.
- **FR-002** install.sh installs a root-owned copy to `/usr/local/lib/duniya-ops/webconfig.mjs`; the helper only ever
  executes that copy (never app-writable code) with a clean environment.
- **FR-003** Helper action `apply-web-config`: copy the request (≤ 64 KB) out of the app's directory, validate +
  render, `caddy validate`, back up the current Caddyfile, reload, wait for `https://<host>/healthz` (local resolve),
  roll back on failure, keep `Caddyfile.last-good` and `web-applied.json`, update app.env/install.conf, write
  `web-status.json` (sanitised message).
- **FR-004** App: `GET /api/web`, `POST /api/web/check`, `POST /api/web/preview`, `PUT /api/web`,
  `POST /api/web/cloudflare/refresh` — owner only; changes logged.
- **FR-005** Panel shows current address, certificate (issuer, days left / problem), access state, your IP (and whether
  through Cloudflare), progress and last result.
- **FR-006** CLI `open-access`.

## Success Criteria
- Domain switch and allow-list without SSH; a wrong domain never leaves the panel unreachable.
- Tests: `test/web-access.test.js` (validation, generation, Caddy acceptance when installed, helper apply/rollback with
  stubs, API, CLI recovery).
