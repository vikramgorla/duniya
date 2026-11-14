# Implementation Plan: Multi-Bot WhatsApp Agent Platform

**Branch**: `001-multi-bot-platform` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-multi-bot-platform/spec.md`

## Summary

One Node.js service links to WhatsApp as a companion device (Baileys), routes each message to the bot bound
to that chat, and runs a Claude tool-use loop whose tools come from the bot's MCP servers (filtered per role)
and the bot's own JavaScript hooks. Writes go through a confirm gate that keeps MCP `confirm_id`s server-side.
Bots are folders under `bots/`; panduga.ch is the first one.

## Technical Context

**Language/Version**: Node.js 22 LTS (ES modules)

**Primary Dependencies**: `baileys` 7 (WhatsApp Web multi-device), `@anthropic-ai/sdk` (Messages API tool
use), `@modelcontextprotocol/sdk` (Streamable HTTP client), `pino` (Baileys logger)

**Storage**: built-in `node:sqlite` (messages, activity, pending confirmations, kv); JSON files in the data
directory for live bot settings, secrets and global settings; Baileys multi-file auth state

**Testing**: `node:test` end-to-end with a fake MCP server (MCP SDK server), a scripted fake Anthropic API
(`ANTHROPIC_BASE_URL`), and a fake channel

**Target Platform**: Linux server (Ubuntu 24.04 on OCI E2.1.Micro, x86_64; A1 Arm also supported)

**Project Type**: long-running service (single process) with embedded admin panel (feature 002)

**Performance Goals**: reply within 15 s p95 (dominated by model latency); tens of messages per minute

**Constraints**: < 400 MB RSS; no native module builds; outbound network only

**Scale/Scope**: 1 WhatsApp number, a handful of bots, < 20 groups, < 500 members total

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Self-hosted channels | Baileys linked device; no paid connector; reply-only-when-addressed + rate limit | PASS |
| II. Generic core, bots as plugins | Core has no bot names; bots = `bots/<id>/{bot.json,prompt.md,index.js}`; channel interface | PASS |
| III. Least privilege in code | `tools.js` builds per-role tool list from globs; runtime refuses unknown names; per-role MCP tokens | PASS |
| IV. Human confirmation | Confirm tool always denied to model; `confirm_id` replaced in tool result; single-use, expiring codes | PASS |
| V. Observable/controllable | `activity()` for every step; pause flag checked by router and scheduler | PASS |
| VI. Free tier, as code | ~180 MB RSS measured; `node:sqlite` avoids native builds | PASS |
| VII. Spec-driven, tested | This spec set; e2e tests with fakes in `test/` | PASS |

Post-design re-check: PASS (no violations).

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-bot-platform/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── bot-definition.md
│   └── channel-interface.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── index.js              # wiring: load bots, channel, router, scheduler, panel
├── channels/
│   └── whatsapp.js       # Baileys connection, normalisation, QR/pairing, reconnect
└── core/
    ├── config.js         # env, data dir, secrets, ${VAR} interpolation, settings
    ├── db.js             # node:sqlite tables + queries
    ├── events.js         # activity log + event bus
    ├── bots.js           # load bots/, live overrides, validation, chat binding, roles
    ├── tools.js          # per-role tool lists (MCP + local), glob matching
    ├── mcp.js            # MCP connection pool (url+token)
    ├── agent.js          # Claude tool-use loop, confirm gate
    ├── router.js         # routing, triggers, DMs, rate limit, hooks
    └── scheduler.js      # daily/weekday schedules
bots/
├── panduga/              # first bot
└── _template/            # copy to create a bot (ignored)
test/
└── platform.test.js
```

**Structure Decision**: single project; `core` is channel- and bot-agnostic, `channels` adapts transports,
`bots` holds all bot-specific content.

## Complexity Tracking

No violations.
