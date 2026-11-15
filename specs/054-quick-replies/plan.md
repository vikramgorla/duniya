# Plan 054

- `src/core/quick.js` (new, pure): `normalizeText`, `fillPlaceholders`, `todayText`, `findQuickReply`, `helpText`,
  `faqScore` / `matchFaq`, `faqContext`, `builtinAnswer` (shared by the router and the test console).
- `src/core/welcome.js` (new): `welcome_seen` table, `welcomeOn`, `welcomeDecision`, `welcomeText`, `noteJoin`
  (collect + timer), `flush` (notice first, send with mentions, record, usage, activity), `flushWelcomes` (tests).
- `src/core/schema.js`: defaults and validation for `quickReplies`, `help`, `welcome`, `faq`.
- `src/core/chat-prefs.js`: `welcome` column (`inherit | on | off`). `src/panel/server.js`: chats list/prefs carry it;
  test route answers built-ins first and returns `path`.
- `src/core/router.js`: built-in answers after role/addressed and before `not_addressed`; `deliver(..., { textOnly })`;
  `createJoinHandler`. `src/core/runner.js`: `faqContext` in the system prompt.
- `src/channels/whatsapp.js`: `group-participants.update` → `onJoin`; `send(..., { mentions })`.
  `src/channels/registry.js`: `onJoin` with app chat ids. `src/index.js`: wires `createJoinHandler`.
- `src/core/ai-builder.js`: editable fields + guide. `src/panel/admin-tools.js`: `set_agent_quick_answers`,
  `set_chat_settings.welcome`, `test_agent` path.
- Panel: `quickAnswersEditor()` fieldset (rows, previews, strictness seg), Chats "Welcome new members" select, test
  console path line, AI review labels/lists; CSS `.qa-*`. Mobile: types and AI review labels.
- Templates, demo data (carpool FAQ + welcome), `check-responsive` states `agent-editor-quick`,
  `agent-editor-quick-test`, `site-shots` cards `card-quick`, `card-quick-test`.
- Docs: agents (new section), privacy, admin-mcp, architecture + diagram, README tile text, docs index, website.
- No new dependencies. Small servers: pure string matching, one timer per group with pending joins, a tiny table.
- Constitution check: chats that are off get nothing (II/allow-list); permissions in code (`who`); privacy (hashes,
  counts only in logs). No violations.
