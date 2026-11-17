# 070 · Plan

- **Search:** SQLite FTS5 (in `node:sqlite`) external-content table `messages_fts` on `messages.text`, triggers for
  insert/update/delete; built once when the table is new. `searchStored()` in `db.js` is the one search (FTS words
  as `"word"*`, optional sender filter); `/api/search/messages` (owner) limits to `visibleChats()` (on, not private).
  Panel: Find anything gets a *Search messages* row and a results mode (no new screen); `highlight()` marks words
  with text nodes. A hit sets `S.msgSearch` and opens the chat page, which opens Messages filtered.
- **Review:** `src/core/review.js`: `reply_ratings` (msg, agent, rating, by, ts), a partial index on agent replies,
  a delete trigger on `messages`. Routes `GET /api/agents/:id/review`, `PUT /api/agents/:id/review/:msg` (admin);
  the agent GET carries this week's counts. Panel: section `review` in the agent page; Teach = `changeWithAi(x,
  initial)`; the AI helper guide says how to turn a taught answer into a FAQ item or rule.
- **Backups:** `bundle.js` rewritten around streams (`writeBackup`, `checkBackup`, `stageRestore`); `index.js`
  passes paths (local, uploads) or the downloaded buffer (GitHub, S3).
- **Settings cache:** `store.js` with `PRAGMA data_version`; hot paths use `getSetting(key)`.
- **Usage by day:** `localDayKey()` builds `(ts + CASE …) / 86400000` from the offset changes in the range.
- **Chats list:** `compact()` drops defaults; the panel fills them in.
- **Consent page:** `pageHead()` + `PAGE_CSP` + `/page.js` (`data-bounce`).
- Small servers: no new timers; FTS adds ~15 % to the database file and ~9 % per stored message; backups no longer
  hold the database in memory.
- Constitution: privacy (off and private chats never searched or reviewed; counts only in logs), permissions in code
  (owner / admin route gates), lean code (one search, one settings reader).
