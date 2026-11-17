# Implementation Plan: 063 maintainability

**Issue**: #127 · **Spec**: [spec.md](spec.md) · **Version**: 2.24.0 (minor: no breaking change, owners need do nothing)

## Approach

- **Split** (`src/panel/public/`): `index.html` shell; `app/styles.css`; `app/main.js` (entry: listeners, sign-in);
  `app/core.js` (`h`, `api` + cache, `S`, shell, router with a `SCREENS` map of `import()` loaders, live stream,
  `openFind`); `app/login.js`; `app/shared.js` (helpers several screens use); one module per screen and part. Mutable
  state other modules wrote (`modelsCache`, `overviewBusy`, `dmPrefill`) moved into `S`. `diff.js` became an ES module
  (dead `diffKeys` / `sideText` removed). The first status no longer draws Overview under another screen.
- **Serving** (`src/panel/assets.js`, `module-graph.js`): content-hash URLs, an import map from plain paths to hashed
  URLs (its sha256 in the shell's CSP), `modulepreload` for the static closure of `main.js` + `overview.js`.
- **One round trip less**: `/api/session?status=1` returns the status (`statusFor()` from `routes/status.js`).
- **Checks**: `scripts/check-panel.mjs` links all modules with `node:vm` (`--experimental-vm-modules`), checks names
  used through `import()`, and enforces brotli budgets (first screen 47 KB, total 147 KB); ESLint browser config for
  the modules; knip entry `app/main.js`; jscpd covers `public/`. `scripts/measure-load.mjs` (`npm run measure:load`).
  Dev scripts reach panel functions with `await import('/app/core.js')` (`PANEL` in `demo-panel.mjs`).
- **Types**: `tsconfig.json` (checkJs off, `// @ts-check` opt-in, `allowJs`, `noEmit`), `npm run typecheck`, step 7 of
  `ci-checks.mjs`. `db.prepare()` rows typed as plain rows, `Settings` typedef, `Route` / `RouteContext` typedefs,
  JSDoc on core functions with destructured options.
- **Server**: inline routes to `routes/auth.js` (with `bootstrapAuth`), `status.js`, `agents.js`, `chats.js`,
  `contacts.js`, `system.js`; `requestUser` → `http.js`, `personView` → `core/member-tags.js`; `fail()` in
  `core/config.js` replaces local copies and hand-written errors (codemod; files with their own `fail` keep it).
- **Tests**: `--test-concurrency=4`; backup tests wait for the next second instead of 1.1 s; tests that read panel
  source read the modules; new tests for the import map, CSP hash, preload set and the session status.

## Constitution check

Experience first (VIII): no visible change, faster first screen. Least privilege (III) and security: stricter CSP; the
status rides on the session only for a signed-in user. Small servers (VI): files are compressed once at start (~26
small files instead of one); no timers. Lean (IX): replaced code deleted (inline script, `PANEL_BUDGET`, local error
helpers, dead diff helpers, globals the dev scripts poked).

## Definition of Done

| Item | This change |
|------|-------------|
| Issue & labels | #127, type: improvement, area: panel / build, priority: high, status: in progress, spec: 063 |
| Tests (fakes) | `panel-snappy` (import map, content hashes, CSP hash, preload set, session status), updated `responsive`, `ai-diff`, `chat-fallback-editor`, `helper-self-update`, `global-mcp` |
| Checks | `npm test`, `npm run lint`, `npm run typecheck`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs` |
| Security | CSP without `'unsafe-inline'` for scripts; no new input handling; CodeQL |
| Privacy | the shell and modules hold no user data; status only after sign-in |
| Small servers | in-memory compressed files as before; no new timers |
| Admin MCP | n/a: no new panel function (same routes, same role gates) |
| Docs | `docs/development.md` (panel modules, panel server, type checking), `docs/architecture.md`, AGENTS.md map and DoD, DESIGN.md, templates, PR template, CONTRIBUTING, copilot-instructions, constitution 1.4.4 |
| Website | n/a: no visible change (screens compared before/after) |
| Version | 2.24.0 in three files; `releases.json` entry |
