# 085 · Plan

- Panel formatting (`people.js`, loaded with People only, not the first screen): `money()`, `day()`, `phone()`;
  `moduleBlocks()` formats `{ day }` parts.
- Server: `money()` in `src/core/config.js` (Intl, `en`), used by events/orders tools, module rows, audience facts and the
  admin MCP payment preview; module rows (`events`, `orders`, `sending`) send day parts; `listRuns()` includes the
  survey a run carries (LEFT JOIN on the run's primary key: no scan).
- `events.js`: `sentBlock()` (Messages on an event's and a survey's page, from `/api/sending`, admin only, only when
  Lists and sending is on), `runPill()` shared with Sending; Overdue pill; attendance count; shorter header lines;
  CSV and Ways to pay behind ⋯ on Orders.
- `sending.js`: list grouped as Messages / Campaigns / Saved audiences with one short line; New message fields help
  behind a disclosure, rare options under *More options*; a message's page: the message quoted, people as rows.
- `surveys.js`: results as bars without hairlines, people as rows (finished first), Messages.
- `settings.js`: pace presets save at once; Updates settings as labelled fields that save on change; shorter texts.
- `channels.js`: Telegram's Replace token / Disconnect behind ⋯.
- CSS: quiet row ⋯, wrapping People switch, `.quote`, survey result bars (class names that do not collide).
- Demo seed: a past event with attendance, a message still sending (with the survey), a finished campaign step with
  nobody waiting.
- Budgets: first screen +0.25 KB (styles), total +2.3 KB (reasons in `check-panel.mjs`).

No new timers, polling, dependencies or tables.
