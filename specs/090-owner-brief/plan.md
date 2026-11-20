# 090 · Plan

- `src/core/brief.js`: settings, `briefTime`, `briefData`, `briefText`, `registerBriefSection`, suggestions table and
  `refreshSuggestions` / `currentSuggestions` / `setSuggestionStatus`, `briefDue`, `catchUpMaterial`.
- `src/core/owner-assistant.js`: `runMorningBrief` (codes per suggested tool action), `previewBrief`, core tools
  `catch_up`, `list_suggestions`; confirmed suggestions marked done. `src/core/scheduler.js`: one call per tick.
- `src/modules/events`: `cameButNotRegistered`, `dutyHistory` and the tools `compare_events`, `duty_history`.
- `src/core/people.js`: indexes `people_birthday` (partial, expression) and `people_created`.
- Panel: `app/owner-brief.js` (Suggested card, Morning brief block), chats.js catch-up, overview slot, settings slot;
  routes in `routes/owner-assistant.js`. Admin MCP: six tools.
- Small servers: no timers (scheduler tick); the brief is built in code; suggestions refresh at most every 5 minutes
  when Overview asks; catch-up only on demand.
