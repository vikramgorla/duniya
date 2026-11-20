# 092 · Plan

- `src/core/commitments.js`: `listCommitments` (overdue, chats, sort, names), `getCommitment`, `updateCommitment`
  (reopen / re-date clears the follow-up mark, `what` checked), `deleteCommitment`, `promiseTools`; index
  `commitments_agent`. Routes `GET/PUT/DELETE /api/commitments` (agent names); status `agents[].promises`.
- `src/core/tools.js`: `promises` tools for agents that track promises (roles in the tools).
- Panel `app/promises.js`: `renderPromises` (People → Promises), shared rows (agent section, person page, list) with
  Done / Reopen and ⋯; `people.js` nav tab and route; CSS `.pfilters`.
- `src/core/person-insights.js`: script table, romanized word lists, per-message language, majority with mixed
  messages, MIN_MESSAGES = 3, keep the current language when unclear; `languages` in prefs (panel list); messages
  counted once.
- `src/core/usage.js`: `FEATURES`, `usageTag`; `recordUsage({ feature })`; `groupBy=feature` with label and line.
  Call sites: runner (test / scheduled / judge / reply-light / reply-strong / reply, self-check), smart-model, lessons,
  commitments, memory, owner assistant, catch-up, ai-builder, media (transcribe / speech / image), sending (sending /
  surveys), provider test, built-in answers (faq / quick reply / welcome). Panel: Cost per feature card replaces Kind.
- Admin MCP: `list_commitments` (overdue), `update_commitment`, `delete_commitment` (risky), `get_usage` (+features).
- check-perf: fixture promises and features; budgets *promises list* 15 ms, *usage per feature* 25 ms; newest-first
  scan of All allowed (stops at LIMIT).
- No new dependency, no new timer; the language work rides the existing upkeep tick.
