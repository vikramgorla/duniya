# Spec 049: Prepare a direct chat before the person writes (#92)

The owner assistant found a contact (Vedika) and an agent (Mochi) but could not assign it: a direct chat only existed
once the person had written. Owners want to set up a person's chat in advance.

## User stories

1. **Prepare by number (P1).** *Given* an admin enters a phone number (E.164, or picks a contact) and, with several
   WhatsApp numbers, the number the person will write to, *when* they choose an agent and settings, *then* the chat
   exists before any message: on/off, agent, private to members, model, logging, fallback, spending cap. It is listed
   on Chats as **Waiting for the first message**.
2. **First message matches (P1).** *Given* a prepared chat, *when* the person writes — as `<digits>@s.whatsapp.net` or
   from their LID (`…@lid`), on the prepared number — *then* the message goes to the prepared agent with the prepared
   settings, and later messages (even with the phone hidden) use the same chat id.
3. **Owner assistant in one go (P1).** "assign Mochi to Vedika" → one `prepare_direct_chat` held for one confirm.
4. **Optional intro (P2).** The agent may send a first message, only after an explicit confirm (panel "Send intro
   now" after a preview; admin MCP / owner assistant confirm code), only when the chat is on with an enabled agent;
   the DM privacy line is added once per person.
5. **Validation (P1).** Invalid numbers are refused (letters, no country code, < 8 or > 15 digits). When WhatsApp is
   connected the number is checked: not on WhatsApp → warning, still allowed.

## Requirements

- FR-1 `POST /api/direct-chats` (admin) `{ phone, number, agent, enabled, private, model, logging, fallback, cap }`;
  `enabled` defaults to on for a new chat when an agent is given. `POST /api/direct-chats/check` checks without saving.
  `GET /api/direct-chats` lists prepared chats.
- FR-2 Chat id `<digits>@s.whatsapp.net`, prefixed `<number>#` on other numbers (`src/channels/registry.js`). An
  existing LID chat of that phone with settings of its own is updated instead of creating a second chat.
- FR-3 The router (and the registry before `noteChat`) maps a direct `…@lid` message to a prepared phone chat on the
  same number by `msg.phone`, or by the LID WhatsApp returned when the number was checked, and stores an alias. A LID
  chat with its own settings is never aliased. Aliases are not listed on Chats.
- FR-4 Intro: `POST /api/chats/:chat/intro/preview` returns the text, the privacy line it will carry and a single-use
  token (10 min) bound to that text; `POST /api/chats/:chat/intro { token }` sends it. Admin MCP `send_chat_intro`
  (risky) and `prepare_direct_chat` with `send_intro` (risky only then).
- FR-5 Panel: Chats → "+ Add a direct chat" (phone or contact search, number picker when several, agent, On, Private);
  Contacts → "Set up chat"; "Waiting for the first message" pill; "Send intro…" card.

## Non-functional

- Allow-list unchanged: a prepared chat that is off stores nothing and calls no model (only the arrival time is
  noted for the waiting state, never text). Private chats stay hidden from the owner assistant.
- Small servers: one small cached table lookup per direct message; no new dependencies.
