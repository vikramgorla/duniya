# 068 · Plan

- `listdetail.js`: an `end` slot (a switch next to the chevron, outside the link); pages may have sub-pages.
- `agents.js`: the list (`listDetail`), row lines, switch with Undo, *New agent* page (AI draft, template, import).
- `agent-editor.js`: `agentPage(id)`: header, `SECTIONS` (id, title, current value, builder returning `{ el, value }`),
  section pages with the one save model (`PUT /api/agents/:id` with only that section's fields; Undo = the previous
  values). The AI helper opens in the shared dialog (`ask()` with a body). Existing editors reused (tool services,
  fallback picker, cap editor, Ask card).
- `chats.js`: the list (`listDetail`, filters + search above), `chatPage(c)` with every chat setting; history polling
  only on the open page while loading.
- `find.js`: agent sections in Find anything; More sheet rows and account row; `askSignOut()` in `core.js`.
- `overview.js`, `quiet.js`, `ask.js`, `contacts.js`, `server.js`, `settings.js`: copy pass, calm line, compact rows.
- `styles.css`: opaque header; page anatomy classes (`ap-head`, `sblock`, `sec-save`, `help`); old chat/agent card
  rules removed.
- No server change: the API already accepts partial agent updates. No new timers, no polling added (the history watch
  that existed now runs only for the open chat).
- Docs: DESIGN.md *Screen anatomy*, agents.md (Agents/Chats screens), phone, owner assistant, getting started,
  models, small servers. Screenshots retaken.
