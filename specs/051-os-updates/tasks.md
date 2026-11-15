# Tasks

- [X] T001 Fixtures: owner's `apt upgrade` output, non-root and phased/held simulations, apt 3 layout, `apt-cache
      policy`, a full run log
- [X] T002 Parsers + grouping in `src/core/system.js`; `osUpdates()` groups and badge count
- [X] T003 Root helper: full-upgrade, autoremove, dpkg recovery, phased option, step markers, version line
- [X] T004 Run summary and restart status in `opsStatus()`; `os-update-all` gated by helper version
- [X] T005 `sudo duniya update` refreshes the root helper safely
- [X] T006 Server page: badge, restart banner, groups, result line, gradual button, old-helper note
- [X] T007 Weekly summary line after 7 days
- [X] T008 Admin MCP tools
- [X] T009 Tests (`test/os-updates.test.js`), shellcheck
- [X] T010 Demo panel states; `check:responsive` states `server-os-updates`, `server-old-helper`
- [X] T011 Docs: backups-and-updates, upgrading, admin-mcp, cli, owner-assistant; website text and screenshots
- [X] T012 Version 2.15.1 (package.json, package-lock.json, infra/oci/schema.yaml) + releases.json entry
- [X] T013 `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs`
- [ ] T014 PR via REST (`Closes #96`), squash-merge after checks (left to the maintainer)

## Follow-ups

- Verify on a real Ubuntu 24.04 server: that a non-root simulation ignores phasing (assumed from the owner's report)
  and that `apt-cache policy` shows `(phased N%)`; a server that is already inside a roll-out shows the package as
  *rolling out gradually* although `os-update` installs it.
- The site tour video was not re-recorded (the Server tab badge appears in new screenshots only).
