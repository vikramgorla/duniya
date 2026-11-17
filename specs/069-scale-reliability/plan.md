# 069 · Plan

- **Measure:** `scripts/measure-scale.mjs` (`npm run measure:scale`) on `test/harness.js` fakes; startup in a child
  process with `taskset -c 0` and `--max-old-space-size=700` (no cgroups in CI sandboxes).
- **DB (`src/core/db.js`):** pragmas (WAL + NORMAL, temp_store, 8 MB cache, journal_size_limit, auto_vacuum
  INCREMENTAL for new files); indexes `messages(chat, ts)`, `activity(ts)`, `activity(chat, id)`; random prunes removed
  from `logMessage`, `activity()`, `recordUsage`, `countStat`, `silenceReason`; `countBetween` before loading rows to
  summarize; one `Intl.DateTimeFormat` per time zone in `memory.js`.
- **Retention (`src/core/retention.js`, new):** settings `retention` { messagesDays, messagesPerChat, usageDays }
  (defaults from `MEMORY_RETENTION_DAYS`, `MEMORY_MAX_MESSAGES`, 400); `retentionTick()` on `upkeepTick`; batches of
  2 000 rows; `PRAGMA optimize`, incremental vacuum, weekly VACUUM when cheap; disk level via `statfsSync`; clock guard;
  `healthView()`; write pause flag in `db.js` (`writesPaused`, `diskFullError`).
- **Panel:** `GET /api/server/health`, `PUT /api/server/retention` (owner); Health card on Server; contacts
  `limit`/`offset`; `content-visibility` on feed rows; SSE frames serialized once per entry.
- **Reliability:** `whatsapp.js` retryLater (jitter, connect failures), `stop()`; registry `stop()`; router
  `closeRouter()`; `src/index.js` graceful shutdown + uncaughtException; `restartSoon()` in `config.js` replaces four
  `process.exit(0)` timers; `install.sh` unit `TimeoutStopSec=20`, `StartLimitIntervalSec=0`; upkeep reconnect alert;
  media queue full notice.
- **Backups:** names `duniya-YYYYMMDD-HHMMSS-mmm.dbk`; refuse when the disk is full.
- **CI:** `scripts/cdp.mjs` start retry; `T.click` waits; `release.yml` job `notes` → `scripts/release-notes.mjs --sync`.
- No new dependencies, no new timers (everything rides the 30 s upkeep tick), no schema migrations (indexes are
  `CREATE INDEX IF NOT EXISTS`).
