# 091 · Commitments, relationship cues and per-person preferences

Issue #209 (intelligence features 2, 8 and 9, owner-approved).

## User stories
- As the owner, when someone in a group promises something ("I'll bring the speakers on Friday"), the agent keeps it
  and reminds them gently once when it is due, and notices when it is done; I see and correct it on the person's page
  and the agent's list, and in my morning brief.
- As the owner, when someone says "my daughter Vedika", People suggests the tie; I accept or reject it, and a rejected
  one never comes back.
- As a person, agents answer me in my language, and messages to lists reach me in my hours and on the app I use.

## Acceptance
- Opt-in per agent (Track promises, Suggest family ties); only chats that are on; nothing saved silently for ties.
- Promise extraction only for promise-shaped messages; ≤ 50 model calls per agent per day; one follow-up per promise,
  inside the sending hours, in the chat (or the person's direct chat that is on), or none.
- Done detection only for done-shaped messages in a chat with open promises; the owner can reopen, drop, re-date.
- Preferences: automatic unless the owner sets them; "Automatic" gives them back; language in the sender card;
  sending picks, among the next 20 waiting, the first whose hours include now; preferred app first.
- Erasing a person removes their commitments, preferences and suggestions; erasing a chat's memory its commitments.
