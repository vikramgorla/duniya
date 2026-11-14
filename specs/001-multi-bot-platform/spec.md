# Feature Specification: Multi-Bot WhatsApp Agent Platform

**Feature Branch**: `001-multi-bot-platform`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "I have panduga.ch which also has an MCP server; this is a multi-family event we
are organizing. I want an agent in a WhatsApp group helping organizers and participants. I don't want
commercial WhatsApp connector options. The bot should be extensible to do other things — don't call the
deployment panduga, panduga can be one of the bots on the server."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Participant asks an event question in the group (Priority: P1)

A participant in the event's WhatsApp group addresses the assistant (by a trigger word such as
`!panduga`, by @mentioning it, or by replying to one of its messages) and asks something like "when is
the puja tomorrow?". The assistant looks up the live event data and answers in the group within
seconds. Messages that do not address the assistant get no reply.

**Why this priority**: answering participants' questions from the source of truth is the main value
and the smallest useful slice.

**Independent Test**: bind one group to one bot, send an addressed question and an unaddressed
message; only the first gets a reply, and the reply reflects the event data.

**Acceptance Scenarios**:

1. **Given** a group bound to the event bot, **When** a participant sends "!panduga when is puja?",
   **Then** the bot replies in the group with the time from the event system.
2. **Given** the same group, **When** someone writes "see you all tomorrow" without addressing the bot,
   **Then** the bot stays silent (but may use the message as context later).
3. **Given** a participant asks the bot to move their family to another room, **When** the bot answers,
   **Then** it explains an organizer must do it and nothing changes.

---

### User Story 2 - Organizer makes a change with explicit confirmation (Priority: P2)

An organizer asks the bot to change something ("put the Rao family in room 4"). The bot prepares the
change, shows what would happen and posts a short code. The change is applied only when an organizer
replies `confirm CODE` in the same chat within a few minutes; `cancel CODE` discards it.

**Why this priority**: organizers save time, but no change may ever happen without a human approving it.

**Independent Test**: as an organizer request a change, check nothing changed, confirm with the code,
check it changed exactly once; repeat with a participant trying to confirm.

**Acceptance Scenarios**:

1. **Given** an organizer request, **When** the bot prepares the change, **Then** the bot shows a summary
   and a 4-character code and the event data is unchanged.
2. **Given** a pending change, **When** a participant sends `confirm CODE`, **Then** the bot refuses and
   nothing changes.
3. **Given** a pending change, **When** an organizer sends `confirm CODE` in the same chat before it
   expires, **Then** the change is applied once and the bot reports the result.
4. **Given** an applied or expired code, **When** anyone sends `confirm CODE` again, **Then** nothing
   happens.

---

### User Story 3 - Operator runs several bots on one number (Priority: P3)

The operator adds a second bot (for example a carpool helper) by adding a bot definition, without
changing the platform. Each WhatsApp group is answered by at most one bot. A bot can bring its own
simple commands and tools in addition to tools from external services.

**Why this priority**: the deployment must not be "the panduga bot"; other uses must fit in later.

**Independent Test**: add a second bot definition, bind it to a second group, and check each group is
answered by its own bot with its own tools.

**Acceptance Scenarios**:

1. **Given** two bot definitions, **When** the platform starts, **Then** both bots are available and
   templates are ignored.
2. **Given** group A bound to bot 1 and group B to bot 2, **When** both groups address "their" bot,
   **Then** each reply comes from the bound bot only.
3. **Given** a bot with its own command (e.g. `!ping`), **When** someone sends it, **Then** the bot can
   answer without using the AI model.

---

### User Story 4 - Direct messages (Priority: P4)

A participant messages the bot privately, for example to ask something personal that should not be
answered in the group. The bot answers people allowed by the bot's direct-message policy (by default:
members of its groups and organizers) and ignores strangers.

**Why this priority**: keeps personal answers out of the group; strangers must not be able to use it.

**Independent Test**: DM the bot from a group member and from an unknown number.

**Acceptance Scenarios**:

1. **Given** a member of a bound group, **When** they DM the bot, **Then** the bot answers.
2. **Given** a number not in any bound group and not listed, **When** it DMs the bot, **Then** there is
   no reply.

---

### User Story 5 - Scheduled posts (Priority: P5)

An organizer enables a daily post such as a morning summary of today's agenda; the bot posts it to its
groups at the set time, and skips the post when there is nothing to say.

**Why this priority**: useful, but the event works without it.

**Independent Test**: configure a schedule, trigger it, check one post per group per day.

**Acceptance Scenarios**:

1. **Given** a schedule at 08:00, **When** 08:00 arrives, **Then** each bound group gets at most one post
   that day.
