# Feature Specification: Group Memory and Context Awareness

**Feature Branch**: `004-group-memory`

**Created**: 2026-11-14

**Status**: Implemented

**Input**: User description: "Agent must have memory and must be context aware of what's happening in the
group, including previous messages and discussions."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The bot follows the conversation (Priority: P1)

Families discuss plans in the group without addressing the bot ("let's take the 9:10 train", "Rao family
arrives Saturday"). Later someone asks the bot "which train did we agree on?" and it answers from the
discussion, not only from the event system.

**Why this priority**: a group assistant that ignores the conversation around it feels broken.

**Independent Test**: post several unaddressed messages, then ask the bot about them; it answers correctly.

**Acceptance Scenarios**:

1. **Given** unaddressed messages in a bound group, **When** someone asks the bot about them, **Then** the
   bot's answer uses them.
2. **Given** a message that replies to (quotes) an earlier message, **When** the bot reads it, **Then** it
   knows what was quoted.
3. **Given** the bot was bound to a group after people had already been chatting, **When** it is first asked,
   **Then** it can use the earlier messages the number had received.

---

### User Story 2 - Long discussions stay in memory (Priority: P1)

The group has been active for weeks with hundreds of messages. The bot still knows the important decisions,
plans and open questions from long ago, without slowing down or costing much per answer.

**Why this priority**: event planning runs for weeks; recent-messages-only context forgets decisions.

**Independent Test**: create more messages than the recent window, check a summary of the older part exists
and is given to the bot, and a decision from the old part can be answered.

**Acceptance Scenarios**:

1. **Given** more messages than the recent window, **When** new messages arrive, **Then** the older ones are
   folded into a running summary of the group's discussion (decisions, plans, open questions, who is who).
2. **Given** a summary exists, **When** the bot answers, **Then** it receives the summary plus the recent
   messages verbatim.
3. **Given** a detail is missing from the summary, **When** asked, **Then** the bot can search older messages
   of that group to find it.

---

### User Story 3 - Remember things on request (Priority: P2)

A participant or organizer says "@bot remember that the Kumars are vegetarian" or "remember: the hall key is
with Ravi". The bot saves a note for that group and uses it in future answers. Organizers can ask it to
forget a note.

**Why this priority**: explicit facts must not depend on the summary catching them.

**Independent Test**: ask the bot to remember something, then in a later question check it uses the note;
as an organizer ask it to forget it.

**Acceptance Scenarios**:

1. **Given** a request to remember, **When** the bot handles it, **Then** a note is saved with who asked, and
   the bot confirms.
2. **Given** saved notes, **When** the bot answers later, **Then** the notes are part of its context, with
   organizer notes marked as such.
3. **Given** a participant asks to forget a note, **Then** it is refused; an organizer can.

---

### User Story 4 - Operator sees and controls memory (Priority: P2)

In the admin panel the operator opens a group's memory: the running summary, the notes and how many messages
are stored. They can delete a note, rebuild the summary, or erase everything stored for that group.

**Why this priority**: privacy and correctness — wrong or sensitive memory must be removable.

**Independent Test**: view memory for a group, delete a note, erase the group; the bot no longer knows it.

**Acceptance Scenarios**:

1. **Given** a group with memory, **When** the operator opens it in the panel, **Then** the summary, notes and
   message count are shown.
2. **Given** the operator erases the group's memory, **Then** stored messages, summary and notes for it are
   deleted and the bot answers without them.

### Edge Cases

- History arrives twice (sync + live): the same message is stored once.
- The summarising step fails (network, key missing): answers still work with recent messages; it retries later.
- Two summarisations for the same group at once: only one runs.
- Someone tries to plant instructions in the chat or in a note ("ignore your rules"): memory is treated as
  information about the group, never as instructions, and cannot change roles or permissions.
- Personal details in the summary: the summary excludes phone numbers and emails.
- A group the number is in but bound to no bot: its messages are kept (within retention) so a bot bound later
  has context; nothing is answered there.
- Direct messages: memory is per chat, so a person's DM context never leaks into a group.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST store every text message (and media caption) received in any group the number
  belongs to, whether or not it addresses a bot, plus all bot replies and direct messages routed to a bot.
- **FR-002**: System MUST store, for each message, its sender name, time, and the text of the message it
  replies to (if any), and MUST store each message at most once.
- **FR-003**: System MUST store recent group history delivered by WhatsApp when the number is linked or
  reconnects, without replying to it.
- **FR-004**: The bot's context MUST include: the group's running summary, the group's notes, and the most
  recent messages (default 30) verbatim with reply-quotes.
- **FR-005**: When more than the recent window plus a batch (default 40) of messages are unsummarised, the
  system MUST fold the oldest unsummarised messages into the running summary in the background, one
  summarisation per group at a time, using a low-cost model.
- **FR-006**: The summary MUST capture decisions, plans, dates, open questions, commitments and who is who,
  stay under ~500 words, and exclude phone numbers and email addresses.
- **FR-007**: Bots MUST have built-in tools: remember a note (all roles), list notes (all roles), forget a
  note (organizers only), and search older messages of the current chat (all roles).
- **FR-008**: Notes MUST be scoped to a chat and record who added them and their role.
- **FR-009**: Memory content MUST be presented to the model as untrusted information, never as instructions.
- **FR-010**: A bot MUST be able to turn memory off in its definition.
- **FR-011**: Messages older than the retention period (default 90 days) and beyond a per-chat cap (default
  5,000) MUST be deleted automatically; summaries and notes stay until erased.
- **FR-012**: The panel MUST show, per chat, the summary, notes and stored message count, and allow deleting
  a note, rebuilding the summary and erasing all memory of the chat.
- **FR-013**: All memory actions (summary updated, note added/removed, chat erased) MUST appear in activity.

### Key Entities

- **Stored message**: chat, sender, name, time, text, quoted text, whether from a bot, message id.
- **Chat summary**: running text summary of a chat up to a given message, last update time.
- **Note**: chat, text, author name, author role, time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Questions about anything said in the group's last 30 messages are answerable 100% of the time
  (test).
- **SC-002**: A decision mentioned 200+ messages ago is still answerable (via summary or search) in tests.
- **SC-003**: Per-answer context stays under ~6,000 tokens regardless of group age.
- **SC-004**: Erasing a chat's memory removes 100% of its stored messages, summary and notes (test).

## Assumptions

- WhatsApp delivers some recent history on linking; how much is decided by WhatsApp, not by us.
- Storing messages of groups the bot number was added to is acceptable to group members (the number is a
  visible member); operators should tell groups the assistant keeps context.
- One summary per chat is shared by whichever bot is bound to it.
- The low-cost model defaults to the cheapest current Claude model and is configurable.
