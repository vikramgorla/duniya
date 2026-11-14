# Plan
`src/channels/registry.js` presents all numbers as one channel (send/typing/chatName/isMember route by chat id;
status lists numbers); `whatsapp.js` parameterised by number/auth dir; panel routes for numbers; backup bundle and
restore include `whatsapp-auth-*`. Memory: each extra Baileys session adds ~40–60 MB.
