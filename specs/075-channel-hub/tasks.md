# 075 · Tasks

- [x] T1 Audit: WhatsApp coupling in code, demo screenshots, RSS of v2.34.1 (fresh and with a number)
- [x] T2 Catalogue + id helpers (`channels/index.js`, `channels/whatsapp/ids.js`); JID checks replaced across core and panel routes
- [x] T3 Hub (`hub.js`) with lazy loaders, on/off, routing, channels(), upkeep and load cost; WhatsApp adapter + session moved
- [x] T4 Chat tools by capability (`chat-tools.js`), `toolsFor(…, { chat })`
- [x] T5 People and identities (`people.js`), router hook, person API channels
- [x] T6 Panel: Settings → Channels → WhatsApp, Overview card and chip, Getting started button, Health rows; routes; admin MCP tools
- [x] T7 Tests: `test/channel-hub.test.js` (ids, hub with fake adapter and fake channel, roles, capability filtering, people, router, no Baileys on a fresh install); registry tests on the hub
- [x] T8 Docs, diagram, site FAQ, retaken shots, check:responsive states
- [x] T9 Version 2.35.0, releases.json; PR, checks, merge, done comment
