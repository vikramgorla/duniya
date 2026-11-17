# Tasks: 066 Phone readability and the Ask conversation

- [x] T001 Reproduce the owner's screenshots in the demo panel (393 px dark); root causes in the issue's plan comment
- [x] T002 Tab bar icon on lime uses `--signal-ink`; icon-contrast check (3:1, `::before` pills) in `check-responsive.mjs`
- [x] T003 Activity rows grouped by day, type marker, bold subject, muted meta, right-aligned time; compact filter; Overview recent activity shares them
- [x] T004 `toolPhrase()` in `names.js`; owner-assistant and WhatsApp status activity in plain words; tests updated
- [x] T005 `.btn svg` sizing; More sheet search row; sheets opened by touch focus themselves (More, `ask()`)
- [x] T006 Add a provider: named rows with marks and one line each; connected providers stay listed; Getting started link
- [x] T007 Sentence-case labels (eyebrow, th, legend, stack labels, pulse); Overview status chips
- [x] T008 Ask conversation: bubble, thinking, live tool chips (`calling` step), streaming markdown with caret, fold, Copy, follow-up, Retry, Stop
- [x] T009 Server-side Stop: AbortSignal through chat() and the streaming adapters; no further rounds/tools; partial kept; not a provider failure; test
- [x] T010 Owner assistant *Try it* uses the Ask card; responsive states for every Ask state
- [x] T011 Recovery: request deadlines, Retry card, sheet import guard, resume after >30 s (`recover()`), stream reconnect when it was closed on `pagehide`
- [x] T013 Navigation races: placeholder timer only before the first draw; an older screen drawn during a newer one's load triggers a redraw; status redraw only on a finished Overview; `nav-stress` state run in CI
- [x] T012 Pull to refresh (`pull.js`) and More → Refresh; responsive states `load-failed`, `load-retry` (hung request → Retry → screen), `pull-refresh`

## Definition of Done

- [x] T100 Docs: `DESIGN.md` (on-accent rule, labels, activity rows, Ask, focus, checklist), `docs/owner-assistant.md`, `docs/models.md`, `docs/phone.md`, README, website
- [x] T101 Website screenshots retaken (`npm run site:shots`) and checked
- [x] T102 Version bumped in three files (minor: the Ask conversation is a feature)
- [x] T103 `releases.json` entry
- [x] T104 `npm test`, lint, typecheck, `check:panel`, `check:responsive`, `ci-checks.mjs`
- [x] T105 PR via REST, required checks green, squash merge
- [x] T106 Issue done comment and close with the release
