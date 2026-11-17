# Tasks: 064 UI polish, accessibility and phone feel

- [x] T001 Audit every screen (375 / 393 / 1440, light / dark, `DEMO_EMPTY`, `DEMO_SMALL`); prioritised findings in the issue's plan comment
- [x] T002 One token set in `styles.css`; overridden rules deleted; pills in sentence case; `plural()` everywhere a count is shown
- [x] T003 Phone tab bar + More sheet; skip link; screen title; `aria-current`; focus after navigation
- [x] T004 Skeletons, enter animation, reduced motion; error toasts; Undo for chat on/off and pause all
- [x] T005 Avatars; Overview control list with live pulses from the event stream; activity labels and names; empty states
- [x] T006 Chats rows with *More settings* in place; Agents cards
- [x] T007 `ask()` dialog; all `confirm()` / `prompt()` replaced; `check:panel` rule; dialog states in `check:responsive`
- [x] T008 Accessible names (fields, switches, selects), `fieldError()` inline validation; contrast fixes
- [x] T009 Automated accessibility in `check:responsive` (names from the accessibility tree, AA contrast)
- [x] T010 `page.css` / `page.js`, `PAGE_CSP`; result page, Google help, GitHub hand-off, MCP callback without `'unsafe-inline'`; test
- [x] T011 Carry-over: T104/T105 ticked in `specs/063-maintainability/tasks.md`

## Definition of Done

- [x] T100 Docs: `DESIGN.md` (tokens, pills, avatars, confirmations, accessibility, checklist), `docs/phone.md`, `docs/development.md`
- [x] T101 Website: screenshots and tour video retaken (`npm run site:shots`), checked
- [x] T102 Version 2.25.0 in three files
- [x] T103 `releases.json` entry
- [x] T104 `npm test`, lint, typecheck, `check:panel`, `check:responsive`, `ci-checks.mjs`
- [x] T105 PR via REST, required checks green, squash merge
- [x] T106 Issue done comment and close with the release
