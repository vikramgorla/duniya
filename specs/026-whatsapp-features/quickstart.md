# Quickstart

1. `npm test`. `test/whatsapp-features.test.js` covers:
   - role rules, and each tool calling the right channel function;
   - the SSRF guard;
   - reactions and poll votes reaching the context;
   - the admin routes;
   - the real channel against a fake Baileys socket, including encrypted poll votes.
2. On a running install:
   - Make the bot's number a **group admin** of the group.
   - In the panel, open Bots → (bot) → "WhatsApp actions" and check the ticks.
3. In the group, as a participant:
   - `!bot send the flyer https://example.com/flyer.jpg`
   - `!bot make a poll: Lunch? Pizza / Dosa`
   - Vote, then ask `!bot how is the poll going?`
4. As an organizer: `!bot rename the group to Panduga 2027`, `!bot only admins can send for now`, or
   `!bot remove +41 79 …`.
   - The change happens right away.
   - Check Activity: the "WhatsApp actions" category.
5. Chats → (group) → Messages & memory → the **WhatsApp** card shows the members, the invite link (copy or reset), the
   name, the description and the settings.

Media limit: `WA_MEDIA_MAX_MB` (default 16).
