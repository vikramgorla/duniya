# Feature Specification: Owner Assistant and Privacy Notice

**Feature Branch**: `feat/50-owner-assistant` (issue #50)

**Created**: 2026-11-15

**Status**: Implemented (v2.8.0)

**Input**: Owner-approved design (#50): a built-in owner assistant that answers only the owner's (and other linked
panel users') direct chat with an agent number, never groups; an Ask box on Overview; linking from the panel; only
stored data of chats that are on, chats "private to members" excluded; read/summarise across chats and act through the
admin tool set with confirmation; full audit; a privacy notice posted when a group is switched on (on by default).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Link my WhatsApp number (Priority: P1)

A panel user opens **Settings → Owner assistant → Link my WhatsApp**. The panel shows a one-time message `link CODE`
(valid 10 minutes) and the agent numbers to send it to. They send it from their phone; the number replies "Got it, now
confirm in the panel". The panel shows "Linked +41…? Yes, link / Not me". After **Yes** the link is active. **Unlink**
any time; owners see and can unlink every linked person.

**Acceptance Scenarios**:

1. **Given** a fresh code, **When** it is sent from WhatsApp, **Then** the link is *pending* with the sender's phone
   (resolved from LID JIDs as the router does) and becomes active only after confirmation in the panel.
2. **Given** an expired or wrong code, **Then** nothing is linked; after 5 wrong codes in 10 minutes a number is told
   to wait. A number already linked to another user cannot be linked again. When WhatsApp hides the phone number, the
   user is told it cannot be linked.
3. A new code replaces the user's earlier link. Deleting a panel user removes their link and conversation.

### User Story 2 - Ask about all chats from WhatsApp (Priority: P1)

A linked user sends "what did the families decide this week?" to an agent number. The owner assistant (not one of the
configured agents, not listed among agents) answers using cross-chat tools. Long answers are split into several
WhatsApp messages at paragraph boundaries.

**Acceptance Scenarios**:

1. Only direct messages from linked, active panel users are answered; groups never; anyone else is routed as before.
2. A message that starts with an agent trigger (`!family …`, `!groups`) goes to normal routing; so does
   `confirm CODE` / `cancel CODE` for a change an agent prepared.
3. The conversation is stored in its own table (`owner_messages`), never in chat memory, summaries or search.
4. It works whether or not the user's direct chat is switched on and while agents are paused (it is a management tool).

### User Story 3 - Act with confirmation (Priority: P1)

"Turn off the helper agent" → the assistant prepares `set_agent_enabled` and the reply ends with "Reply *confirm ABCD*
to apply, or *cancel ABCD* (valid 10 min)". Nothing changes until the same user confirms on the same surface.

**Acceptance Scenarios**:

1. Every tool that is not read-only (all admin tools that change anything, including agent and configuration changes,
   and those admin tools mark as risky) is held for confirmation; codes are 4 characters, single-use, 10 minutes,
   bound to the user and the surface (that WhatsApp chat, or the panel), and never clash with agents' codes.
2. The role is checked again when confirming. Tools that take secret values (`set_secret`, `add_user`,
   `restore_backup`) are never offered: keys and passwords stay in the panel.
3. There is no "post into another chat" tool; replies never leave the owner's chat.

### User Story 4 - Ask box on Overview (Priority: P2)

Overview starts with an **Ask** card (phone-friendly, no streaming): the same assistant and tools with the signed-in
user's role. Held changes show **Confirm / Cancel** buttons. The mobile app's Overview has the same card.

### User Story 5 - Data scope and privacy (Priority: P1)

The assistant sees only stored data of chats that are on. **Chats → Private to members** hides a chat from every
cross-chat tool and from the Ask box (content tools refuse it; list outputs drop it). Viewers get read-only tools and
no message contents (as in the panel, where stored messages are admin-only); admins get admin tools; owners all.

### User Story 6 - Audit (Priority: P1)

Every question (clipped to 140 characters), every tool call, every held and confirmed or cancelled action, and every
link change is recorded in Activity as `owner.question`, `owner.tool`, `owner.action`, `owner.link` (category
"owner", always recorded like configuration changes), plus the usual `confirm.created` / `confirm.applied`.

### User Story 7 - Privacy notice (Priority: P1, owner decision: on by default)

When a group is switched on, the number posts once: "Messages in this group are stored so the assistant has context.
The group's organiser can review them. Ask an organiser if you have questions." (editable under **Settings → Privacy
notice**).

**Acceptance Scenarios**:

1. Switching the group off and on again re-posts only if the text changed or the last post is over 90 days old.
2. Per-group opt-out (Chats → Privacy notice) is allowed and recorded in Activity.
3. Never posted in direct messages; instead the agent's first reply to a person gets the direct-message line once
   (configurable, default on). Chats that are off never get anything.

### Edge Cases

- The model calls a tool the role does not have: refused (not in the tool list, refused if called).
- A content tool with a private or switched-off chat: refused with "not visible".
- The confirm code is used from the other surface or by another user: refused with a plain explanation.
- Model failures: same friendly messages as agents (fallback applies).

## Requirements

- **FR-001** Built-in, not configurable as an agent; model setting `ownerAssistant.model` (default `auto` = the
  default model with fallback, #43).
- **FR-002** Linking flow with one-time code (10 min), panel confirmation, unlink; per signed-in user.
- **FR-003** Router: one early branch for direct messages delegating to `src/core/owner-assistant.js`.
- **FR-004** Tools: admin tool set (role-gated in code) + `list_visible_chats`, `search_messages`, `chat_recap`.
- **FR-005** Confirmation for every change; secret-taking tools excluded.
- **FR-006** Chat prefs `private` and `noticeOff`; Chats toggles; admin MCP tools `get_owner_assistant`,
  `set_chat_private`, `get_privacy_notice`, `set_privacy_notice`, `set_chat_privacy_notice`.
- **FR-007** Ask box API `POST /api/owner/ask`, `POST /api/owner/ask/confirm`, `GET /api/owner/ask/history`.
- **FR-008** Privacy notice rules above; settings `privacyNotice { enabled, text, dmFirstReply, dmText }`.
- **FR-009** Audit entries `owner.*` always recorded.

## Success Criteria

- Tests with fakes cover: linking and expiry, non-linked numbers ignored, groups never answered, trigger passthrough,
  private chats excluded, role-based tool sets, confirmation for changes, Ask box API, privacy notice rules.
