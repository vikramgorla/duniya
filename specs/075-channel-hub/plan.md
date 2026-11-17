# 075 · Plan

## Approach

- `src/channels/index.js`: catalogue (`CHANNELS`: id, label, prefix, setup, caps, ids) and the id helpers. Metadata
  only. Chat ids of new channels: `<prefix>:<account>#<native>`; WhatsApp stays unprefixed (no migration).
- `src/channels/whatsapp/ids.js`: JIDs, `MAIN`, `chatKey`/`splitChat` (from direct-chats), `bareJid`/`pnDigits`
  (from contacts), `pnJid`. Used by contacts, direct-chats, member-tags and the session.
- `src/channels/hub.js` replaces `registry.js`: loaders (`import('./whatsapp/index.js')`), set-up test without loading
  (numbers setting or the auth folder), `channelsOff` setting, routing by chat id (409 when not running, 501 when the
  channel cannot), `noteChat` for every inbound message, `channels()` rows, `setEnabled()`, round-robin `upkeep()` with
  the load cost (RSS delta a minute after start), `stop()`.
- `src/channels/whatsapp/index.js` (the old registry, now the adapter: numbers, routing to sessions) and `session.js`
  (the old `whatsapp.js`).
- `src/core/chat-tools.js` (was `whatsapp-tools.js`): `cap` per tool, `chatToolsFor(chat)`, `targetChat(…, cap)`.
  `toolsFor(agent, role, { chat })` from the runner and the owner assistant.
- `src/core/people.js`: `people` + `identities` tables, `personFor`, `personByPhone`; the router notes the sender after
  the allow-list; the person page API lists the person's channels.
- Panel: `app/channels.js` (rows + page, redrawn in place by live status), Settings group *Channels*, Overview card and
  chip link, Getting started *Show the QR code*, Health rows; routes `GET /api/channels`, `PUT /api/channels/:id`.

## Small servers

Measured on the real app (`src/index.js`, 35 s after start): fresh install ~150 MB on this branch vs 164–210 MB on
v2.34.1 (Baileys loaded and connecting); with a WhatsApp number ~180–200 MB. No new timers: measurement and channel
upkeep ride on the 30-second tick.

## Risks

- The fresh-install first step needs one tap to load WhatsApp (accepted: it is the owner's explicit requirement).
- A test that pushes a fake catalogue entry proves the prefixed ids, routing and capability filtering for a second
  channel without shipping one.

## Definition of Done

Issue + labels + comments; spec; tests with fakes (`test/channel-hub.test.js`, updated registry tests); `npm test`,
lint, typecheck, check:panel, check:responsive; ci-checks (knip, jscpd, budgets); docs (architecture + diagram,
development *Adding a channel*, whatsapp, small-servers, admin-mcp, everyday, getting-started, AGENTS map, DESIGN,
README, website FAQ, retaken shots); version 2.35.0 in package.json, package-lock and schema.yaml; releases.json; PR
via REST without attribution; squash merge with explicit message; done comment.
