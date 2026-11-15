# Implementation Plan: Custom domain and IP allow-list

**Branch**: `feat/i4-infra-signin` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Summary
- `deploy/ops/webconfig.mjs` — single source of validation + Caddyfile generation (app imports it; root runs its
  installed copy).
- `deploy/ops/duniya-ops` — new action `apply-web-config` with backup, validate, reload, HTTPS wait, rollback.
- `src/core/webaccess.js` — settings `webAccess`, DNS check, certificate probe (TLS to 127.0.0.1:443 with SNI),
  request building with lock-out checks, daily Cloudflare refresh, sync of PUBLIC_URL/TRUST_PROXY from the helper's
  result, `openAccess()` for the CLI.
- `src/core/system.js` — `OPS_ACTIONS['apply-web-config']`, `requestOp(…, { files })`.
- `src/panel/routes/web.js` + card `webAccessCard` in `index.html`.
- install.sh — root copy of webconfig.mjs, `DUNIYA_EXPOSURE` in app.env, keeps access rules on re-runs.

## Technical Context
Node 22 ESM (`node:net`, `node:tls`, `node:dns`), no new dependencies. Data: settings `webAccess`
`{ cloudflareOnly, allow[], alwaysAllowMine, cf: { v4[], v6[], at }, lastRequest }`; helper state
`/var/lib/duniya-ops/{web-status.json, web-applied.json, Caddyfile.prev, Caddyfile.last-good}`.

## Constitution Check
| Principle | Check | Status |
|---|---|---|
| V. Observable | applies, Cloudflare updates and recovery logged; helper log in Server → Maintenance output | PASS |
| VI. Minimal attack surface | no new ports; allow-list and origin lock-down reduce exposure | PASS |
| VII. Tests | pure tests, helper tests with stubbed tools, API tests with fake DNS/Cloudflare | PASS |
| VIII. Experience first | DNS record with copy buttons, progress that survives reloads, automatic rollback, recovery command | PASS |
| Security | app never injects config: strict re-validation by a root-owned copy, canonical regeneration, unknown keys refused, size limit, sanitised status text | PASS |

## Complexity Tracking
| Item | Why |
|---|---|
| Two Caddy code paths (2.6 vs ≥ 2.7) | distro packages are 2.6.2; refusing the one combination 2.6 cannot do safely is simpler than upgrading Caddy in place |
