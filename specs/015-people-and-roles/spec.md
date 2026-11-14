# Feature Specification: People & Roles from Group Members

**Feature Branch**: `015-people-and-roles` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "I don't understand how we map organizers and participants in bot/group … make this easily configurable in
a bot by selecting people in a WhatsApp group and assigning the role." Clarified: "Group admins as prefilled default,
but an ability to change if we don't want all group admins or maybe someone else also as organizers."

## User Scenarios
- US1 (P1) In the bot editor, "People & roles" lists the members of each group the bot is in (name from messages
  seen, number, "group admin" badge) with a Participant / Organizer switch. Save applies.
- US2 (P1) When a bot has no organizers yet, the group's WhatsApp admins are pre-selected as organizers with a note;
  the admin can change anyone before saving.
- US3 (P2) Organizers or DM participants who are not in the groups are entered under "People outside these groups".

## Requirements
- FR-001 Members via the channel (`groupMembers`), phone from PN/LID mapping; members whose number WhatsApp hides
  are listed without a switch.
- FR-002 Roles stored as today (`organizers` phone list); no new role model; enforcement unchanged (constitution III).
- FR-003 Names come only from messages already stored for that group.
