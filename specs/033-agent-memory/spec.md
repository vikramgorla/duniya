# Spec 033 — Memory for every agent (issue #8)

## Goal
Every agent can save, find, update and forget facts when people ask ("remember that…", "what did we save about…"),
beyond the rolling summary — per chat, plus memory shared by the agent across all its chats.

## Decisions
- Memory stays **on by default** for every agent (switch: agent page → "Group memory").
- Two scopes: **chat** notes (one chat) and **agent** notes (stored as `agent:<id>`, shown in every chat of the agent
  as `<agent_memory>`, fenced as information).
- **Only organizers write shared notes** — otherwise someone in one chat could plant facts or instructions that the
  agent repeats in another chat. Participants can save chat notes, list and find notes.
- Tools: `memory__remember {text, scope}`, `list_notes`, `find_notes {query}`, `update_note {id,text}` (organizers),
  `forget {id}` (organizers), `search_history`. Update/forget only touch notes of the current chat or the agent's
  shared notes.
- Panel: agent page "Shared memory" lists and deletes shared notes; admin MCP `get_agent_memory`.

## Acceptance
- Shared note saved by an organizer in chat A is listed and in context in chat B; a participant's attempt is refused.
- A chat note is invisible from another chat and cannot be deleted from it.
- Tests: `test/agent-memory.test.js`.
