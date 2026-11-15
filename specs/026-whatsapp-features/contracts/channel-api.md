# Channel API additions (026)

The session (`whatsapp.js`) takes a raw jid. The registry takes the app chat id (`[<number>#]<jid>`) and routes it.
Unless noted, a method returns `{ msgId }` or `{ ok: true }`. Errors carry `status` (400 bad input, 409 not
connected).

A message reference `ref` is `{ msgId, fromMe, participant?, text? }`.

| Method | Arguments | Returns / notes |
|---|---|---|
| `sendMedia` | `chat, { kind, url?, base64?, mimetype?, caption?, fileName?, voiceNote?, quote? }` | `{ msgId, mimetype, bytes, asStill }`. kind is image, gif, video, sticker, audio or document. |
| `sendLocation` | `chat, { latitude, longitude, name?, address? }` | |
| `sendContact` | `chat, { name, phone, org? }` | |
| `send` | `chat, text, { quoted? \| quote?: ref }` | |
| `react` | `chat, ref, emoji` | An empty emoji removes the reaction. |
| `editMessage` | `chat, msgId, text` | |
| `deleteMessage` | `chat, ref` | |
| `markRead` | `chat, refs` | |
| `presence` | `chat, kind` | |
| `sendPoll` | `chat, { name, options[2..12], multi }` | Stores the poll. |
| `groupInfo` | `chat` | `{ subject, description, size, announcement, locked, joinApproval, participants: [{ phone, jid, admin: 'superadmin' \| 'admin' \| null }] }` |
| `groupCreate` | registry: `(number, subject, people)`; session: `(subject, people)` | `{ id, subject }` |
| `groupInviteLink`, `groupRevokeInvite` | `chat` | `{ link }` |
| `groupParticipants` | `chat, people, action` | `[{ who, status, ok }]` |
| `groupSubject` | `chat, text` | |
| `groupDescription` | `chat, text` | |
| `groupPicture` | `chat, { url \| base64 }` | |
| `groupSettings` | `chat, { announcement?, locked?, joinApproval? }` | |
| `groupLeave` | `chat` | |
| `profile` | `chat, who` | `{ jid, phone, about, pictureUrl }` |
| `block`, `unblock` | `chat, who` | |
| `setProfileName`, `setProfileStatus` | `chat, text` | |

## Incoming messages

`kind: 'text'` messages also carry `media` and `caption`. Two kinds are new:

- `{ kind: 'reaction', target, emoji }`
- `{ kind: 'poll_vote', pollId, selected: [names] }`
