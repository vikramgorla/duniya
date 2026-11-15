# Research: Baileys 7.0.0-rc14 APIs used

Checked against `node_modules/baileys/lib/**/*.d.ts` and the JS.

| Need | Baileys call |
|---|---|
| Text, quote | `sock.sendMessage(jid, { text }, { quoted: WAMessage })`. A minimal `{ key, message: { conversation } }` is enough to quote. |
| Image / video / GIF / sticker / audio / document | `sendMessage(jid, { image \| video (+ gifPlayback) \| sticker \| audio (+ ptt, mimetype 'audio/ogg; codecs=opus') \| document (+ fileName, mimetype), caption })` with a **Buffer**. We never pass `{ url }`: Baileys would fetch it without our SSRF guard. |
| Location | `{ location: { degreesLatitude, degreesLongitude, name, address } }` |
| Contact | `{ contacts: { displayName, contacts: [{ vcard }] } }`. The vCard 3.0 needs `TEL;waid=<digits>:+<digits>` so WhatsApp links it. |
| React | `{ react: { text, key } }`. An empty text removes the reaction. |
| Edit | `{ edit: key, text }` (own messages only) |
| Delete for everyone | `{ delete: key }` (others' messages need group admin) |
| Read, presence | `readMessages(keys)`, `sendPresenceUpdate('composing' \| 'recording' \| 'paused' \| 'available' \| 'unavailable', jid)` |
| Poll | `{ poll: { name, values, selectableCount } }`. Baileys adds `messageContextInfo.messageSecret` (32 random bytes). `selectableCount: 1` → `pollCreationMessageV3`; 0 → `pollCreationMessage` (multiple choice). |
| Poll votes | Arrive as `pollUpdateMessage { pollCreationMessageKey, vote: { encPayload, encIv } }`. Baileys 7's own decryption is commented out in `process-message.js`, so we call `decryptPollVote(vote, { pollEncKey: messageSecret, pollCreatorJid, pollMsgId, voterJid })` ourselves. Options are matched by `sha256(optionName)`. `getAggregateVotesInPollMessage` aggregates the same way; we keep a per-voter map instead, so a changed vote replaces the earlier one. |
| Groups | `groupCreate(subject, jids)`, `groupInviteCode`, `groupRevokeInvite`, `groupParticipantsUpdate(jid, jids, 'add'\|'remove'\|'promote'\|'demote')` (returns `[{ jid, status }]`), `groupUpdateSubject`, `groupUpdateDescription`, `groupSettingUpdate(jid, 'announcement'\|'not_announcement'\|'locked'\|'unlocked')`, `groupJoinApprovalMode(jid, 'on'\|'off')`, `groupLeave`, `updateProfilePicture(jid, Buffer)`, `groupMetadata` (`announce`, `restrict`, `joinApprovalMode`, `participants[].admin`) |
| Profile | `profilePictureUrl(jid, 'image')`, `fetchStatus(jid)` → `[{ status: { status, setAt } }]`, `updateProfileName`, `updateProfileStatus` |
| Block | `updateBlockStatus(jid, 'block' \| 'unblock')` |

## Notes

- **Key normalisation.** `cleanMessage()` rewrites `reactionMessage.key` and `pollCreationMessageKey` to our point of
  view (`fromMe`, `remoteJid`, `participant`) before `messages.upsert`.
- **PN and LID addressing.** The jids used to sign a vote are whichever the voter's client used. That can be the
  PN or the LID form, of both the creator and the voter, so all combinations are tried. Phone numbers come from
  `*Alt` fields or `signalRepository.lidMapping.getPNForLID`, as in existing code.
- **Re-sends.** `getMessage` in the socket config lets Baileys re-send stored polls on retry receipts.
