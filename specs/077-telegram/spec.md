# 077 · Telegram (bot) as the second channel

Issue #170 · version 2.38.0

## Why

Spec 075 turned WhatsApp into the first channel of a hub. The owner wants Telegram next: it is official and free,
works in groups, and needs no new dependency. Families and clubs that are on Telegram, or on both apps, should get the
same agents, memory and roles there.

## User stories

1. **As the owner**, I open Settings → Channels → Telegram, create a bot in @BotFather and paste its token on the
   one-time secret page. The token is stored encrypted and never shown again. The page then shows the bot
   (@username), *Add to a group*, and what the bot can see in groups (privacy mode), with what to do if agents should
   follow the whole conversation.
2. **As the owner**, Telegram groups show up in Chats like WhatsApp groups, off until I switch them on. The privacy
   notice is posted once when a group goes on, and direct chats get the notice line once.
3. **As a member**, I write to the bot in a group (mention it, reply to it, or use a wake word) or directly, and the
   agent answers as on WhatsApp: quick replies, FAQ, follow-ups, memory, polls, reactions, photos and voice notes.
4. **As an organizer**, I tap *Share my number* in a direct chat with the bot. My Telegram is then linked to the same
   person as my WhatsApp number, so my role applies on both. A contact card someone else forwards never links anyone.
5. **As the owner**, my Telegram reaches the owner assistant once my Telegram is linked to my phone.
6. **As the owner of a small server**, Telegram adds a few MB and opens one connection at a time; nothing of it loads
   until a token is stored.

## Requirements

- Bot API only, over HTTPS with `fetch`. No new runtime dependency, no MTProto, no user accounts.
- Lazy: the adapter is imported only when `TELEGRAM_BOT_TOKEN` is stored and Telegram is not switched off. Saving a
  new token restarts it, and removing the token stops it.
- Updates come from one long poll (`getUpdates`, 50 s) per bot, with backoff on errors. A webhook left by another
  setup is removed automatically. No other timers: group details refresh on the shared upkeep tick, one group per
  tick.
- Sends go through a per-chat queue: messages keep their order, and a 429 waits `retry_after` and retries (at most 3
  tries). Caches are bounded (groups 300, names 2000).
- Chat ids `tg:<bot id>#<chat id>`; WhatsApp ids unchanged. Capabilities: everything the Bot API offers except adding
  people by phone, profiles, blocking, history and member tags.
- People: a phone is passed with a Telegram message only after the sender shared their **own** contact
  (`contact.user_id === from.id`). The identity then joins the person with that phone (people.js). Unlinked senders
  are participants; a direct message refused for its role offers *Share my number* (at most once a day per chat), and
  organizer-only tools say how to link.
- Formatting: WhatsApp markup becomes Telegram entities (no HTML or Markdown parsing), split at 4096 characters.
  Reactions map to Telegram's allowed set.
- A group that Telegram upgrades to a supergroup (new id) keeps its settings, agent and memory.
- Panel: Telegram page (connect, bot card, privacy mode, direct-message agent, replace or disconnect the token). Chats
  say "Telegram" per row; the group section is "Telegram group" without join approval.
- Admin MCP: `list_channels` describes Telegram, `set_secret` names `TELEGRAM_BOT_TOKEN`, and
  `set_telegram_dm_agent` sets the bot's direct-message agent.

## Out of scope (later)

Telegram *Chat Automation* (business connections to the owner's personal account), guest mode, member tags, several
bots, and unlinking a person's Telegram from the panel.
