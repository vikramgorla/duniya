# Implementation Plan: Owner Assistant and Privacy Notice

**Spec**: [spec.md](spec.md) · **Issue**: #50 · **Release**: v2.8.0

## Design

- `src/core/owner-assistant.js` — tables `owner_links` (user → phone, status code/pending/linked, hashed code,
  expiry) and `owner_messages` (own conversation scope, 200 per user); linking (`startLink`, `claimCode`,
  `confirmLink`, `unlink`, `userForPhone`); data scope (`visibleChats` = on and not private, `hideChats` drops list
  entries about private chats from any tool output); core tools `list_visible_chats` (viewer), `search_messages` and
  `chat_recap` (admin); `ask()` — tool loop like the runner (8 rounds, fallback per call), every non-read-only tool
  held with a 4-character code in memory (`resolveConfirm`); `chunkText()`; `handleOwnerMessage(msg, channel)` for
  the router.
- Admin tools run in-process through the panel's `invoke()` and `routeRole()` (exactly the admin MCP's gates). The
  panel registers them with `setOwnerToolRunner()` so core does not import panel code.
- `src/core/router.js` — two small, isolated changes (to merge cleanly with #48): one early branch for direct messages
  (`handleOwnerMessage`) and the DM privacy line in `reply()`.
- `src/core/privacy-notice.js` — settings with defaults, `noticeDecision` (first time / text changed / > 90 days /
  opted out / chat off / not a group), `maybePostNotice` (called when the Chats route switches a chat on),
  `setChatNoticeOff` (recorded), `dmNoticeOnce(who)` (table `privacy_dm_seen`).
- `src/core/chat-prefs.js` — columns `private`, `notice_off` (added in place).
- `src/core/events.js` — `owner.*` → category "owner", always recorded.
- `src/panel/routes/owner-assistant.js` — `/api/owner-assistant` (status, link, confirm, unlink, owners unlink others,
  model), `/api/owner/ask` (+ confirm, history), `/api/privacy-notice`. `PUT /api/chats/:chat/prefs` accepts
  `private` and `noticeOff` and posts the notice on switch-on.
- Panel (`index.html`): Overview **Ask** card (state kept across the 5 s refresh), Settings **Owner assistant** and
  **Privacy notice** cards, Chats ticks "Private to members" / "Privacy notice". Mobile Overview: Ask card + demo answer.
- Tests: `test/owner-assistant.test.js`; the harness switches the notice off for older tests (`{ privacyNotice: true }`
  turns it on), like `chatsOn`.

## Constitution Check

- II generic core: no agent-specific names; the assistant is platform functionality, its tools are the admin tools.
- III least privilege in code: tool list from panel role gates; refused if called anyway; private chats enforced in
  code, not the prompt; viewers get no message contents.
- IV human confirmation: every change held; codes single-use, 10 minutes, bound to user and surface; no confirm tool
  for the model.
- V observable: `owner.*` audit entries always recorded; link changes, privacy-notice posts and opt-outs recorded.
- VI: no new dependencies; two small tables, two columns; in-memory confirm codes.
- VIII: plain-language cards; one state per link; responsive check passes at 375 / 1440 in light and dark.
- Security: untrusted text stays data (prompt says so; panel renders text only); secrets never pass through WhatsApp;
  link codes stored hashed, brute-force limited.

## Complexity Tracking

None.
