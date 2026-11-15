# Spec 054 — Quick replies, welcome message and FAQ auto-answers (issue #102)

**Goal:** the answers organisers give every week (how rides work, the group rules, where we meet) come instantly from
text they wrote once: **no AI, no tokens**. Configured per agent in the panel; a group can override the welcome.

## Quick replies
- A list of `{ command, text, who }`. `command` is one word (2–40 characters, e.g. `!rides`), stored lowercase; it
  matches when it is the whole message or its first word (any case, trailing `?.,:;` ignored), also after a leading
  trigger or @mention ("!carpool !rides").
- `who`: `everyone` or `organizers`. A participant using an organizer command gets no built-in answer; the message is
  handled as usual (model when addressed, else silence).
- Placeholders: `{name}` (sender), `{group}` (group name; "this chat" in a direct chat), `{date}` (today in the
  agent's timezone, e.g. "Sunday 15 November 2026").
- Commands do not need a trigger. They are checked after the allow-list, the agent's enabled state and confirm
  commands (`confirm ABCD` is never a quick reply), and before the model. Rate limits apply.
- Built-in `!help` (agent field `help`, off by default): lists the quick replies the sender may use and how to wake the
  agent. An owner-defined `!help` quick reply wins.

## Welcome message
- Agent field `welcome { enabled, text, rules }`; per-chat override `inherit | on | off` (Chats → Welcome new members).
  Empty text → "Welcome {name} to {group}! 👋". `{name}` = @mentions of the new members, `{rules}` = rules (appended
  after a blank line when the text has no `{rules}`), `{group}`, `{date}`.
- Trigger: Baileys `group-participants.update` with action `add` (this Baileys version reports added, invite-link and
  join-request members all as `add`, from stub types GROUP_PARTICIPANT_ADD / _INVITE / _ADD_REQUEST_JOIN); `invite` and
  `join` are accepted too. The linked number itself is skipped.
- Only when the chat is **on**, the agent is enabled, the app is not paused and the welcome is on for that chat.
- Once per person per group: `welcome_seen` keeps sha256(chat | phone or jid) — no names or numbers in clear.
- Bulk: joins are collected for 5 s (`WELCOME_DELAY_MS`) and sent as one message naming up to 20 people ("and N
  others"); at most one welcome per group per minute (`WELCOME_GAP_MS`), later joins wait for the next one.
- Privacy notice first: when the notice is still due for the group (just switched on), it is posted before the welcome.
- Counted as a reply (weekly summary), usage kind `welcome` with cost 0; activity says how many were welcomed (no people).

## FAQ auto-answers
- Agent field `faq { items: [{ questions[], keywords[], answer }], strictness: strict | normal, wholeGroup }`.
- Matching on normalised text (lowercase, accents removed, letters/digits only). Per entry: 1.0 when a question phrase
  is contained; else the share of the question's content words (stop words in en/fr/de/it ignored; at least two
  shared words unless the question has one); keywords: the share of keywords present. Score = the best of these.
  Normal needs 0.6, strict 0.95. The best entry above the threshold answers.
- Only for messages that would wake the agent (trigger, @mention, reply, direct message), or every group text message
  when `wholeGroup` is on; never for photos/voice notes.
- No match: the agent proceeds normally and the system prompt carries the FAQ as reference context (capped at 1,500
  characters).

## Everywhere
- Usage: `quick reply` / `faq` / `welcome` rows, provider `built-in`, 0 tokens, cost 0 (priced `free`); spending caps
  unaffected; silences and insights unchanged; replies counted for the weekly summary.
- Test console (and `test_agent`): returns `path` = `quick` | `faq` | `model` and shows "Quick reply !rides · no AI",
  "FAQ answer · no AI" or the model.
- AI helper may propose `quickReplies`, `help`, `welcome`, `faq` (visual diff section "Quick replies, welcome & FAQ").
- Admin MCP / owner assistant: `set_agent_quick_answers` (partial update), `set_chat_settings.welcome`.
- Templates (except New agent): `!rules` (car pooling also `!rides`), `help: true`, welcome on with a short text, FAQ
  empty.

**Tests:** `test/quick-replies.test.js` (quick reply before the model, leading word, after a trigger, role restriction,
placeholders, `!help`, FAQ match / no match / strictness / whole group / context, 0-cost usage, test console path,
validation, welcome once per person with mention and rules, bulk combined, chat off / agent off / override, privacy
notice first, hashed storage, channel event mapping, admin tool).
