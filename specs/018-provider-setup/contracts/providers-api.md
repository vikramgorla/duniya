# Contracts: 018 provider setup API

All bodies JSON; errors `{ error, field? }`.

## POST /api/providers/openrouter (admin)

Body `{ key?: string, freeOnly?: boolean }`. Key required the first time. → provider status row
`{ id: 'openrouter', connected, models, freeOnly, baseUrl, error? }`.

## POST /api/providers/compatible/:id/free-only (admin)

Body `{ on: boolean }` → saved endpoint `{ id, name, baseUrl, freeOnly }`; 404 when unknown.

## POST /api/providers/copilot (owner)

Body `{ token }`. 400 for classic/malformed tokens or when GitHub rejects it (token not kept).
→ status row `{ id: 'copilot', connected, models, account?, quota? }`.

## DELETE /api/providers/copilot (owner)

Removes the token and stops the runtime → `{ ok: true }`.

## POST /api/providers/:id/test (admin)

Body `{ model?: string }` (default: the provider's Auto pick for background work). Sends system "You are checking a
connection…" and user "Say hi", max 60 tokens.
→ 200 `{ ok: true, model: 'provider:model', reply, ms }` or 200 `{ ok: false, error, ms }`;
404 unknown provider; 400 not connected. Recorded in activity.

## Adapter contract (src/core/providers/copilot.js)

`configured()`, `listModels() → [{ id, label, multiplier? }]`, `quota()`, `account()`, `checkToken(t)`,
`chat({ model, system, messages, tools, maxTokens }) → { content, stop_reason: 'tool_use'|'end_turn', usage }`,
`setClientFactory(fn|null)` (tests), `stopClient()`, `disconnect()`.
