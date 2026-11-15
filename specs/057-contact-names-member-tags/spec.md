# Feature Specification: Names instead of numbers, group member tags, automatic upkeep

**Feature**: 057-contact-names-member-tags · **Issue**: #110 · **Release**: v2.18.0 · **Status**: implemented

## Goal

Owner report: "When I look at an agent, I only see numbers even if they are contacts who I know. I sometimes see
names, probably their WhatsApp profile name. Can you also pull group member tags?" Plus the owner's rule that came out
of it: **no chores for the owner** — what the server can do or retry itself happens automatically.

## Root causes (verified in Baileys 7.0.0-rc14)

1. One `wa_name` per contact from `name || verifiedName || notify`. Address-book names come with `contacts.upsert`
   (app-state `contactAction`, history chats); every message triggers `contacts.update` with only `notify`, which
   overwrote the address-book name with the profile name.
2. `lidContactAction` entries (id `…@lid`, no phone) were dropped.
3. Panel lists named people only from push names seen in the chat; LID members showed as "number hidden", and the mobile
   app showed LID digits as phone numbers.
4. With `syncFullHistory: false` Baileys syncs app state fully only at link, later only on `server_sync`
   notifications, so lost names never came back.
5. Member tags were not read.

## User stories

1. **Names (P1)** — Everywhere a person is shown (agent people list, Chats, group members, stored messages,
   Activity, owner assistant, alerts, insights, mobile) the panel shows: own name > phone contact name > business
   name > profile name > `+number`; a hidden number shows *Unknown (hidden number)* or the profile name, never LID
   digits.
2. **Automatic names (P1)** — Address-book names refresh by themselves after a number connects and daily; once per
   number a full contacts snapshot restores names lost to the old bug. *Refresh now* (Contacts, admin MCP) is optional.
3. **Member tags (P1)** — For chats that are on, each member's tag is kept and shown next to names; agents see
   "Priya (tag: Driver)" in the turn and recent messages.
4. **History retries (P1)** — An unanswered #91 load retries by itself; the panel says it is waiting and will retry.

## Requirements

- **FR-001** `contacts` keeps `book_name`, `biz_name`, `push_name` separately; each kind only replaces the same kind.
  Migration: old `wa_name` → `push_name` (dropped column; the snapshot refills book names).
- **FR-002** `contact_lids` keeps names keyed by LID and the LID→phone map. Pairs come from `lid-mapping.update`,
  history `lidPnMappings`, contacts with `lid`+`phoneNumber`, message `participantAlt`, group metadata and Baileys'
  LID store (`getPNForLID`, up to 300 unmapped per pass). When a pair arrives, the LID's names move to the phone row.
- **FR-003** One resolver `personInfo({ phone, jid, fallbackName })` → `{ phone, name, label, source, hidden }`;
  `chatTitle(chat)` for 1:1 chat titles. All panel/owner views use it. A fallback that is only the number is no name.
- **FR-004** Agents never receive address-book names: the model sees the name seen in the chat (profile name).
- **FR-005** Names refresh: `resyncAppState(['critical_unblock_low'])` when due (30 s after connect, then every 24 h,
  at most every 10 min); the first time per number (and when `NAMES_SCHEMA` changes) the collection's stored version
  is cleared so WhatsApp sends a snapshot. Failures are logged and retried at the next due time.
- **FR-006** Member tags, newest wins (label timestamp, else message time), empty label = removed, chats that are on
  only, erased with the chat's memory. Sources: the message's own `contextInfo.memberLabel` (any message type; never
  a quoted message's), `GROUP_MEMBER_LABEL_CHANGE` protocol messages (live and history), Baileys'
  `group.member-tag.update`, history `Conversation.participant[].memberLabel`, and raw `<participant>` nodes of the
  group metadata query (defensive: attrs `label` / `member_label` / `tag` / `member_tag`, or such a child node; plain
  text, 30 chars).
- **FR-007** Diagnostic for #62: the attribute and child-node *names* of `<participant>` nodes are logged once per app
  version (never values or ids).
- **FR-008** History retries: backoff 2 min, 15 min, 1 h, 6 h, 24 h ×3; due times in kv (survive restarts); due now
  (≥ 1 min after the last try) when the phone is seen online (connection opens, a message from the owner's phone);
  a `no_anchor` chat loads after its next message; stops when messages arrive or the chat is off.
- **FR-009** Shared upkeep (`upkeep.js`) on the scheduler's existing 30 s tick: ≤ 2 history retries, the names refresh
  of one number when due, ≤ 2 group member lists (chats on; due on start, after a participants update, then every
  12 h). Names and groups are skipped while memory is tight (`optionalPaused`).
- **FR-010** Timers: before 12 app intervals (+ SSE pings per connection); after 12 — no new interval or per-chat /
  per-number timer (only the existing per-load page timeout of #91).

## What is and isn't possible (honest)

- Address-book names reach a linked device only through app-state sync; whether `critical_unblock_low` snapshots
  carry all contacts on every phone needs a real-account check (#62).
- There is no documented query for all member tags; tags appear when a person writes, changes it, from loaded
  history, or from the member list if WhatsApp includes it there (field name unknown; the diagnostic tells).

## Out of scope

Showing address-book names to agents; editing member tags from Duniya (Baileys has `updateMemberLabel`, not exposed).
