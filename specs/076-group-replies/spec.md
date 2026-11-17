# 076: Group replies without a wake word; wake words as tags

Issue: #168 · Status: implemented in v2.37.0

## Problem
People in a group don't repeat the wake word or quote the agent when they answer it ("For now assign it to Chary").
Those replies went unanswered. Wake words were one comma-separated text field.

## User stories
- **US1 (P1) Follow-ups.** After the agent speaks in a group, the next messages reach it without a wake word. It acts
  and answers the ones meant for it, stays quiet otherwise, and stops reading when the group moves to another topic.
  *Accept:* a reply after the agent's question is answered; chatter gets no reply; after the agent judges the topic
  moved on, messages need the wake word again.
- **US2 (P1) Choice per agent.** *In groups*: **When woken + follow-ups** (default), **Only when woken**, **Whenever
  needed** (every message is read; no wake word). *Accept:* each mode behaves as named; invalid values are refused.
- **US3 (P2) Wake words as tags.** Add with Enter or comma, remove with ×, Backspace removes the last; any word, any
  case. *Accept:* tags save as the trigger list; the section shows *Unsaved changes* after a change.
- **US4 (P3) Transparency.** A message the agent read and left alone shows in *Why quiet* as **not for it**; judged
  messages are logged in Activity only when answered.

## Decisions (owner, 17 Nov)
- Follow-ups last until the topic changes, judged by the model (bounded: 15 messages or 30 minutes after it spoke).
- The agent's own model judges (no separate cheap model).
- Default for agents: wake word + follow-ups.

## Out of scope
Photos and voice notes are not judged (they still need waking). Direct messages are unchanged (always addressed).

## Privacy & cost
Only chats that are on reach agents (unchanged). *Whenever needed* makes one model call per group message; the
panel says so. Judged turns use a per-chat rate limit. A judged turn that fails sends no error text.
