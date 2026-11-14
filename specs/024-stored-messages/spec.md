# Feature Specification: Read Stored Messages (admins)

**Feature Branch**: `024-stored-messages` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "When messages are stored in chats, provide the possibility to see them, at least for admins."

## Requirements
- FR-001 Chats → "Messages & memory" shows the chat's stored messages as a conversation (people left, bot right,
  quoted text, "to the bot" marker), newest at the bottom, "Load older", text search.
- FR-002 Admins and owners only (viewers get 403); every look (and search) is recorded in the activity log.
- FR-003 MCP tool `list_chat_messages` with the same rules.
