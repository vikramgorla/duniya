# Feature Specification: Multiple WhatsApp Numbers

**Feature Branch**: `012-multiple-numbers` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "Support multiple WhatsApp numbers."

## User Scenarios
- US1 (P1) The owner adds a number with a name, links it by QR or pairing code, and sees each number's state on
  Overview. Admins can reconnect/unlink; the owner can remove extra numbers.
- US2 (P1) Groups and people on every number appear on the Chats page (with the number's name) and can be assigned
  to bots; replies go out from the number the chat belongs to.
- US3 (P2) Each number has its own default bot for direct messages.

## Requirements
- FR-001 One linked-device session per number; auth in `whatsapp-auth` (first) or `whatsapp-auth-<id>`.
- FR-002 Chat ids: first number unchanged (no migration); others `<id>#<jid>`.
- FR-003 Backups include every number's session.
- FR-004 Removing a number unlinks it and deletes its session; the first number can only be unlinked.
