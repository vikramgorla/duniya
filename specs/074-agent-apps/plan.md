# 074 · Plan

## Approach

- `src/core/providers/apps.js`: install on demand, the slot limiter, memory checks, residents, RSS sampling
  (`/proc/<pid>/status` of the app's process tree, read when the app writes), the generic turn (`AppTurn`) that holds
  the app's tool calls until the runner answers them, `appsTick()` for upkeep.
- `src/core/providers/app-bridge.js`: a minimal MCP server (Streamable HTTP, JSON answers: initialize, tools/list,
  tools/call, ping) on 127.0.0.1, listening only while a turn is open; Bearer token per turn.
- `claude-code.js`, `codex.js`: launch arguments, stream parsing, errors; Codex device sign-in (parse the link and code
  from `codex login --device-auth`), account from its ID token; models: Claude Code aliases, Codex `debug models`.
- `copilot.js`: SDK downloaded with the shared installer into `DATA_DIR/apps/copilot`; its idle timer replaced by the
  resident rule; each conversation takes a slot; `heavyCheck` removed.
- Routes `/api/providers/claudecode`, `/api/providers/codex/start|signin`, owner only; Getting started recognises
  `sk-ant-oat01-` tokens.

## Checked against the real apps (no account, a local stand-in model)

Claude Code 2.1.326 and Codex 0.169.0 were run against a fake Anthropic / Responses endpoint and this bridge: both
called Duniya's tool through MCP and finished the turn (Codex also in its code mode for GPT-6 models, where tools are
called from its JS isolate). Seen: Claude Code sends only our tool (plus its deferred-tool placeholder); Codex without
the catalog change hides MCP tools behind tool search and offers apply_patch and web search; MCP calls need
`default_tools_approval_mode="approve"`. Error shapes: 401 → result `Failed to authenticate…`, rate limit → result
text, plan limit → `rate_limit_event` rejected with `resetsAt`.

## Measured (this sandbox, Linux x64, 2 vCPU)

| App | Peak RSS while answering | Start → first request | npm download peak | Disk |
|---|---|---|---|---|
| Claude Code 2.1.326 | 196–203 MB | ~0.5 s (whole tiny turn 0.65 s) | 277 MB | 355 MB |
| Codex 0.169.0 | 138–145 MB | ~0.2 s (whole turn 0.4–0.6 s) | 354 MB | 404 MB |
| Copilot SDK 1.0.34 runtime | 59–60 MB idle | start 28 ms | 293 MB | 217 MB |

## Not checked (needs real subscriptions)

Real model latency and RSS with long conversations; Claude Code with a real `setup-token` token; Codex's device
sign-in end to end and the ChatGPT backend accepting a replaced base prompt; real usage-limit messages; Copilot turns
on a 1 GB VM.

## Constitution / DoD notes

No new runtime dependency (apps are downloaded on demand, like the Copilot SDK before). No new timers: per-call step
and wait timeouts like `runJob`; idle and abandoned work through the upkeep tick.
