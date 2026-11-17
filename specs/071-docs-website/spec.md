# 071 · Docs and website for today's product

**Issue:** #151 · **Version:** 2.31.1 (patch: docs, website, a removed one-time step)

## Why

After five rounds (calm list → page UI, owner assistant as a full agent, Ask conversation, Find anything, search across
chats, Review & teach, Health/retention, release notes, phone install) and removals (mobile app, plugins, plan usage),
the guides were accurate but ordered by history, and the website was a long list of ~35 features that still mentioned
the mobile app.

## What

- **Guide path:** the docs index is a numbered path an owner follows: Install → Getting started → Connect WhatsApp →
  Add a model → Agents → Chats → Owner assistant → Everyday use, then *Run your server* and *Reference*.
- **Pages:** new `whatsapp.md` (link a number, the numbers card, several numbers), `chats.md` (split from
  `agents.md`: the Chats screen, search messages, earlier messages, direct chats, contacts, names, member tags),
  `everyday.md` (Overview, Find anything, Why didn't it answer, Activity/Usage/Pending, on your phone; replaces
  `phone.md`). `configuration.md` (a "moved" stub) and `phone.md` are deleted. Every page keeps the page template.
- **README:** short hero, 3-line install, one screenshot, eight highlights, links into the guides.
- **Website:** a landing page: hero with the tour video (Pause/Play; still for reduced motion), 3 steps, 8 feature
  tiles (agents, owner assistant, Ask, search & review, phone, safety & privacy, small servers, backups & updates), an
  "also in the box" strip, install (Oracle and Google one-click, one command), FAQ, footer. No external requests;
  375 / 393 / 1440 px, light and dark.
- **Screenshots and video** retaken with `npm run site:shots`; shots and videos nothing uses are removed from the
  repository and from the script.
- **Diagrams:** `architecture` (no "app"), `install-flow` (Getting started) re-rendered; unused `overview` removed.
- **Lean:** the 2.31.0 one-time startup backup in the new format (`newestIsOldFormat` + 30 s timer) is removed; the
  2.31.0 release note no longer promises it. Old-format backups are still refused with a clear message.

## Out of scope

Panel behaviour (only two help links move to `chats.md`).
