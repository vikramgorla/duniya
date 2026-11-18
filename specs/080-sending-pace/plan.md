# 080 · Plan

| Concern | Decision |
|---|---|
| Where | `src/core/pace.js` (settings, presets, validation, read queue, typing, daily cap, warm-up, sending hours, list estimate); `routes/pace.js`; Settings → Sending pace in `settings.js` |
| Router | `queueRead(msg)` for chats that are on (after the allow-list); `drainReads` on every incoming message; a turn starts `readWhenDue` → typing while the model runs; `deliver()` calls `paceReply` (read, then typing for the reply's length) |
| Upkeep | `drainReads` on the existing tick (bounded: 20 chats per drain), also while memory is tight (tiny) |
| Channels | capability `readReceipts` (WhatsApp true, Telegram false); hub `markRead` (existing chat action) |
| Warm-up | WhatsApp session notes `paceLinkedAt:<number>` when a QR scan or pairing code opens the connection |
| Daily cap | kv `paceNew:<number>` = `date|count` (owner time zone); `takeNewChat` in `sendIntro` |
| Shared helper | `localParts(tz, at)` moved from the scheduler to `config.js` (scheduler and pace use it) |
| Tests | `PACE_TIME_SCALE` scales every wait (harness 0; the pace test 0.01); the harness switches read receipts off for older tests |
| Small servers | no timers, a 500-entry array (< 100 KB), no new tables or queries (kv only); `check:perf` unchanged |
| Panel budget | +1.3 KB total (Sending pace card) |
| Dependencies | none |
| Migrations | none added or removed |
