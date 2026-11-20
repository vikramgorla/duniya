# 087 · One answer at a time, and editing messages

Issue #201. In a group with follow-ups, two people wrote a few seconds apart; both messages started an agent turn at
once and the agent posted two GIFs. The owner also wants messages to be editable: by the owner, by the agent when it is
corrected, and from people's own edits.

## User stories
- As a group member, when two of us write at the same moment I see one answer, not two (and never two GIFs).
- As the owner, a burst of messages while the agent works is read together, in one follow-up that knows what it just said.
- As the owner, I can fix an agent's answer in the chat from the panel while WhatsApp allows it (15 minutes), and send
  a correction that quotes it afterwards; admin MCP can do both with confirmation.
- As a group member who corrects the agent ("no, it's Chary"), the agent fixes its last message instead of adding one.
- As a group member who edits my message, the agent's memory follows the edit, and it corrects its answer when the
  meaning changed.

## Acceptance
- Per agent + chat at most one turn runs; up to 8 messages wait (in memory); what waited is one follow-up turn with a
  note; it may stay quiet (`[quiet]` is never sent). Confirm commands keep their own turn. No timers.
- A send is dropped when the agent already sent the same thing in that chat after the answered message arrived: near-
  identical text (Jaccard ≥ 0.85 of words), a second GIF or sticker, the same file, the same reaction on the same message.
  Silence reason `already_answered` (counts only).
- Edits only within the channel's window (`editMinutes`: WhatsApp 15, Telegram 2880); after it: 409 `edit_window` and
  the panel offers "Send a correction". Edited messages are marked; the chat summary is rebuilt.
- `edit_my_last_message`: own last message in the current chat only, within the window, participants and organizers by
  default; capability-based (WhatsApp, Telegram).
- Incoming edits in chats that are on update the stored copy; when the agent answered within 30 minutes and the words
  changed (similarity < 0.8), one judged follow-up turn runs.
- Chats that are off: nothing stored, no turn.
