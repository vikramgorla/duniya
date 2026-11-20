# 092 · Promises across People, language detection for non-Latin scripts, cost per feature

Issue #211 (owner-approved, one minor release).

## User stories
- As the owner, I see every promise people made across my agents in **People → Promises** (open, overdue, done, all;
  by person, agent, chat), open the person or the message it came from, and mark it done, reopen it, change its due
  date, edit or delete it. My assistant and the admin MCP do the same; an agent's organizers do it for its chats from
  the chat, and anyone can mark their own promise done.
- As a person who writes Telugu, Hindi, Tamil, Arabic, Russian, Chinese … (or Telugu / Hindi in Latin letters), agents
  answer me the way I write.
- As the owner, Usage shows what each feature costs (answers light / strong, judged messages, promises, summaries,
  voice, sending, surveys, the AI helper, my assistant …), one line each.

## Acceptance
- The Promises tab shows when an agent tracks promises. Open: overdue first, then by due date, undated last. Rows link
  to the person, the chat and the message. Reopening or a new due date allows the reminder again. Delete asks first
  (panel) and needs confirm_action (admin MCP). Admins only in the panel; viewers cannot change.
- Agent tools `promises__list_promises` / `promises__update_promise` only for agents with Track promises; organizers:
  the agent's chats; others: their own, mark done only (decided in code).
- Language: Unicode script ranges in code (no dependency); romanized Telugu / Hindi by a word list; ≥ 3 recent messages
  and a clear majority before a language is learned or changed; mixed-script messages go to the person's majority, else
  their script; owner-set language never overwritten; the sender card tells agents to answer in Latin letters when
  the person does. Each message counted once.
- Every model call is tagged with a feature at its call site (`usageTag`); an unknown feature fails; stored with the
  usage row; Usage → Cost per feature (replaces the Kind tab); admin MCP `get_usage` includes `features`.
- check-perf: 5,000 promises and features in the fixture; budgets for the list and the feature report.
