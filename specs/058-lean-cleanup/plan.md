# Implementation Plan: 058 lean cleanup

**Issue**: #115 · **Spec**: [spec.md](spec.md) · **Version**: 2.19.1 (patch: no feature, no breaking change)

## Approach

- **Leftovers**: fold columns into `CREATE TABLE` in `chat-prefs.js`, `usage.js`, `contacts.js`; `smallServerMode()`
  reads only `smallServerMode`; `parseRef` returns null for refs without an account, `validateAgentConfig` refuses
  them (shared `REF_RE`, also used by chat prefs and model defaults); `plugins` is an unknown field.
- **Dead code**: knip (`knip.json`, entries: bin, scripts, tests, deploy/ops, speech worker, panel scripts); every
  finding checked with grep (tests import modules dynamically) before un-exporting or deleting. Mobile: own
  `mobile/knip.json` (expo-router app dir + tests), `expo-crypto` removed.
- **Duplication**: `summarize()` in memory.js; `addLocal()` in tools.js; `serveFakeMcp` / `fakeNumbers` in the test
  harness; `clip`, `bad`, `plural`, `iso`, `isGroup` in `config.js`; `MAIN` / `chatKey` / `splitChat` in
  `direct-chats.js`; `bareJid` shared by contacts and member tags. `admin-tools.js` keeps a local `iso`: it is
  imported statically by tests and must not load `config.js` (data dir) early.
- **Guardrails**: `knip` and `jscpd` devDependencies, `.jscpd.json` (8 lines, 0.5 % threshold), steps in
  `scripts/ci-checks.mjs`, `PANEL_BUDGET = 430000`.
- **Panel**: `staticFile()` in `http.js`; SSE route pushes `event: status` (debounced 250 ms on `activity` and
  `status` bus events, always with the keep-alive); `whatsapp.js` emits `status` on every state change (QR, pairing
  code); git version asked once. Client: `applyStatus`, SSE `status` listener, 30 s fallback poll only while the
  stream errors, `api()` screen cache (allow-listed GET paths, 60 s, structuredClone, dropped on non-GET calls, uploads,
  streams, activity, changed status), `optimistic()` for Overview switches, `renderUpdates` ignores stale answers,
  stream closed on `pagehide` (a cached page must not hold a connection) and reopened on `pageshow`.

## Definition of Done

| Item | This change |
|------|-------------|
| Issue & labels | #115, type: chore, area: panel / build / docs, priority: medium, status: in progress, spec: 058 |
| Tests (fakes) | `test/panel-snappy.test.js` (new); platform, local-small-server, names-tags, harness helpers updated |
| Checks | `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs` |
| Security | CSP, X-Frame-Options, nosniff kept on the shell; nothing inlined; `execFile` with fixed args in ci-checks |
| Privacy | unchanged: the status stream carries what `/api/status` already returns to the same signed-in user |
| Small servers | ~0.5 MB for the compressed copies; compression ~0.1 s once at startup; fewer requests (no 5 s poll, git asked once) |
| Lean code | this change |
| Admin MCP | n/a (no new panel function) |
| Docs | `docs/development.md` (Lean code), `docs/architecture.md`, `docs/models.md`, `DESIGN.md`, AGENTS.md, PR template, copilot instructions |
| Website | n/a: no visible UI change, no new screen to shoot |
| Version | 2.19.1 in `package.json`, `package-lock.json`, `infra/oci/schema.yaml` |
| Releases | `releases.json` 2.19.1, not breaking |
