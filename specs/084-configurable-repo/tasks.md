# 084 · Tasks

- [x] T1 Issue #190 (labels, spec: 084), plan comment, branch
- [x] T2 repo.js, config.js PKG/APP_VERSION/REPO; remove duplicate version readers
- [x] T3 Runtime links from REPO (panel meta, release notes, MCP client, admin MCP info); #189 names and texts
- [x] T4 Update source: core, routes, Settings → Updates, CLI, root wrapper, admin tool; helper without built-in repo
- [x] T5 Installer / GCP / OCI: DUNIYA_REPO, --repo owner/name, validation, source kept on re-run
- [x] T6 repo-sync + drift check in ci-checks; check-doc-links derived; workflows (fork setup, release, CI)
- [x] T7 MCP hints and titles; server description, website, icon
- [x] T8 LICENSE, package license, Docker image; SECURITY.md env secrets
- [x] T9 Tests (repo, updates, admin-mcp, env-secrets, helper)
- [x] T10 Docs: CONTRIBUTING (contributing + Forking), development, install, upgrading, cli, backups-and-updates,
      admin-mcp, settings, README, AGENTS, PR template, website FAQ/footer; screenshot of Settings → Updates
- [x] T11 Version 2.46.0, releases.json; all checks; PR; merge; done comment

## Definition of Done
- [x] Small servers: no timers; one local git read per Updates load
- [x] Lean code: one slug; five version readers → one; DOCS literals → derived; helper's OFFICIAL_REPO removed
- [x] Security: strict validation, execFile arrays, credentials stripped, revert on failure, root never takes the repo from the app
- [x] Docs, website, screenshots, admin MCP
