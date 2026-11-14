# Research: Model Providers and Model Selection

## Claude subscription linking

- **Finding**: Anthropic's Claude Code legal page: Anthropic does not permit third-party developers to offer Claude.ai
  login or to route requests through Free/Pro/Max/Ultra plan credentials on behalf of users.
- **Decision**: Anthropic is supported via API key only. The panel says so where users might look for "Sign in with Claude".

## ChatGPT plan usage (Sign in with ChatGPT, open-source flow)

Source: developers.openai.com/siwc/token-sharing-open-source/*.

- Authorize: `https://auth.openai.com/api/accounts/authorize` with `client_id=dynamic_agent_client` (first time) or the
  issued `oaiapp_…` id, `agent_name_hint`, `ext_agent_host_id` (persistent per host, `urn:uuid:`), `response_type=code`,
  `redirect_uri` loopback `http://127.0.0.1:<port>/auth/callback` (not `localhost`), scope
  `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`,
  `state`, `nonce`, PKCE S256.
- Callback returns `code`, `state`, issued `client_id`, `scope`. Token: POST form to
  `https://auth.openai.com/api/accounts/oauth/token` (`authorization_code`, client_id, code, code_verifier,
  redirect_uri, resource). Refresh: `grant_type=refresh_token` (same endpoint); refresh tokens rotate (30 days).
- ID token: verify signature against OpenAI JWKS (discovered via `https://auth.openai.com/.well-known/openid-configuration`),
  `iss=https://auth.openai.com`, `aud=client_id`, `exp`, `nonce`. Require `chatgpt.tokens.use.direct` in granted scopes.
- Models: `GET https://api.openai.com/v1/models` with the access token → `models[]` with `visibility=="list"`, `slug`,
  `display_name`. Inference: `POST /v1/responses`, `store:false`, `stream:true`, system prompt in `instructions`, no
  `temperature`/`max_output_tokens`/`metadata`/etc.; function tools supported; usage-limit errors
  `subscription_sharing_usage_limit_exceeded` (429 or `response.failed`).
- Headless VMs: OpenAI's doc says sign in locally and transfer credentials. **Decision**: paste-back — the server
  generates the authorize URL (host id = this server), the owner's browser lands on the unreachable loopback URL, the
  owner pastes it; the server exchanges the code with the same redirect URI and PKCE verifier. No credentials leave
  the server and the host id is the VM's own.

## Adapter strategy

- **Decision**: keep Anthropic message blocks as the internal format; convert per provider.
- **Alternatives**: a provider-neutral SDK (Vercel AI SDK etc.) — extra dependency weight; conversion is small.

## Auto model

- **Decision**: `auto` → `settings.defaultModel` if available → Anthropic `claude-sonnet-5-5` if a key is set → error
  "choose a default model". Background: `settings.backgroundModel` → Anthropic `claude-haiku-5-5` → same as default.
