# Data Model: Model Providers

| Item | Storage | Shape |
|---|---|---|
| Anthropic key | secret `ANTHROPIC_API_KEY` | string |
| OpenAI key | secret `OPENAI_API_KEY` | string |
| Compatible providers | setting `providers` | `[{ id: "^[a-z][a-z0-9-]{1,30}$", name, baseUrl (http/https), keySecret? }]` key in secret `PROVIDER_<ID>_KEY` |
| ChatGPT host id | setting `siwcHostId` | `urn:uuid:…` |
| ChatGPT credentials | secret `CHATGPT_CREDENTIALS` (encrypted JSON) | `{ client_id, ext_agent_host_id, email, issuer, subject, id_token, access_token, refresh_token, token_type, expires_at, scopes[], saved_at }` |
| Defaults | settings `defaultModel`, `backgroundModel` | `"auto"` or `provider:model` |
| Model ref | bot.config.model | `auto` \| `anthropic:<id>` \| `openai:<id>` \| `chatgpt:<slug>` \| `<compatibleId>:<id>`; bare `claude-*` = `anthropic:` |

Provider ids reserved: `anthropic`, `openai`, `chatgpt`, `auto`, `local`, `memory`.
