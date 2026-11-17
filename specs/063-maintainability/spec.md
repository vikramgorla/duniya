# Feature Specification: 063 maintainability — panel as ES modules, type checking, panel routes, faster tests

**Issue**: #127 · **Status**: implemented · **Version**: 2.24.0

## Why

The panel was one 4,240-line file (`src/panel/public/index.html`, 419 KB, at 419 of its 430 KB budget): every screen's
code was downloaded and parsed before Overview appeared, every change touched the same file, and the budget blocked new
UI work. Its CSP needed `script-src 'unsafe-inline'`. `src/panel/server.js` held ~110 inline routes (800 lines) next to
13 route modules; the error shape `Object.assign(new Error(m), { status })` was written by hand 182 times with seven
local `bad`/`fail` copies. Nothing checked types. `npm test` ran one file at a time (77 s) although every file has its
own process, data dir and ports.

## User stories

1. **Faster panel, same panel** — an owner sees exactly the screens they saw before; Overview appears sooner on a slow
   connection (less to download, one round trip less), a new release re-downloads only the files that changed, and
   other screens load on their first visit (then come from the browser's cache).
2. **Stricter page security** — the panel page runs only scripts from the server itself: the one inline script (the
   import map) is allowed by its hash, never `'unsafe-inline'`.
3. **Easier to change** — a contributor edits the module of the screen they work on; `npm run check:panel` fails when a
   module imports a name another module does not export, and on budgets for the first screen and the whole panel.
4. **Types where they pay off** — `npm run typecheck` (tsc over files starting with `// @ts-check`) runs in CI.
5. **Panel routes by area** — `server.js` is the router; routes live in `routes/<area>.js`; errors with a status use one
   helper.
6. **Quick feedback** — `npm test` runs test files in parallel; `npm run measure:load` reports first-load numbers.

## Requirements

- R1 No framework, bundler or build step; plain native ES modules, edited and reloaded as they are.
- R2 Served from memory, brotli/gzip, ETag/304; module URLs carry their content hash and are cached for a year; the shell
  stays `no-cache`. The shell holds no user data.
- R3 CSP of the panel page: `script-src 'self' 'sha256-<import map>'`; no inline handlers; untrusted text only through
  `textContent` (unchanged `h()`).
- R4 First screen (shell, styles, entry, Overview and their static imports) preloaded; budgets enforced in CI.
- R5 Sign-in answers with the status when asked (`GET /api/session?status=1`), only for a signed-in user.
- R6 Owner-visible behaviour unchanged (every screen, deep link, keyboard shortcut, live update); responsive check green.
- R7 No new runtime dependency; `typescript` is a dev dependency only.

## Out of scope

Visual changes (round 3), JSDoc for the browser modules, typing the remaining server files (they opt in when touched).
