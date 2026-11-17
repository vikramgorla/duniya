# Plan 066

- **Panel** (`src/panel/public/app`):
  - `styles.css`: on-accent icon in the tab bar; `.btn svg` size; sentence-case labels; `.led` chips; feed rows; Ask
    conversation; `select.compact`.
  - `activity.js`: day groups; `feedList`, `feedPrepend` (SSE in `core.js`); `subjectOf()` drops the repeated type.
  - `overview.js`: status chips.
  - `ask.js`: conversation, `markdown()` as text nodes, Stop via `AbortController` (`apiStream(..., signal)`).
  - `find.js`: More sheet focus and a compact search row.
  - `core.js`: `ask()` focuses the dialog on touch.
  - `models.js`: Add a provider rows.
  - `names.js`: `toolPhrase(name, now)`.
  - `agent-editor.js`: *Try it* = `askCard`.
- **Server:**
  - `owner-assistant.js`: plain-word activity summaries (`toolPhrase`), a `calling` step before each tool, `signal` →
    stop between rounds and tools, and the partial text kept.
  - `routes/owner-assistant.js`: aborts on request close.
  - `providers/index.js`, `anthropic.js`, `openai-chat.js`, `chatgpt.js`: `signal` reaches the streaming fetch / SDK; an
    aborted call is not a provider failure.
  - `channels/whatsapp.js`: plain status words.
- **Recovery:** `core.js` (`deadline`, request timeouts and in-flight set, `loadFailed`, `recover`, the sheet import guard), `main.js` (resume), `pull.js`.
- **Checks:** icon contrast in `check-responsive.mjs`; Ask states (thinking, streaming, done, error, restarted, owner
  editor); panel budgets +3.5 KB for the conversation (reason in the PR).
- **Tests:**
  - `ask-stream.test.js`: Stop.
  - `owner-assistant.test.js` and `history-on-enable.test.js`: the new summaries.
  - Fake Claude streams can hang until the client stops them (`hang`).
- No new dependencies, timers or polling. A small server is unaffected (it is panel work plus one AbortController per
  Ask).
