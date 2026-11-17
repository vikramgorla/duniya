# 073 · Usability pass 2: names everywhere, calm rows

Issue #155 · version 2.33.0

## Why

The owner (Android Chrome, dark) found more friction after 072:
- *Why agents stayed quiet* showed a group as `120363169191099017@g.us`, and every entry had big bordered buttons.
- The Update card on Overview was four blocks (banner, last update with the backup file, Check now, Update settings).
- A thick focus ring stayed on the tapped bottom tab.
- Usage (5.9k px) and Server (2.9k px) were far too long on a phone; contacts led nowhere; Overview's agents were not
  links; raw tool words (`transport:connections`) in summaries.

## User stories

1. **I see a chat's name wherever a chat appears**: Overview, Chats, Activity (also live), Pending, Usage, caps,
   Review, search, the admin MCP tools, the owner assistant's answers and alerts.
2. **Why it stayed quiet is one glance**: grouped by chat, the reason in plain words with its count and the fix as a
   small link; Clear behind ⋯.
3. **Updates are one calm row** on Overview; the whole story is on Settings → Updates.
4. **Tapping never leaves a ring**; keyboard users still see one.
5. **Usage and Server fit a phone**: summary rows, details behind a tap.
6. **A person has a page**: name, number, note, Shared, their direct chat and the groups they wrote in, linked both ways.

## Requirements

- R1 `src/core/chat-names.js` is the one resolver: `chatLabel(id)` (stored names only), `chatLabels(ids, channel)`
  (asks WhatsApp once for an unknown group, at most every 10 minutes), `withChatNames(rows)`. Group subjects are
  remembered in `chats_seen.name` by the channel registry and the resolver. Never an id for a WhatsApp chat.
- R2 `chatName` on `/api/silences`, `/api/activity`, the live `/api/events` entries, `/api/pending`,
  `/api/usage?groupBy=chat`; budget names and alerts, Review, search, the owner assistant and the admin MCP use it.
  `chatTitle()` and the local lookups are removed; Activity no longer loads `/api/chats` for names.
- R3 Why-quiet: grouped by chat (≤ 5 chats), `quietReason()` lines with `.qfix` links; ⋯ Clear clears the chat.
- R4 Overview update row (`renderUpdates(box)`); Settings → Updates (`renderUpdates(box, { page })`) with the last
  update and backup, Check now, settings, Restart service. Breaking-release banner and dialogs unchanged.
- R5 Focus rings only under `html.kbd` (Tab / arrows / Esc / Enter or Space outside a field; any pointer clears it).
- R6 Usage: one Breakdown card (seg Agents · Chats · Models · Accounts · Kind, rows, ⋯ Set price…), fallback line.
  Server: This server one line, Health summary + Details, Hosting help shorter, Logs one row loading when opened.
- R7 `GET /api/contacts/:phone/person` (admin): contact (or `notSaved`), `direct`, `groups`; panel `#contacts/<phone>`;
  Find anything lists contacts; a direct chat's page links to *Contact page*; admin MCP `get_contact`.
- R8 Overview agent rows: name → agent page, *Review* link. Tool summaries written with `toolPhrase()` (raw name in
  `detail.tool`); old `server:tool` summaries tidied in the panel.

## Out of scope

- Moving OS updates & maintenance into its own page (Server stays one screen).
- Members of a group without stored messages on the person page (needs a member index).
