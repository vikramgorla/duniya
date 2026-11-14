# Implementation Plan: Guided Provider Setup, OpenRouter Preset, GitHub Copilot

**Branch**: `feat/018-provider-setup` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

## Summary

Redesign Models as guided provider cards (DESIGN.md), add an OpenRouter preset with a free-only filter, a Test button
for every connected provider, and a GitHub Copilot provider built on the official Copilot SDK with a bridge from our
stateless Anthropic-block `chat()` to SDK sessions with custom tools.

## Technical Context

**Language/Version**: Node.js 22 LTS (ESM)

**Primary Dependencies**: new optional dependency `@github/copilot-sdk` 1.0.34 (pinned). Reason: the owner requires
Copilot via the official SDK only; there is no supported HTTP API. It is an `optionalDependency` and lazily imported,
so `npm ci --omit=optional` removes it (≈ 215 MB on disk) and the app still runs (Copilot shows "not installed").

**Storage**: settings `providers[]` entries gain `freeOnly`; secrets `PROVIDER_OPENROUTER_KEY`,
`COPILOT_GITHUB_TOKEN`; Copilot runtime state in `DATA_DIR/copilot` (0700).

**Testing**: fake OpenRouter HTTP server via `OPENROUTER_API_BASE`; Copilot via `setClientFactory(fake)` (no runtime,
no network).

**Constraints**: runtime child ≈ 60 MB RSS only while used (10 min idle stop); scrubbed env (PATH, HOME=data dir,
proxy/CA vars, `COPILOT_TELEMETRY_DISABLED=true`).

## Design

- `providers/index.js`: `addOpenRouter`, `setFreeOnly`, `isFreeModel`, `freeOnlyAdapter` (filters `listModels`,
  refuses non-free `chat` with code `free_only`), `copilot` provider entry, Copilot extras (account, quota) in
  `status()`, `testProvider(id, model)`.
- `providers/copilot.js`: lazy client (`mode: 'empty'`), `listModels`, `quota`, `account`, `checkToken`, `chat`
  bridge: a fresh call opens a session (system prompt `replace`, `availableTools: ['custom:*']` or `[]`, built-in
  sub-agents off, no session store/compaction) and sends the conversation as one prompt; tool handler calls are held
  and returned as `tool_use` blocks keyed by tool call id; a later call whose last user turn holds matching
  `tool_result`s resolves them and waits for the next step; idle → final text, session deleted; abandoned loops
  closed after 5 min. Errors mapped to plain messages (`copilot_limit`, auth hint).
- Routes: `POST /api/providers/openrouter`, `POST /api/providers/compatible/:id/free-only`,
  `POST|DELETE /api/providers/copilot` (owner), `POST /api/providers/:id/test`.
- `agent.js`: friendly messages for `free_only` and `copilot_limit`.
- UI: `renderModels()` rewritten: Start here, provider cards (`providerCard`, `keyForm`, `testBox`, `cue.*` drawings),
  Other endpoints (advanced, in `<details>`), Default models.

## Constitution Check

| Principle | Check | Status |
| --- | --- | --- |
| I Self-hosted channels | unaffected | ✅ |
| II Generic core | no bot-specific code | ✅ |
| III Least privilege | Copilot sessions get only the bot's allowed tools (`custom:*`), no built-ins; confirm tool never exposed | ✅ |
| IV Human confirmation | tool calls flow through the same agent loop and confirm gate | ✅ |
| V Observable | connect/disconnect/test and errors recorded in activity | ✅ |
| VI Free tier | runtime ≈ 60 MB only when used, idle stop; optional dep, no toolchain (koffi prebuilt) | ✅ (see tracking) |
| VII Spec + tests | this folder; `test/provider-setup.test.js` with fakes | ✅ |
| VIII Experience first | links straight to key pages, what to copy, drawings, Test button | ✅ |
| Security | tokens are secrets, never returned; Copilot owner-only; scrubbed child env; official SDK only | ✅ |

## Complexity Tracking

| Item | Why | Simpler alternative rejected |
| --- | --- | --- |
| New runtime dependency `@github/copilot-sdk` (+~215 MB disk) | owner requires the official SDK | none allowed; mitigated as optional + lazy import |
| Stateful bridge in a stateless adapter | SDK runs the tool loop itself | text-only Copilot (loses tools) |
