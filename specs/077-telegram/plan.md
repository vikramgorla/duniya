# 077 · Plan

## Approach

- `src/channels/index.js`: catalogue entry `telegram` (prefix `tg`, caps, `secret` with the token pattern and hint).
  `src/channels/telegram/ids.js`: id helpers (negative chat id = group).
- `src/channels/telegram/index.js`: the adapter. Its `call()` takes a replaceable `fetch` (tests and the demo use
  `test/fake-telegram.js`), keeps the token out of errors and status, and supports multipart for uploads. It also
  has the long-poll loop, the update handlers (message, my_chat_member, message_reaction, poll_answer), contact
  linking, `/start`, mentions from entities, media info + `getFile` download (≤ 20 MB and the media limit), chat
  actions, the per-chat queue, `upkeep()`, and `askForPhone()`. `format.js`: markup → entities, chunks, reactions.
- `src/channels/hub.js`: loader; "set up" for token channels = the secret is stored; `onSecretChange` restarts or
  stops; `load()` deduplicated; `channels()` rows carry `info`, `status`, `lastError`; `onSeen` notes a group when the
  bot is added; switching on a token channel without its token is refused.
- `src/core/people.js`: `phoneOfIdentity`, `identityByPhone`.
- `src/core/router.js`: one helper for an account's DM agent (WhatsApp number or Telegram bot), *Share my number*
  on a role refusal, `createChatMoveHandler` (with `db.moveChatData` + `chat-prefs.moveChatPrefs`).
  `runner.js`: the system prompt names the chat's app and tells unlinked people how to link.
  `chat-tools.js`: the organizer-only error explains linking. `welcome.js`: stored with the chat's channel.
- Panel: `PUT /api/secrets` checks channel token patterns; `PUT /api/channels/telegram/settings`; secret links
  label channel tokens; `app/channels.js` Telegram cards; `app/login.js` secret page returns to a given screen;
  `app/chats.js` channel wording; `routes/chats.js` `channel` + `numberLabel`.
- Admin MCP: tool descriptions, `set_telegram_dm_agent`.

## Small servers

Measured with `scripts/measure-load.mjs`-style RSS deltas (see the PR): importing and starting the adapter against
the fake Bot API adds about 1–3 MB. The long poll is one pending request, and the caches are bounded. No new
dependency. Downloads are refused before fetching when Telegram's declared size is over the limit.

## Risks

- Privacy mode hides group messages that don't address the bot. The panel says so and gives the steps (BotFather
  /setprivacy and re-add, or make the bot an admin).
- A second server polling with the same token gets 409: the panel shows the reason.
- A bot cannot list members or its groups: groups are known once they speak or the bot is added. Roles from admins
  use `getChatAdministrators`.

## Definition of Done

Issue + labels + comments; spec; tests with a fake Bot API (`test/telegram.test.js`, hub tests updated); `npm test`,
lint, typecheck, check:panel, check:responsive; ci-checks; docs (`docs/telegram.md`, index, channel mentions,
admin-mcp, architecture, development), README, website tile + FAQ, retaken shots; demo panel fake bot; version 2.38.0
in package.json, package-lock and schema.yaml; releases.json; PR via REST without attribution; squash merge with an
explicit message; done comment.
