# Quickstart: Model Providers

## Automated

`npm test` → `test/providers.test.js`: OpenAI-compatible provider with tool calls + confirm gate; auto resolution and
background model; ChatGPT flow end-to-end against fake auth/JWKS/models/responses servers (PKCE, state, nonce,
signature, scope check, paste-back, refresh, SSE function calls, usage-limit error); secrets never returned.

## Manual

1. Panel → Models → paste Anthropic key → models listed. Set default model.
2. Add OpenRouter: id `openrouter`, base `https://openrouter.ai/api/v1`, key → models listed; set a bot to one.
3. Sign in with ChatGPT → open link → allow plan usage → copy the failed-page address → paste → plan models listed.
4. Bot test console: ask a tool-using question on each provider; Activity shows provider/model and tokens.
