# Tasks

- [X] T001 `releases.json` with honest entries (2.0.0, 2.5.0, 2.7.0, 2.9.0)
- [X] T002 `src/core/releases.js`: normalize, analyze (major bump / marked / safe target), notes, CI rule, git read
- [X] T003 `updates.js`: status with breaking/steps/safeTarget (recomputed after restart), backup → update phases,
  `keepPreUpdate` setting
- [X] T004 Backups: local pre-update backups with their own retention
- [X] T005 `update-decision.js`: once-per-version notice (Activity, alert number, linked owners with codes), snooze /
  dismiss, WhatsApp confirm (owner assistant handler), report after restart, scheduler (auto installs safe target only)
- [X] T006 Routes: decision in `GET /api/updates`, apply `{ breaking, backup }` + 409, `POST /api/updates/decision`
- [X] T007 Panel: Overview banner, Updates card, confirmation dialog, keep-N setting; responsive states
- [X] T008 Admin MCP (`apply_update` breaking/backup, `snooze_update_decision`), CLI `--breaking`, weekly summary
- [X] T009 Release workflow (title prefix, notes from releases.json, `--generate-notes`), CI check
- [X] T010 Tests `test/breaking-updates.test.js` (temp git repos, fakes)
- [X] T011 AGENTS.md Definition of Done, PR template, Spec Kit templates (both copies)
- [X] T012 Docs: backups-and-updates, upgrading, owner-assistant, admin-mcp, cli, README, website line
- [X] T013 Version 2.9.0 (`package.json`, `package-lock.json`, `infra/oci/schema.yaml`) + releases.json entry
- [X] T014 `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`
- [ ] T015 PR via REST (`Closes #57`), squash-merge after checks; issue done comment (left to the maintainer)

## Follow-ups

- Constitution text (Releases bullet) could mention `releases.json`; AGENTS.md already does (amend via
  `/speckit-constitution`).
- Site screenshots of the new banner (`npm run site:shots`) were not retaken: the website shots do not show a pending
  breaking release.
