# Feature Specification: Lean cleanup and a snappier panel

**Feature**: 058-lean-cleanup · **Issue**: #115 · **Release**: v2.19.1 · **Status**: implemented

## Goal

Owner request: "I am the only user and on the latest version. I want everything clean: no old-version/upgrade
leftovers, super efficient code base without bloat, duplicate or dead code; UI must be super snappy." One cleanup
release; behaviour for the owner does not change except being faster.

## User stories

1. **No leftovers (P1)** — Code that only served older versions is gone: `ALTER TABLE` guards (columns live in
   `CREATE TABLE`), the 057 `wa_name` migration, the pre-2.17 `media.local.smallServer` switch, bare Claude model ids
   (`claude-…` without an account), the quiet drop of the old agent `plugins` field. A fresh install still works.
   Kept: `releases.json` and the breaking-release machinery (product behaviour).
2. **No dead or duplicate code (P1)** — knip finds no unused files, exports or dependencies (root and mobile); jscpd
   finds no clone of 8+ lines; small helpers exist once.
3. **Guardrails (P1)** — CI (`node scripts/ci-checks.mjs`, quality job; no new required check) fails on knip or jscpd
   findings and when `src/panel/public/index.html` grows past its budget (size at 058 + ~10 %), with a clear message.
   The mobile workflow runs knip.
4. **Snappy panel (P1)** — The shell (`index.html`) and its scripts are served from memory, brotli/gzip compressed
   once at startup, with an ETag (repeat load = 304) and versioned, immutable script links; no user data is inlined.
   The status arrives over `/api/events` (after changes and with the 25 s keep-alive) instead of a 5 s poll; a 30 s
   poll runs only while the stream is down. Screen data is cached in the page and dropped on any change or live event;
   Overview switches update at once.
5. **Rules (P2)** — AGENTS.md Definition of Done gets *Lean code* items; constitution 1.4.3; Spec Kit templates (both
   copies); `docs/development.md#lean-code`.

## Acceptance

- `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs` pass.
- `test/panel-snappy.test.js`: compression, headers, 304, versioned scripts, status push after a change and after a
  channel state change, no 5 s poll in the panel.
- An agent model that is not `auto` or `account:model` is refused (`test/platform.test.js`).
- Before/after numbers (demo panel + headless Chrome) are in the PR.

## Out of scope

Splitting the one-file panel, frameworks, new runtime dependencies.
