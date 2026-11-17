# 069 · Scalability and reliability

Issue #143. Goal: Duniya stays fast and dependable on a 1 GB / 1 vCPU server with many chats, agents and numbers and
months of history, and recovers from failures by itself — with no chores for the owner.

## User stories

1. **Measured, not guessed (P1).** A dev script seeds a large data directory (300 chats over 3 numbers, 30 agents,
   200k stored messages, 50k activity, 20k usage rows, 5k contacts) and measures startup on 1 CPU, RSS, panel API
   latencies, live-stream fan-out, router throughput, retention, a backup and the database size. Before/after numbers
   are in the issue and `docs/development.md#scale-measurements`.
2. **Fast writes (P1).** A message that is only stored costs no full-table scan and no fsync per write: WAL with
   `synchronous = NORMAL`, indexes for the real query patterns, no pruning on the hot path.
3. **Data stays small by itself (P1).** Old stored messages (days, per-chat cap), activity (Settings → Activity log),
   usage detail, why-quiet rows, daily counters, schedule markers and expired sessions/codes are pruned on the shared
   upkeep tick, at most hourly, in bounded batches. Summaries, notes, contacts and settings are never pruned. The
   database is kept compact (optimize, incremental vacuum; a full VACUUM only when cheap).
4. **Health on Server (P1).** One card: database size, how many rows of each kind since when and how long they are
   kept, the last clean-up, the photos & voice queue; a warning line when the disk is low or full, the clock jumped or
   the queue is full. The owner can change how long messages and usage detail are kept. Admin MCP: `get_server_health`,
   `set_retention` (confirm).
5. **Disk full (P1).** Low disk → the owner is told (daily). Almost full → stored messages and optional activity pause
   (errors and changes still recorded), backups refuse with a clear reason, agents keep answering; everything resumes
   by itself when space is back. An SQLite "disk full" error pauses the same way instead of crashing.
6. **Clock safety (P2).** A clock that jumps (wall vs monotonic time) or runs behind the newest activity never deletes
   history: pruning waits and Health says so.
7. **Recovers by itself (P1).** WhatsApp reconnects with backoff (2–60 s) and jitter, also when opening the session
   fails; a number down for 15 minutes is reported once. SIGTERM/restarts stop gracefully: no new turns, running turns
   get a few seconds, sockets close without unlinking, the database is checkpointed and closed. An uncaught exception
   exits with code 1 and systemd (`Restart=always`, no start limit) or Docker starts the app again. A full photos &
   voice queue tells the owner at most hourly (newest refused, waiting work kept).
8. **Backups never overwrite (P1 bug).** Backup names carry milliseconds; old names stay valid.
9. **Long lists (P2).** Contacts load 100 at a time from the server (Show more; search covers all); long Activity
   feeds skip drawing entries off screen.
10. **CI (P2).** Chrome launch retried when DevToolsActivePort never appears; screen clicks in checks wait for the
    element. GitHub Release pages get their title and notes from releases.json (idempotent, never creates tags).

## Acceptance

- Router throughput through the fakes at least 3× the v2.29.1 numbers; no `SCAN` in the activity chat filter or the
  age prunes (`EXPLAIN QUERY PLAN` in the script).
- Tests (fakes only): pruning by settings with summaries/notes kept, owner-only retention with validation, disk full →
  not stored / backups 507 / resumes, clock guard, contacts paging, two backups in one second, reconnect alert once,
  graceful shutdown, queue-full notice once, release-notes sync idempotent.
- `check:responsive` passes, including Health with a full disk.
