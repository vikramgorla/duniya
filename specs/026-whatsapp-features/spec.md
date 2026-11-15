# Feature Specification: WhatsApp Features for Agents

**Feature Branch**: `feat/i2-whatsapp-features` (spec 026) | **Created**: 2026-11-15 | **Status**: Implemented
**Input**: GitHub issue #2, "All WhatsApp features for agents". Owner decision on the issue: powerful actions (removing
people, group settings and picture, block, delete) are **organizer-only and happen immediately, with no confirm code**.
Participants get the send, react and poll tools.

## User Scenarios

- **US1 (P1) Rich sends**: someone asks the bot for the flyer, the venue location or a contact. The bot sends an image,
  GIF, video, sticker, voice note or document (from a public URL or base64), a location pin, or a contact card.
- **US2 (P1) Reactions and replies**: the bot reacts to a message (👍 ✅), quotes an older message in its reply, and can
  edit or delete its own messages.
- **US3 (P1) Polls**: the bot posts a poll (single or multiple choice). Members vote, and the bot can answer "how is the
  lunch poll going?" from the decrypted votes.
- **US4 (P1) Group management by organizers**: an organizer asks the bot to add or remove people, make someone admin,
  rename the group, change the description or picture, switch "only admins send", "only admins edit info" or join
  approval, or reset the invite link. It happens right away and is logged.
- **US5 (P2) Awareness**: the agent's context says who reacted to what and how polls stand, and shows media as
  placeholders such as "[image: caption]" or "[voice note]". Media is never downloaded.
- **US6 (P2) Admin panel**: under Chats → Messages & memory, an admin sees a WhatsApp card for a group. It lists the
  members with admin badges, shows the invite link (copy or reset) and lets the admin edit the name, the description
  and the three settings. Admin MCP tools offer the same actions.
- **US7 (P2) Control**: in the bot editor, the admin ticks which WhatsApp actions each role may use.

## Requirements

- **FR-001** Channel API in `whatsapp.js`, using Baileys 7 calls (see research.md): sendMedia, sendLocation,
  sendContact, react, editMessage, deleteMessage, markRead, presence, sendPoll, groupInfo, groupCreate,
  groupInviteLink, groupRevokeInvite, groupParticipants (add, remove, promote, demote), groupSubject,
  groupDescription, groupPicture, groupSettings (announcement, locked, joinApproval), groupLeave, profile,
  setProfileName, setProfileStatus, block and unblock. The registry routes each one by chat id to the right number.
- **FR-002** Media comes from an http(s) URL or base64 only. Downloads have a size limit (`WA_MEDIA_MAX_MB`, default
  16) and are type-checked (header plus magic bytes) for the media kind. An SSRF guard refuses loopback, private,
  link-local and metadata, CGNAT, multicast and reserved addresses. The guard runs at DNS-lookup time, so DNS
  rebinding cannot get through, and it also applies to every redirect (at most 3). Baileys never fetches URLs itself.
- **FR-003** Incoming reactions are stored when they are on a bot message or in a chat bound to an enabled bot. Poll
  votes are decrypted with the stored poll creation message (its `messageSecret`); the latest vote per person counts.
  Both are summarised in the context block `<reactions_and_polls>` and logged as `whatsapp.reaction` /
  `whatsapp.vote` (Messages category).
- **FR-004** Media messages are stored as placeholders. A media caption can still address the bot ("!bot what is
  this?"); the agent then gets "[image] what is this?".
- **FR-005** The built-in tool group `whatsapp` is exposed as `whatsapp__<tool>`: send_media, send_location,
  send_contact, react, reply, edit_message, delete_message, create_poll, poll_results, group_info, group_invite_link,
  revoke_invite_link, add_participants, remove_participants, promote, demote, set_group_subject,
  set_group_description, set_group_picture, set_group_settings, profile_info, block and unblock.
- **FR-006** Role rules are enforced in code:
  - Participant default: send_media, send_location, react, reply, create_poll, poll_results, group_info,
    profile_info.
  - Organizer default: all tools.
  - When a role has explicit `whatsapp:` rules, those replace the defaults (`whatsapp:-` = none).
  - These tools are organizer-only whatever the rules say: delete_message, revoke_invite_link, the four people tools,
    the four set_group_* tools, block and unblock.
  - The deny list always wins.
- **FR-007** Tools act on the current chat by default. They act on another chat only when that chat is bound to the
  same bot (given by id or group name).
- **FR-008** Every tool action is logged as `whatsapp.action` (the new log category "WhatsApp actions"). The log entry
  records the tool, the input (base64 shown only as its length), the role and who asked.
- **FR-009** Privacy:
  - group_info shows phone numbers to organizers only.
  - profile_info for participants covers only the sender and people seen in the chat.
  - Organizers of the bot cannot be blocked through the tool.
- **FR-010** Admin routes (admin role):
  - `GET/PUT /api/chats/:chat/whatsapp`
  - `GET /api/chats/:chat/whatsapp/invite`
  - `POST /api/chats/:chat/whatsapp/invite/revoke`
  - `GET /api/whatsapp/tools` (catalog for the editor)

  Admin MCP tools: get_group_info, get_group_invite_link, reset_group_invite_link (risky) and update_group.
- **FR-011** The UI follows DESIGN.md and works at 375 px wide.

## Out of scope

Downloading or transcribing incoming media, communities, status posts, and polls created before the app was running
(their votes cannot be decrypted).
