# Implementation Plan: Model Providers and Model Selection

**Branch**: `006-model-providers` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

## Summary

A provider layer (`src/core/providers/`) exposes one `chat()` call that takes and returns the Anthropic Messages
shape the agent already uses (text / tool_use / tool_result blocks). Adapters translate to OpenAI Chat Completions
(OpenAI key, compatible endpoints) and to the Responses API with SSE (ChatGPT plan). Models are referenced as
`provider:model`; `auto` resolves via settings. The ChatGPT connection implements OpenAI's open-source plan-usage
contract with a paste-back completion step for headless servers.

## Technical Context

**Language/Version**: Node.js 22 LTS

**Primary Dependencies**: `@anthropic-ai/sdk` (Anthropic); OpenAI endpoints via `fetch` (no new deps);
`node:crypto` for PKCE and RS256 JWT verification (JWK import)

**Storage**: settings `providers` (compatible list), `defaultModel`, `backgroundModel`, `siwcHostId`; secrets
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PROVIDER_<ID>_KEY`, `CHATGPT_CREDENTIALS` (JSON, encrypted)

**Testing**: fake OpenAI server (chat completions, models, responses SSE) and fake OpenAI auth server (token, OIDC
discovery, JWKS signed with a test RSA key) via `OPENAI_API_BASE` / `OPENAI_AUTH_BASE` overrides

**Constraints**: endpoints overridable only by env (tests); credentials never logged; provider failures isolated

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Self-hosted, no commercial connectors | Model providers are the operator's own accounts; no gateway required | PASS |
| III/IV. Least privilege, confirmation | Tool filtering and confirm gate happen before/after the provider call, unchanged | PASS |
| V. Observable | Activity records provider/model/usage | PASS |
| Security | Keys/tokens encrypted; PKCE/state/nonce/JWT validation; Claude subscription OAuth not used (terms) | PASS |
| VII. Tested | Same agent scenarios run against fake Anthropic and fake OpenAI | PASS |

## Project Structure

```text
src/core/providers/
├── index.js        # registry, model listing/cache, resolveModel, chat()
├── anthropic.js    # Messages API
├── openai-chat.js  # Chat Completions adapter (OpenAI key + compatible)
├── chatgpt.js      # Sign in with ChatGPT: connect, refresh, Responses SSE adapter
└── jwt.js          # RS256 ID-token verification via OIDC discovery + JWKS
src/core/agent.js, src/core/memory.js   # call providers.chat()
src/panel/server.js (extend)            # /api/providers, /api/models, chatgpt start/complete
test/providers.test.js
```

## Complexity Tracking

No violations.
