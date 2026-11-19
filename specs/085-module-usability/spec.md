# 085 · Usability pass over the module screens

Issue #197. The newest screens (People, Events, Orders, Sending, Surveys, Campaigns, Settings → Modules, Sending pace,
Updates, Channels → Telegram) walked at 393 px and 1440 px, light and dark, as a picky product designer and a
first-time owner.

## User stories
- As an owner on my phone, I see every People section (Events, Orders, Sending, Surveys) without scrolling a switch.
- As an owner, dates, amounts and numbers read the same on every screen, in my locale, with "tomorrow" or "6 days ago"
  when close; overdue orders say Overdue.
- As an owner, from an event or a survey I see what was sent to its people and can send the next message in one tap.
- As an owner, a message's and a survey's page show people as rows with their state and what they got or answered,
  and open the person.
- As an owner, a past event says how many came; registration and duty rows stay calm (quiet ⋯).
- As an owner, a pace preset saves with one tap; update settings save as I change them, with labels.
- Help is one short line; details are behind "?".

## Acceptance
- Module rows from the server carry days as parts (`{ day, before }`), never preformatted ISO dates.
- One money format on the server (agents, module rows, admin MCP) and one in the panel.
- Responsive states for the new or changed screens pass at 375 / 393 / 1440, light and dark.
