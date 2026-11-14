# Feature Specification: AI Helper to Create and Change Bots

**Feature Branch**: `016-ai-bot-helper` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "Once a provider is set up, allow updating agent instructions using AI, and updating the whole agent
(tools, roles, participants) using AI. Also create a new agent using AI." Clarified: default model, with an option to
choose another; review then save.

## User Scenarios
- US1 (P1) Bot editor → "Change this bot with AI": describe the change, Draft, see before/after per field (names
  shown for people), Apply & save or Discard.
- US2 (P1) Bots → "Create a bot with AI": describe the bot, Draft, review, Create.
- US3 (P2) Choose another model for the helper; the AI may ask up to two clarifying questions.

## Requirements
- FR-001 Context for the model: current config, tool lists of the bot's services, group members (name/number/admin),
  templates, plugins. Secrets stay `${NAME}` references.
- FR-002 Output through a `propose_bot` tool (JSON fallback for models without tool use), validated with the bot
  schema; one automatic repair round on validation errors.
- FR-003 The helper never changes group bindings and never adds or changes local tool services.
- FR-004 Nothing is saved without the admin applying it; drafts are logged.
