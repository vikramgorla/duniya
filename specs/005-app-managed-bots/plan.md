# Implementation Plan: Bots, Users and Secrets Managed in the App

**Branch**: `005-app-managed-bots` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-app-managed-bots/spec.md`

## Summary

Move bot definitions from `bots/<id>/` files into SQLite (`bots` table, JSON config validated by a schema
function), add `users`/`sessions` tables with roles, and encrypt secrets with AES-256-GCM using a key file in the
data directory. Repository `bots/` becomes `templates/*.json` (read-only starting points) and `plugins/<name>/`
(optional code). A one-time migration imports legacy bots. The panel gets a full bot editor (with tool discovery),
templates, import/export, users management and a first-run setup screen.

## Technical Context

**Language/Version**: Node.js 22 LTS

**Primary Dependencies**: none new (`node:crypto` for AES-256-GCM, scrypt, random tokens)

**Storage**: SQLite tables `tenants`, `users`, `sessions`, `bots`, `secrets`, `settings`; `DATA_DIR/master.key` (0600)

**Testing**: `node:test` e2e through the panel API (`test/app.test.js`) + existing suites updated

**Target Platform**: same

**Project Type**: service + embedded admin

**Performance Goals**: bot save → active < 1 s

**Constraints**: backwards-compatible migration; no secret plaintext on disk; tenant column everywhere new

**Scale/Scope**: ≤ 50 bots, ≤ 20 users per install

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| II. Generic core, bots as plugins | Bots become data; code plugins optional by name; core still bot-agnostic | PASS (strengthened) |
| III. Least privilege | Tool allow lists per role still enforced in code; panel discovery only helps choose | PASS |
| IV. Confirmation | Unchanged; confirm tool cannot be allowed for the model (validator strips it) | PASS |
| V. Observable/controllable | Activity records acting user for every change | PASS |
| Security | Encrypted secrets, hashed session tokens, roles, setup code, owner invariant | PASS |
| VII. Spec-driven, tested | This spec; new e2e tests | PASS |

Amendment needed: constitution II wording "each bot MUST live in its own folder under `bots/<id>/`" is superseded
→ constitution v1.1.0 (MINOR): bots are data records; templates/plugins are files.

## Project Structure

### Documentation (this feature)

```text
specs/005-app-managed-bots/
├── plan.md, research.md, data-model.md, quickstart.md, tasks.md
└── contracts/panel-api-005.md
```

### Source Code (repository root)

```text
src/core/
├── crypto.js        # NEW master key, encrypt/decrypt, password hashing, tokens
├── schema.js        # NEW bot config defaults + validation/normalisation
├── store.js         # NEW tenants/users/sessions/bots/secrets/settings repositories
├── bots.js          # runtime registry now backed by store; plugins; legacy migration
├── config.js        # secrets/settings now via store
└── ...
src/panel/server.js  # users/session auth, roles, bot CRUD/templates/import/export/discovery
src/panel/public/index.html  # setup screen, bot editor, users
templates/           # NEW: blank.json, event-assistant-panduga.json
plugins/example-dice/index.js  # NEW: moved from bots/_template/index.js
bots/                # REMOVED (legacy folders migrated at runtime if present in DATA/BOTS_DIR)
```

## Complexity Tracking

No violations.
