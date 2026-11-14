# Contract: Channel Interface

A channel adapts a messaging transport. `src/channels/whatsapp.js` is the only implementation today.

| Method | Purpose |
|---|---|
| `start(onMessage, { onHistory })` | connect; call `onMessage(msg)` for each live inbound text message and `onHistory(msgs)` for history batches (store-only) |
| `send(chat, text, { quoted })` | send a text reply; throws if not connected |
| `typing(chat)` | optional typing indicator |
| `listChats()` | `[{ id, name, size }]` of groups |
| `chatName(chat)` | group subject or "" |
| `isMember(chat, phone, jid)` | membership check for DM policy |
| `status()` | `{ status, me, since, lastError, pairingCode, qrDataUrl }` |
| `pair(phone)` | request a pairing code |
| `logout()`, `restart()` | unlink / reconnect |

`status` ∈ `starting | qr | open | reconnecting | logged_out`.

Inbound message shape: see [data-model.md](../data-model.md#normalised-inbound-message-channel--router).
Own messages, status broadcasts, newsletters and non-text messages without captions are dropped.
