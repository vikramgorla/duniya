# Research: 018 Guided Provider Setup

## Links (verified 2026-11 by the owner's research)

| What | URL | Note |
| --- | --- | --- |
| Anthropic keys | https://platform.claude.com/settings/keys | key shown once; no free credits claimed |
| OpenAI keys | https://platform.openai.com/api-keys | no free credits claimed |
| OpenRouter keys | https://openrouter.ai/settings/keys | |
| OpenRouter free models | https://openrouter.ai/models?max_price=0 | free: 20 req/min, 50/day, 1000/day after ≥ $10 credit |
| GitHub signup | https://github.com/signup | |
| Fine-grained PAT, pre-filled | https://github.com/settings/personal-access-tokens/new?name=duniya&description=Copilot+for+duniya&expires_in=90&copilot_requests=write | docs disagree on read vs write for `copilot_requests`; UI tells the user to try the other level |

## GitHub Copilot SDK

Sources: https://docs.github.com/en/copilot/how-tos/copilot-sdk (landing; sub-pages auth, setup, features),
npm `@github/copilot-sdk` 1.0.34 (README in the package; repository `github/copilot-agent-runtime`, `src/sdk/nodejs`),
`https://www.npmjs.com/package/@github/copilot-sdk`.

- **Package**: `@github/copilot-sdk` (MIT), ESM + CJS, Node ≥ 22.12. Dependencies `zod`, `koffi` (prebuilt FFI, no
  toolchain), `vscode-jsonrpc`, `lossless-json`. The Copilot runtime ships in an optional per-platform package
  `@github/copilot-sdk-<platform>` (linux-x64 ≈ 199 MB on disk; linuxmusl and arm64 variants exist). No download at
  start.
- **Transport**: `new CopilotClient()` spawns the bundled `copilot-runtime` and speaks JSON-RPC over stdio
  (`RuntimeConnection.forStdio`, default). An experimental in-process FFI mode exists; not used.
- **Memory (measured here, linux-x64)**: runtime child RSS ≈ 48 MB right after start, ≈ 63 MB after a few RPCs;
  start ≈ 40 ms; our process +~5 MB for the SDK. Fits the 1 GB VM budget; the child is stopped after 10 min idle.
  Not measured: RSS during long real sessions (no Copilot account available in this environment).
- **Auth**: `gitHubToken` option (takes priority), `useLoggedInUser: false`. README: fine-grained PAT with "Copilot
  requests" permission or OAuth user token; classic PATs not supported.
- **Models**: `client.rpc.models.list({})` → `{ models: [{ id, name, capabilities, policy: { state }, billing:
  { multiplier } }] }` (also `client.listModels()`).
- **Quota**: `client.rpc.account.getQuota({})` → `{ quotaSnapshots: { <kind>: { isUnlimitedEntitlement,
  entitlementRequests, usedRequests, remainingPercentage, resetDate, … } } }`.
- **Login**: `client.getAuthStatus()` → `{ isAuthenticated, login, … }`.
- **Sessions**: `createSession({ model, systemMessage: { mode: 'replace', content }, tools, availableTools,
  onPermissionRequest, infiniteSessions, enableSessionStore, includedBuiltinAgents })`; `session.send({ prompt })`;
  events `assistant.message` (`content`, `toolRequests[]`), `assistant.usage` (`inputTokens`, `outputTokens`),
  `session.error`, `session.idle`; `session.disconnect()`, `client.deleteSession(id)`.
- **Custom tools (function calling)**: supported. `tools: [{ name, description, parameters: <JSON schema>, handler,
  skipPermission }]`; names must match `/^[a-zA-Z0-9_-]+$/`. Handlers may return a string or `{ textResultForLlm,
  resultType: 'failure' }`. Declaration-only tools + `session.tools.handlePendingToolCall` also exist.
- **Lock-down**: `mode: 'empty'` (multi-user server mode) requires `baseDirectory` and an explicit `availableTools` per
  session; `['custom:*']` exposes only our tools (no shell/file/web built-ins); `[]` for plain chat. Verified against
  the real runtime with a fake token: config accepted, failure only at GitHub authentication.
- **Not used**: `api.githubcopilot.com`, the unofficial "Copilot API" proxies, BYOK providers.

**Decision**: tools are supported, so Copilot is a full provider (not text-only). The stateless provider contract is
bridged to the stateful SDK session by holding tool handler promises between `chat()` calls (see plan).

**Alternatives**: text-only provider (rejected: tools work); declaration-only tools + pending RPC (equivalent, more
experimental API surface); spawning the CLI ourselves (rejected: the SDK owns it).
