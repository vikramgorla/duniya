# 089 · Lessons from corrections, and learning when to join in

Issue #205 (intelligence features 1 and 3, owner-approved).

## User stories
- As the owner, when I mark an answer 👎 or correct the agent in a chat ("no, it's Chary who drives"), it proposes a
  short lesson; I approve it with one tap (or let it save lessons by itself) and it follows it from then on.
- As the owner, I see, edit, re-scope (all its chats / one chat) and delete an agent's lessons, with a link to the
  message they came from.
- As the owner of an agent that reads groups by itself, I tell it "you didn't need to answer" or "you should have
  answered", and it learns a short rule about when to join in for that chat.

## Acceptance
- Nothing proposed is used before approval unless auto-approve is on; *Learn from my corrections* off: no proposals
  and no lessons in turns.
- Corrections count only from the owner's linked number, in chats that are on, within 15 minutes of the agent's last
  answer there, and only for messages that read as corrections.
- Lessons in a turn: FTS match first, then newest; chat lessons first; at most ~800 characters. Join-in lessons: at
  most 5, only in judged turns.
- Proposals: background model, ≤ 120 tokens out, ≤ 20 per agent per day, usage kind `lessons`; failures logged, never
  block a reply or a rating.
- Join-in feedback: counts per agent + chat (good, needless, missed); needless / missed propose a join-in lesson.
- Erasing a chat's memory deletes its lessons and feedback. Activity notes proposals and approvals without lesson text.
