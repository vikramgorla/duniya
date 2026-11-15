# Plan

- **Channel** (`src/channels/whatsapp.js`):
  - Action methods on the Baileys socket.
  - `deps` (makeSocket, authState, fetchVersion, media) so tests can use a fake socket.
  - `normalize()` returns `kind: text | reaction | poll_vote`, with media placeholders and `caption`.
  - Poll creation messages are kept in `wa_polls`, and votes are decrypted with `decryptPollVote`. Every PN/LID
    combination of creator and voter is tried.
  - `getMessage` serves stored polls.
- **Registry** (`src/channels/registry.js`): `CHAT_ACTIONS` route `(chat, ...)` to the session with the raw jid.
  `NUMBER_ACTIONS` (profile, block, …) go to the chat's number. `groupCreate(number, …)` returns the app-level chat id.
- **Media** (`src/core/media.js`): `loadMedia(kind, {url|base64})` with `checkUrl`, a guarded `dns.lookup`, redirect
  re-checks, a streaming size cap and type sniffing.
- **Storage** (`src/core/db.js`):
  - New column `messages.sender_jid`, needed for reaction and delete keys in groups.
  - New tables `wa_reactions` and `wa_polls`.
  - Helpers: messageByMsgId, lastBotMessage, saveReaction, savePoll, savePollVote, pollTally, etc.
- **Router** (`src/core/router.js`):
  - `setWhatsAppChannel(channel)`.
  - Reaction and vote events are recorded, never answered.
  - Caption wake-up.
  - ctx carries `msgId` and `senderJid`.
- **Context** (`src/core/memory.js`): `chatEventsSummary()` produces the `<reactions_and_polls>` block.
- **Tools** (`src/core/whatsapp-tools.js`):
  - Definitions, role defaults and `whatsappRules()`.
  - Target-chat resolution; message lookup by id or words.
  - Logging.
  - Wired into `toolsFor()` after the memory tools.
- **Events** (`src/core/events.js`): category `whatsapp`.
- **Panel**:
  - Routes in `server.js`; four admin MCP tools in `admin-tools.js`.
  - In `index.html`: a "WhatsApp actions" fieldset (a tick per role, writing `whatsapp:` rules) and a WhatsApp card
    in the chat view.
- **Tests**: `test/whatsapp-features.test.js`; fakes added to `test/harness.js`.
