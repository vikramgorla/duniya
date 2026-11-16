# Implementation Plan: 060 secret-free owner assistant

**Issue**: #121 · **Spec**: [spec.md](spec.md) · **Version**: 2.21.0 (minor: feature)

## Approach

- **Core** `src/core/one-time-links.js`: `createLink(kind, data)`, `peekLink`, `takeLink`, `dropLinks(kind, match)`
  on top of `ttl-store.js` (kinds `link:secret` 15 min, `link:signup` 48 h); `linkUrl(base, kind, token)`.
- **Routes** `src/panel/routes/links.js` (mounted from `server.js`, gets `invoke`): secret links (create, look, save
  through the existing secret / account-key routes as the signed-in user) and sign-up links (create for a user, look,
  set password + session). `POST /api/users` without a password → `createUser({ noPassword })` + link.
- **Backups**: `openBackup()` in `backup/index.js` (fetch + decrypt) shared by restore and `check`; the route falls
  back to `BACKUP_PASSPHRASE` and turns a failed open into the Backups page link.
- **Owner assistant**: `SECRET_ARGS` filter removed; `looksSecret()` guard at the top of `ask()`; `toolCtx` carries
  the surface (WhatsApp asks get the "saved" message); links appended to replies; `tellUser()` for the "saved" note.
- **Admin tools**: `set_secret`, `add_user`, `restore_backup` reworked; `send_signup_link` added; admin MCP
  instructions mention links.
- **Panel**: `#secret=` screen after sign-in (kept across a Google sign-in via `sessionStorage`), `#signup=` screen
  before sign-in, Users card (password optional → link shown with Copy; "Sign-up link" for users without a
  password), restore passphrase optional when one is stored. Responsive states for both screens.

## Definition of Done

| Item | This change |
|------|-------------|
| Issue & labels | #121, type: feature, area: security / whatsapp / panel / tools-mcp / backups, priority: high, status: in progress, spec: 060 |
| Tests (fakes) | `test/secretless-links.test.js` (new); `owner-assistant`, `admin-mcp` updated |
| Checks | `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs` |
| Security | tokens 256-bit, hashed at rest, fragment only, single use, short expiry; secret page needs a panel session (admin+); sign-up rate limited; values never returned or logged; restore keeps preview + confirm |
| Privacy | pasted secrets never stored, logged or sent to a model; "saved" messages carry names only |
| Small servers | no timers (TTL store sweeps on write); restore check decrypts once in memory like a restore |
| Lean code | removed: secret-argument filter, `set_secret` value path, `add_user` password from tools, `restore_backup` passphrase arg |
| Admin MCP | `set_secret`, `add_user`, `send_signup_link`, `restore_backup`; `docs/admin-mcp.md` |
| Docs | owner-assistant, admin-mcp, security, backups-and-updates, users page docs; README highlight; website line |
| Version | 2.21.0 in `package.json`, `package-lock.json`, `infra/oci/schema.yaml`; `releases.json` entry |
