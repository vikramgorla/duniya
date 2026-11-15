# Feature Specification: Silent by Default (chat allow-list)

**Issue**: #10 | **Created**: 2026-11-15 | **Status**: Implemented

**Input**: "Ability to not have any agent respond when a chat (group or direct) is not enabled … only whitelisted
contacts and groups must be able to communicate unless explicitly configured to respond to anyone — a strong security
need." Decision: everything off on update; the owner re-enables.

## Requirements
- FR-001 Every chat (group or person) has an On/Off switch; new chats are Off.
- FR-002 Messages from Off chats are dropped before storage and before any model call; only an "ignored" counter is
  kept in memory for the Chats page.
- FR-003 Exceptions: organizers' `!groupid` / `!groups` helpers (no storage, no model); direct messages to an agent
  explicitly set to answer **anyone**.
- FR-004 Scheduled posts and WhatsApp history sync skip Off chats.
- FR-005 Overview says when no chat is on; switching is logged (config, always kept); MCP/API expose `enabled`.

## Tests
`test/allowlist.test.js` (off group/DM ignored with no model call or storage, switching on/off, "anyone" agents,
helpers, schedules, history).
