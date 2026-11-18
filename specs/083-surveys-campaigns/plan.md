# 083 · Plan

| Concern | Decision |
|---|---|
| Surveys | `src/modules/surveys/index.js` (tables, save with the answered-kind guard, invite/link base, byToken, answer/skip/openFor, results/CSV, person section, sender-card line), `tools.js` (3 tools) |
| Frame | `moduleCard(person)` (people-access `senderCard`), catalogue entry `surveys` with person refs |
| Sending | `snd_run_surveys`; preview validates the survey and the link base, samples show `…/s/…`; the step invites each person; `drop` option (campaign rules) next to `visible` (agent scope) |
| Campaigns | `src/modules/sending/campaigns.js`: preview (validates steps, events for rules; drops its trial run), start, control, `campaignsTick` before the send step on the same tick |
| Server | `form: true` routes: urlencoded body as URLSearchParams, Origin host must match |
| Panel API | `/api/surveys…`, `/api/surveys/:id/csv`, `/s/:token` (public), `/api/sending/campaigns…`; `/api/sending` lists campaigns |
| Panel | `surveys.js` (list, editor, results), sending.js: shared audience form, survey picker, New campaign, campaign page; People nav Surveys |
| Admin MCP | list_surveys, get_survey_results, save_survey, delete_survey*, start_campaign*, get_campaign, control_campaign; send_to_people takes survey |
| Indexes | srv_people PK (tenant, survey, person) + token (unique) + person (tenant, person, done_at); srv_answers PK (tenant, survey, person, q) + person; snd_campaigns_status. Measured at 4k invitations / 12k answers: srv_answers PK 664 KB + _person 404 KB; srv_people PK 208 KB + _token 336 KB + _person 144 KB (about 1.75 MB of indexes) |
| Perf | fixture: 5 surveys, 4,000 invited, 12,000 answers; 5 campaigns; budgets: survey results 90 ms, campaign page 15, link page 10 (measured 34 / 1.3 / 0.8). Orders of one event pinned to `ord_orders_event` (statistics after PRAGMA optimize made the planner pick the created-at index) |
| Small servers | modules load when on; no timers (campaigns on the sending tick, ≤ 10 per tick); bounded queries |
| Panel budget | first screen unchanged; total +4.3 KB (206 300) |
| Migrations | none (new tables) |
| Dependencies | none |
