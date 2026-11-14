# Quickstart: Group Memory and Context Awareness

## Automated

`npm test` — memory scenarios:

1. Unaddressed group messages (and a reply-quote) appear in the next bot request's context.
2. Messages in an unbound group are stored; after binding, they appear in context.
3. History-sync messages are stored once (duplicates ignored) and never answered.
4. Over threshold → summary created in the background and included in context; summariser failure doesn't
   break replies.
5. `memory__remember` saves a note visible in the next context; participant `memory__forget` not offered;
   organizer can forget.
6. `memory__search_history` finds an old message.
7. Panel memory endpoint shows summary/notes/count; erase removes everything.

## Manual

1. In a bound test group, chat for a while without addressing the bot ("train at 9:10", "Rao arrives Sat").
2. `!panduga which train did we agree on?` → answers 9:10.
3. `!panduga remember that the hall key is with Ravi` → confirms; later `!panduga who has the key?` → Ravi.
4. Panel → Chats → Memory: summary (after ~70 messages), notes, count; Erase → bot no longer knows.
