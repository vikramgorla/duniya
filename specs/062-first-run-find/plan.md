# Implementation Plan: 062 guided first run and Find anything

**Issue**: #125 · **Spec**: [spec.md](spec.md) · **Version**: 2.23.0 (minor: features, nothing breaking)

## Approach

- **Server**: `routes/insights.js` builds the steps (new order, built-in excluded, skips, the inline agent);
  `server.js` gets one `afterSwitch()` used by the prefs route and the new `enable` option of `/api/chats/bind`.
- **Panel** (`index.html`, one file, no dependency): `drawChecklist()` renders the next step's body from
  `stepBody()` (`linkNumberBox`, `quickProviderBox`, `quickAgentBox` reusing `aiHelper({ bare })`, `quickChatBox`,
  `quickTestBox`); `refreshChecklist()` redraws Overview when the first-run shape changes (headline, Ask, number card).
  `openPalette()` + `paletteItems()` + `paletteScore()` (word starts first); `SETTINGS_SECTIONS` feeds the Settings
  index and Find; `jumpToSub()` after every render; `drawNav()` redraws tabs only when the set changes (Pending);
  `MOVED` maps old addresses; `secretsCard()` replaces `renderSecrets()`.
- **Demo**: `startEmpty()` in `scripts/demo-panel.mjs`.

## Constitution check

Experience first (VIII): the first run happens on one screen, every step says what to do; no chores (progress is
derived, WhatsApp linking advances by itself). Least privilege (III): unchanged; the Find box lists only what the
user's role can open. Lean (IX): replaced code deleted (old checklist renderer, Secrets tab, two-call switch-on, the
2.22.0 cleanup).

## Definition of Done

| Item | This change |
|------|-------------|
| Issue & labels | #125, type: improvement, area: panel / docs, priority: high, status: in progress, spec: 062 |
| Tests (fakes) | `insights` (order, built-in excluded, skip/unskip, owner-assistant replies ignored, bind + enable), `admin-mcp` (`gettingStarted`, `assign_chat switch_on`) |
| Checks | `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive` (+ first-run, Find and Settings-index states), `node scripts/ci-checks.mjs` |
| Security | no new endpoint; Find and inline steps use existing admin routes; keys go to the same provider routes; text rendered as text |
| Privacy | switching a chat on from Getting started posts the privacy notice and loads history exactly like the Chats switch |
| Small servers | no timers or polling; Find reads cached lists on open |
| Admin MCP | `get_overview` (open steps), `assign_chat` (`switch_on`); `docs/admin-mcp.md` |
| Docs | getting-started, README, website (text + shots), DESIGN (Find, deep links), privacy (one-step switch on) |
