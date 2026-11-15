# Spec 050 — Triggers anywhere in a message (issue #94)

**Goal:** natural conversation — "can mochi help with this?" wakes the agent whose trigger is `mochi`.

- A trigger matches anywhere in the message as a whole word (Unicode letters/digits as word characters), any case.
  Triggers starting or ending with punctuation (`!panduga`) only need a boundary on their word-character side.
- Several agents' triggers in one message (DM routing): the earliest occurrence wins.
- A trigger at the very start is an address and is removed from the text the model sees; elsewhere the sentence is
  kept as written.
- Unchanged: @mentions and replies to the agent still wake it; the owner assistant's own DM hand-off still needs the
  trigger at the start, so owners can talk *about* agents.

**Tests:** `test/triggers-anywhere.test.js` (start/middle/end, case, punctuation, whole words only, sentence kept).
