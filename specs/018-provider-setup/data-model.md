# Data Model: 018

## Settings `providers[]` (compatible endpoints)

| Field | Type | Note |
| --- | --- | --- |
| id | string | `openrouter` for the preset |
| name | string | "OpenRouter" |
| baseUrl | string | `https://openrouter.ai/api/v1` (env `OPENROUTER_API_BASE` in tests) |
| freeOnly | boolean | new; default `true` for the preset; kept when the endpoint is re-saved |

## Secrets

| Name | Content |
| --- | --- |
| `PROVIDER_OPENROUTER_KEY` | OpenRouter key (`sk-or-…`) |
| `COPILOT_GITHUB_TOKEN` | fine-grained PAT (`github_pat_…`) or OAuth user token (`gho_`/`ghu_`) |

## Provider status row (`GET /api/providers`)

Existing fields plus: `freeOnly` (compatible), and for `copilot`: `account` (GitHub login),
`quota: { kind, unlimited, used, total, remainingPercent, resetDate }`.

## In-memory (Copilot bridge)

`conversations: Map<toolCallId, Conversation>`; Conversation = SDK session, pending tool calls
(`{ name, input, resolve, answered }`), accumulated text/usage; closed on idle, error, disconnect or 5 min abandon.
