# 075 · Channel hub: WhatsApp as the first channel

Issue #161 · version 2.35.0

## Why

The owner wants Duniya to grow beyond WhatsApp (a Telegram bot is next). Today WhatsApp is wired through the whole app:
the registry imports Baileys at startup, WhatsApp ids (`@g.us`, `@s.whatsapp.net`, `@lid`) are checked in a dozen
places, the agents' WhatsApp tools are offered whenever a channel exists, and people are phone numbers only. A fresh
install loads Baileys and opens a socket before any number is linked. Phase 1 models WhatsApp as the first channel,
with no new channel yet and no change for owners beyond a Channels list.

## User stories

1. **As the owner of a fresh install**, nothing of WhatsApp runs until I tap **Show the QR code** in Getting started:
   the server uses less memory and opens no connection.
2. **As the owner**, I find WhatsApp under **Settings → Channels**: its state, the memory it uses, my numbers (link,
   add, unlink, remove, direct-message agent), and a switch to turn it off (frees its memory; nothing is unlinked).
   Overview keeps a short WhatsApp card and the status chip, which open this page.
3. **As an owner with a number**, everything works as before: same chat ids, same tools, same answers.
4. **As a developer**, I add a channel by writing an adapter and a catalogue entry; ids, tools, panel list and memory
   measurement follow from it.

## Requirements

- Channel hub with an adapter interface (start/stop, status, send and chat actions, one inbound shape, chat names,
  members, history) and per-channel capabilities; adapters load with `import()` only when set up and on.
- WhatsApp id logic in one module (`src/channels/whatsapp/ids.js`); the rest of the app uses channel helpers
  (`isGroup`, `isDirect`, `phoneOf`, `personOfChat`, `displayId`, `chatKey`, `phoneChat`). Existing ids unchanged.
- Chat tools declare the capability they need; agents only get the tools their chat's channel can do; acting on
  another chat checks that chat's channel.
- People: a channel-neutral person id with identities (channel, external id, phone if known); the same phone joins
  identities automatically; only for chats that are on; no message text.
- Panel: Settings → Channels (real channels only, no "coming soon"), WhatsApp page; Health lists memory per channel;
  admin MCP `list_channels`, `set_channel_enabled` (switching off needs confirmation). Admins may switch a channel
  on; only the owner switches one off.
- Small servers: no socket for a channel that is not set up or off; memory per channel measured once a minute after
  start on the shared tick; no new timers.

## Out of scope

Telegram and other channels; renaming the `whatsapp__` tool names and `whatsapp:` rules (saved agent rules depend on
them); roles keyed by person id; cross-channel linking UI.