2. **Given** nothing is planned today, **When** the schedule runs, **Then** nothing is posted.

### Edge Cases

- A message that merely looks like a command ("no idea", "cancel ABCD" with an unknown code) MUST NOT
  trigger a reply.
- The AI model asks for a tool the sender is not allowed to use: the call is refused.
- An external tool service is down or misconfigured: the bot replies with an apology and the error is
  recorded; other bots keep working.
- A confirmation is attempted from a different chat than where the change was requested: refused.
- One person sends many messages quickly: replies are rate-limited per person and bot.
- The WhatsApp link drops: the platform reconnects automatically; if the device is unlinked, a new link
  can be made without redeploying.
- The whole platform is paused by an operator: no replies and no scheduled posts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST connect to WhatsApp as a linked device of an ordinary WhatsApp account, without
  any commercial WhatsApp connector.
- **FR-002**: System MUST host any number of bots, each defined independently (name, instructions,
  allowed tool sources, role rules, triggers, direct-message policy, schedules) without platform changes.
- **FR-003**: System MUST route each group message to the single bot bound to that group, and ignore
  groups bound to no bot.
- **FR-004**: In groups, a bot MUST reply only when addressed (its trigger word, an @mention, or a reply to
  its message) or to a valid confirmation command for one of its pending changes.
- **FR-005**: System MUST keep recent conversation per chat and give it to the bot as context.
- **FR-006**: System MUST assign each sender a role per bot (organizer or participant) from the bot's
  organizer list, with an optional bot-specific override.
- **FR-007**: System MUST offer each role only the tools that the bot allows for that role, and MUST refuse
  disallowed tool calls even if the AI model requests them.
- **FR-008**: Changes made through preview/confirm tools MUST only be applied after an organizer of that bot
  confirms with a single-use code in the same chat before it expires (default 9 minutes); the
  confirmation identifier MUST never be visible to the AI model.
- **FR-009**: Bots MUST be able to provide their own tools and commands in addition to external tool services.
- **FR-010**: Direct messages MUST be routed to a bot by trigger word, by an operator-chosen default bot,
  or to the first bot whose policy accepts the sender; senders accepted by no bot get no reply.
- **FR-011**: System MUST rate-limit replies per sender and bot (default 6 per minute).
- **FR-012**: Bots MUST support scheduled posts (time of day, days of week, target chats) that post at most
  once per chat per day and can skip when there is nothing to post.
- **FR-013**: System MUST record every routed message, reply, tool call, confirmation, schedule run and error
  for operators (see feature 002).
- **FR-014**: Organizers MUST be able to learn a group's identifier (`!groupid` in the group) and list the
  number's groups (`!groups` in a DM) to help set up bindings.
- **FR-015**: The first bot MUST serve the panduga.ch event: participants read agenda, menu, rooms,
  shopping, site pages and nominations; organizers additionally see registrations and history and can
  request any previewable change.
- **FR-016**: Bots MUST avoid posting personal details in groups and answer in the asker's language.

### Key Entities

- **Bot**: a named assistant with instructions, triggers, direct-message policy, organizer and participant
  lists, bound chats, tool sources, per-role tool rules, confirmation rule, schedules, on/off state.
- **Chat**: a WhatsApp group or direct conversation; bound to at most one bot.
- **Sender**: a person identified by phone number; has a role per bot.
- **Tool source**: an external tool service (with role-specific credentials) or the bot's own tools.
- **Pending change**: a prepared change awaiting confirmation: code, bot, chat, requester, summary, expiry.
- **Schedule**: when and where a bot posts, and what to post.
- **Activity entry**: a timestamped record of something the platform did.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of addressed questions receive a reply within 15 seconds.
- **SC-002**: 0 replies to messages that do not address a bot in automated tests and in the first week of use.
- **SC-003**: 0 changes applied without an organizer's confirmation code (verified by tests and the
  activity log).
- **SC-004**: A new bot can be added and answering in its group in under 15 minutes without editing platform code.
- **SC-005**: Participants never receive tools reserved for organizers (verified by automated tests for
  every release).

## Assumptions

- The operator provides a dedicated WhatsApp number (a prepaid SIM) and accepts the small ban risk of an
  unofficial client; bots stay conservative (reply only when addressed, rate-limited).
- panduga.ch exposes its data through an MCP server with preview tools that return a confirmation id and a
  separate confirm tool; access uses bearer tokens (an organizer-level token, optionally a member-level one).
- Registering families is an admin function in panduga.ch, so participants cannot self-register through the bot.
- Organizers are identified by phone number; group membership is trusted as "participant".
- Timezone defaults to Europe/Zurich.
