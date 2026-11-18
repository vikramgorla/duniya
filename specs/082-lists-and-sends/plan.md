# 082 · Plan

| Concern | Decision |
|---|---|
| Module | `src/modules/sending/index.js` (runs, preview, start/pause/resume/stop, the tick step, stop/start intercept, person section, held start), `audience.js` (audiences → recipients, facts, fill), `tools.js` (3 agent tools). Catalogue entry with `snd_recipients.person` refs (merge, export, erase) |
| Frame | `moduleApi(id)` (Orders calls Sending), `interceptMessage(msg, channel)` (router, direct messages from people, before the agent) |
| Pace | `pace.js`: `sendingHoursNow`, `listGapMs`, `takeListSend`, `typeBefore`, `listEstimate` exported; no copy of the pace logic |
| Router | after `queueRead`: `interceptMessage` for direct messages with a person |
| Orders | reminder template, `autoReminders` / `setAutoReminders` (setting `orderReminders`), daily `autoRemind` in the existing daily upkeep; owner list mentions Send reminders |
| Panel API | `/api/sending`, `/api/sending/preview`, `/api/sending/runs/:id` (GET, PUT action), `/api/sending/runs/:id/start`, `/api/sending/filters`, `/api/order-reminders` |
| Panel | `sending.js` (history, New message + preview, run page with live updates via `S.onFeed`), People nav Sending, Orders → Send reminders, event ⋯ → Message registered people / Automatic payment reminders |
| Admin MCP | list_sends, get_send, send_to_people*, control_send, save_send_audience, set_payment_reminders*; set_module_enabled accepts sending |
| Indexes | snd_runs_status (tenant, status, next_at), snd_runs_created; snd_recipients_run (tenant, run, status, n), _person (tenant, person, at), _chat (tenant, chat, at). Measured at 60k recipients: _run 2.8 MB, _person 2.5 MB, _chat 3.3 MB (about 40–55 bytes per recipient per index); the table 8.2 MB |
| Perf | fixture: 30 runs × 2,000 recipients; budgets: run page 12 ms, history 15, event recipients 20 (measured 4.4 / 5.9 / 6.7) |
| Small servers | loads only when on; no timers (upkeep tick, one send in flight); queries bounded (5,000 recipients, 500 rows on a page, 50 runs) |
| Panel budget | first screen unchanged (62 600), total +5.3 KB (201 800) |
| Migrations | none (new tables via CREATE TABLE) |
| Dependencies | none |
