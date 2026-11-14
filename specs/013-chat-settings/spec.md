# Feature Specification: Per-Chat Bot, Provider and Model; 1:1 Chats

**Feature Branch**: `013-chat-settings` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "You should be able to say which chat uses which provider and model, including auto for both. Also support
chat with individuals, not only groups."

## User Scenarios
- US1 (P1) Chats page lists groups and people (people appear after they message a number; name and number only,
  never message text) with filters All / Groups / People.
- US2 (P1) Assign a bot to a person: that bot always answers them, whatever its DM policy.
- US3 (P1) Per chat model: Same as the bot / Auto (any provider) / <Provider> · Auto / a specific model. The same
  picker is used for bots and defaults.

## Requirements
- FR-001 `provider:auto` resolves to that provider's best model (Anthropic: recommended; others: first chat model,
  a small one for background work).
- FR-002 Per-chat prefs table (model, logging), validated; changes logged as config.
- FR-003 DM routing order: assigned bot → trigger → number default → global default → first bot that accepts.
