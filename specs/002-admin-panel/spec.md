# Feature Specification: Admin Panel

**Feature Branch**: `002-admin-panel`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "I need an admin panel on the server to control and see what the bot is doing."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what the bots are doing, live (Priority: P1)

The operator opens the panel on their phone and sees a live stream of everything: who asked what, which
bot answered, which tools it used (with inputs, results and timing), confirmations and errors. They can
filter by bot and open any entry for details.

**Why this priority**: visibility is the core reason for the panel.

**Independent Test**: send a message to a bot and watch it appear in the panel's activity within seconds,
followed by its tool calls and the reply.

**Acceptance Scenarios**:

1. **Given** the panel is open, **When** a bot handles a message, **Then** the incoming message, each tool
   call and the reply appear in the activity stream without reloading.
2. **Given** many entries, **When** the operator filters by one bot, **Then** only that bot's entries show,
   and older entries can be loaded.

---

### User Story 2 - Control the bots (Priority: P1)

The operator can pause everything with one switch, turn individual bots on or off, edit each bot's live
settings (organizers, triggers, direct-message policy, extra instructions, schedules, model, limits),
choose which bot answers in each group, apply or cancel pending changes, and run a schedule immediately.

**Why this priority**: control is the other half of the request; the kill switch matters for safety.

**Independent Test**: pause and check a bot stops answering; bind a group to a bot and check it starts
answering there; edit organizers and check roles change.

**Acceptance Scenarios**:

1. **Given** bots are answering, **When** the operator turns on "Pause all", **Then** no bot replies or
   posts until it is turned off.
2. **Given** a group the number belongs to, **When** the operator selects a bot for it, **Then** that bot
   (and only it) answers there from then on.
3. **Given** a bot's settings, **When** the operator saves invalid values (e.g. a malformed schedule),
   **Then** the save is rejected with a clear message and nothing changes.
4. **Given** a pending change, **When** the operator applies or cancels it in the panel, **Then** the
   result is the same as an organizer confirming or cancelling in WhatsApp.

---

### User Story 3 - Link WhatsApp and manage secrets without a shell (Priority: P2)

On first start the panel shows the WhatsApp link QR code (or a pairing code for a number). The operator
enters API keys and tokens in the panel; values are never shown again. The operator can unlink and
re-link WhatsApp.

**Why this priority**: removes the need for SSH, which the deployment does not expose.

**Independent Test**: on a fresh server, link WhatsApp from the panel and set the AI key; a bot answers.

**Acceptance Scenarios**:

1. **Given** WhatsApp is not linked, **When** the operator opens the overview, **Then** a scannable QR code
   and a pairing-code option are shown.
2. **Given** a secret is saved, **When** any page or API response is inspected, **Then** its value never
   appears, only whether it is set.
3. **Given** a bot references a secret that is missing, **When** the operator opens Secrets, **Then** it is
   listed as missing and used by a bot.

---

### User Story 4 - Try a bot and update the server (Priority: P3)

The operator can chat with any bot from the panel as a participant or an organizer, using real tools but
without posting to WhatsApp. They can update the server to the latest code from GitHub and restart it.

**Why this priority**: speeds up setup and maintenance.

**Independent Test**: ask a bot a question in the test console; press Update and see the new version.

**Acceptance Scenarios**:

1. **Given** a bot, **When** the operator sends a test question as a participant, **Then** the answer shows
   in the panel and nothing is posted to WhatsApp.
2. **Given** a new commit on the main branch, **When** the operator presses Update, **Then** the server
   pulls it, installs changed dependencies, restarts, and shows the new version; live settings survive.

### Edge Cases

- Wrong password repeatedly: further attempts are blocked for a minute.
- Session expired while the panel is open: the next action returns to the login screen.
- A message containing HTML or script text arrives from WhatsApp: it is shown as plain text.
- A request to change state from another website (cross-site request): rejected.
- Update fails (e.g. merge conflict, network): the old version keeps running and the log is shown.
- WhatsApp is disconnected: the chats list is empty and bound groups are still shown as bound.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Panel MUST require a password; sessions MUST expire after 7 days and be invalidated when the
  password changes.
- **FR-002**: Panel MUST block login for one minute after 5 failed attempts from the same address.
- **FR-003**: Panel MUST show channel status (linked/not linked/reconnecting/logged out), the QR code or a
  pairing code, and allow reconnect and unlink.
- **FR-004**: Panel MUST provide a global pause switch and a per-bot on/off switch.
- **FR-005**: Panel MUST stream activity live and allow filtering by bot, paging to older entries, and
  viewing entry details.
- **FR-006**: Panel MUST list bots with their tool sources, own tools, confirmation rule and schedules, and
  allow editing only the live settings (on/off, model, max tokens, history size, triggers, mention
  behaviour, direct-message policy, organizers, participants, extra instructions, schedules).
- **FR-007**: Panel MUST validate settings (phone numbers normalised to digits, schedule time HH:MM,
  limits within range) and reject invalid input without partial saves.
- **FR-008**: Panel MUST list the number's groups and let the operator bind each to at most one bot.
- **FR-009**: Panel MUST list pending changes and allow apply and cancel.
- **FR-010**: Panel MUST manage secrets write-only and show which secrets bots need and which are missing.
- **FR-011**: Panel MUST offer a test console per bot with a role choice that never posts to WhatsApp.
- **FR-012**: Panel MUST let the operator run a schedule now, update from GitHub, and restart the service.
- **FR-013**: Panel MUST let the operator change the admin password and choose the default bot for direct
  messages.
- **FR-014**: Panel MUST be usable on a phone screen (≥360 px wide) and in light and dark mode.
- **FR-015**: Panel MUST only be reachable on the server itself unless deliberately exposed through a tunnel.

### Key Entities

- **Admin session**: a logged-in browser with an expiry.
- **Activity entry**: type, time, bot, chat, short summary, optional details.
- **Bot live settings**: the operator-editable subset of a bot, stored separately from the code defaults.
- **Secret**: a named value; only its presence is ever displayed.
- **Global settings**: pause flag, default direct-message bot.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: New activity appears in an open panel within 2 seconds of happening.
- **SC-002**: From a fresh server, an operator links WhatsApp, sets secrets and binds a group in under 10
  minutes, using only a phone.
- **SC-003**: Pausing stops all bot replies within one message (verified by test).
- **SC-004**: No secret value is ever returned by the panel (verified by test).
- **SC-005**: Live settings survive 100% of code updates.

## Assumptions

- A single admin account is enough (the operator); multiple users/roles are out of scope.
- The panel is reached through a Cloudflare Tunnel, ideally with Cloudflare Access in front (feature 003);
  without it, only via an SSH port-forward.
- Activity history keeps the most recent ~5,000 entries; older entries are dropped.
