# Contract: Providers API (006)

| Method | Path | Role | Body | Response |
|---|---|---|---|---|
| GET | `/api/providers` | viewer | | `[{ id, type, name, connected, error?, models: n, account? }]` |
| POST | `/api/providers/compatible` | admin | `{ id, name, baseUrl, key? }` | provider |
| DELETE | `/api/providers/compatible/:id` | admin | | `{ ok }` |
| POST | `/api/providers/chatgpt/start` | owner | | `{ authorizeUrl, redirectUri, expiresIn }` |
| POST | `/api/providers/chatgpt/complete` | owner | `{ callbackUrl }` | `{ ok, email, models }` / 400 with reason |
| DELETE | `/api/providers/chatgpt` | owner | | `{ ok }` (revokes when possible, deletes credentials) |
| GET | `/api/models?refresh=1` | viewer | | `{ models: [{ ref, provider, label }], defaultModel, backgroundModel, resolvedDefault?, resolvedBackground?, problem? }` |
| POST | `/api/settings` | admin | `{ defaultModel?, backgroundModel? }` | settings |

Keys are set through `/api/secrets` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) or the compatible-provider form.

## Internal: `chat()`

```js
chat({ model: 'auto' | 'provider:model', purpose: 'bot' | 'background', system, messages, tools, maxTokens })
→ { content: [{type:'text',text} | {type:'tool_use',id,name,input}], stop_reason: 'end_turn'|'tool_use'|'max_tokens',
    usage: { input_tokens, output_tokens }, model: 'provider:model' }
```
