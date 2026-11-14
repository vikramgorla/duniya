# Implementation Plan: Admin Panel

**Branch**: `002-admin-panel` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-admin-panel/spec.md`

## Summary

An HTTP server inside the same Node process (no framework) serves a single-file vanilla-JS UI and a small JSON
API. Live activity is pushed with Server-Sent Events from the in-process event bus. Auth is a scrypt-hashed
password with in-memory sessions. It binds to 127.0.0.1 and is exposed only through the Cloudflare Tunnel
(feature 003).

## Technical Context

**Language/Version**: Node.js 22 LTS

**Primary Dependencies**: `node:http`, `node:crypto` (scrypt), `qrcode` (QR → data URL); no frontend build

**Storage**: reuses feature 001 storage; `DATA_DIR/admin.json` (password hash), `settings.json`, `secrets.json`

**Testing**: `node:test` HTTP tests against the real panel with a fake channel

**Target Platform**: same server; any modern mobile/desktop browser

**Project Type**: embedded web admin (server-rendered static page + JSON API)

**Performance Goals**: activity visible < 2 s; page usable on 3G

**Constraints**: no extra process, no build step, < 20 MB extra RSS, strict CSP

**Scale/Scope**: 1 admin, ~7 views

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| II. Generic core | Panel lists whatever bots exist; no bot-specific UI | PASS |
| III/IV. Least privilege, confirmation | Panel apply uses the same `applyPending`; MCP config not editable from panel | PASS |
| V. Observable/controllable | Live activity, pause, per-bot toggles, chat binding | PASS |
| VI. Free tier/as code | In-process; binds localhost; tunnel exposure | PASS |
| Security constraints | scrypt, HttpOnly SameSite=Strict cookie, login rate limit, JSON-only mutations, CSP, textContent rendering, write-only secrets | PASS |
| VII. Tested | panel test in `test/platform.test.js` | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/002-admin-panel/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/panel-api.md
└── tasks.md
```

### Source Code (repository root)

```text
src/panel/
├── server.js          # routes, auth, SSE, update/restart
└── public/index.html  # single-file UI (vanilla JS, CSS variables, light/dark)
deploy/update.sh       # git fast-forward + npm ci when lockfile changed
```

**Structure Decision**: panel lives in the service process to avoid IPC and extra memory.

## Complexity Tracking

No violations.
