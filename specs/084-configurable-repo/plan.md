# 084 · Plan

- **Config:** `package.json` `repository` — the standard field, read already for the version; no new file.
  `src/core/repo.js` (pure): `parseRepo`, `repoLinks` (url, git, pages, image, blob), `sameRepo`. `config.js` exposes
  `PKG`, `APP_VERSION`, `REPO` (replacing five separate "read the version from package.json" copies).
- **Panel:** `<meta name="duniya-repo">` in the shell (assets.js); `docsUrl()` / `repoFile()` in shared.js.
- **Update source:** `updateSource()` / `setUpdateSource()` in updates.js (git via execFile arrays, raw
  `remote.origin.url`, credentials stripped, `fetch --force --prune --prune-tags`, revert on failure);
  `GET /api/updates` → `source`, `PUT /api/updates/source` (owner); Settings → Updates block; CLI `source`; root wrapper
  writes `install.conf` REPO only for a plain GitHub https URL.
- **Installer:** `DEFAULT_REPO` (synced) ← install.conf ← existing checkout's source ← `DUNIYA_REPO` ← `--repo`;
  validated; remote switched on re-run when it changes.
- **Sync & drift:** `scripts/repo-sync.mjs` (`findDrift` used by ci-checks); check-doc-links derives its pattern.
- **Workflows:** `fork-setup.yml` (pinned actions, `permissions: {}` + job-level contents/pull-requests write);
  release.yml lowercase image + OCI labels + `duniya.zip`; ci.yml image tag.
- **MCP:** `toolHints(t)` + `toolTitle(name)` in admin-tools.js, tool flags `openWorld`, `destructive`, `idempotent`
  where the HTTP method does not tell; `confirm_action` derived the same way.
- **Small servers:** no new timers, no new work at runtime except one local `git config` read per Updates screen.
- **Tests:** repo.test.js (parsing, links, sync in a temp git repo, drift), updates.test.js (source, with git
  `insteadOf` fakes), admin-mcp.test.js (hints), env-secrets.test.js, helper-self-update.test.js (no built-in repo).
