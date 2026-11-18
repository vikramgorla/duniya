# 080 · People step 3a: human-like pace and read receipts

Issue #180. Builds on 078/079 (People). Owner decisions are final. Step 4 (sending to lists) will use the same pacing
service; list sending itself is not part of this change.

## Why

Duniya answered at machine speed: no read receipts, a fixed "typing…" flash, replies the instant the model finished.
On WhatsApp that looks like a bot and, for sending to many people later, it is a risk for the number. The owner wants
Duniya to read, type and send like a person, within ranges the owner controls.

## User stories

1. Settings → Sending pace: I pick Careful, Normal (default) or Faster, or Custom ranges: gap between messages
   (min–max), typing speed (characters per second, jitter), read-receipt delay (min–max), new 1:1 chats a day, sending
   hours (default 09:00–20:00, my time zone), a longer pause every N messages. Defaults: 40 new chats a day,
   09:00–20:00, gaps 45 s–3 min. A switch turns read receipts off.
2. In chats that are on, messages get blue ticks after a random delay within the read range, before the agent types;
   messages the agent leaves alone are read too, a little later. Chats that are off are never touched.
3. Before a reply, "typing…" shows for a time that fits the reply (length ÷ typing speed, with jitter), at most 8 s, so
   answers stay timely; the model works while the message is being "read".
4. An intro to a new 1:1 chat counts toward today's new chats; at the cap it is refused and the panel says why. A number
   linked on this server in the last week starts lower and grows over the week (warm-up).
5. The admin MCP reads and changes the pace (`get_sending_pace`, `set_sending_pace`).

## Requirements

- R1 Presets map to complete ranges; custom ranges are validated (bounds, min ≤ max, HH:MM, start ≠ end); errors name
  the field. Owner/admin change, viewers read.
- R2 Read receipts only for chats that are on, channels with read receipts (WhatsApp; Telegram bots have none), and
  incoming messages from others; a chat switched off before its receipt is due is dropped.
- R3 No timer per message: a bounded in-memory queue (500) drained on every incoming message and on the scheduler's
  existing 30-second upkeep tick; an answered message waits for its own receipt inside its turn.
- R4 Random values are bell-shaped within the range (mean of three draws), never fixed intervals.
- R5 Typing ≤ 8 s; gaps and pauses are for list sending (step 4) and shown as an estimate now.
- R6 Daily cap per number (owner's time zone day), warm-up for 7 days after a link on this server.

## Out of scope

List sending, stop signals (STOP replies, blocks) and reminders: step 4.
