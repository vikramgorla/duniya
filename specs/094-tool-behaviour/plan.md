# 094 · Plan

- `src/core/autonomy.js`: `riskOf(annotations, input, override)` (read | change | destructive), generic `changeTools`
  (sibling confirm tool), `mayChangeWithoutAsking(ctx, risk, mode)`; the table, words and preview-name rule deleted.
- `src/core/tool-behaviour.js` (new): `behaviourOf(agent, key, srv)` (agent override → service default → defaults;
  changes → agent autonomy), `servicesNote` (one line per service, 900-character budget), `limitStop` (per reply in the
  turn; per day one kv row per agent and service, overwritten; DMs only); Activity `limit`.
- `src/core/sharing.js` (new): media tool detection (readOnlyHint + media output + free-text input; results seen before
  remembered in kv), moments and serious words, mood words without names, `share_media` tool, `[share: …]` tags, the
  after-reply decision and `shareMedia` (search, pick unseen, post with credit, log, duplicate guard).
- `schema.js`: `behaviour` on a service (kept only when it differs), `services` on an agent; `risk` removed.
- `tools.js`: per-service behaviour and overrides in tool meta (remote and built-in), sharing services, `share_media`,
  `describeTools` / `agentServices` / `serviceMedia` for the panel (5-second limit). `mcp.js`: structured results.
- Runner: instructions (services + sharing), risk per call, limits before a call, held changes get the call's risk and
  the service's mode, sharing plan / tag / after-reply. Router posts the shared media after the text.
- Built-in tools annotated (events, orders, sending, surveys, people, memory, promises, pictures, WhatsApp actions).
- Panel: `behaviourEditor` (Settings → Tool services and the agent's Tools page), Risk column in the tool grid, shared
  `seg`; routes `/api/agents/:id/services`, discovery with risks, `media` on global services. Budget +2.4 KB.
- No new dependencies, timers or tables; one MCP search per shared GIF; no extra model call.
