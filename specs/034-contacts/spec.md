# Spec 034 — Contacts (issue #11)

## Goal
One contact list: names synced from the linked WhatsApp phone(s) plus the owner's own entries, which agents can use
to look people up ("what's Ravi's number?").

## Decisions
- Sync: Baileys `contacts.upsert`, `contacts.update` and history contacts → WhatsApp name per phone number. LID-only
  contacts without a phone number are skipped. Groups are ignored.
- Own entries: name, phone (country code), note. Removing an own entry keeps a synced WhatsApp name.
- **Shared** flag per contact, off by default (synced contacts are never shared automatically). Participants only
  ever see shared contacts; organizers see all (owner decision on #11: organizers manage, everyone can look up what is
  shared). The list is global for all agents.
- Tools: `contacts__find_contact` (everyone), `contacts__save_contact` and `contacts__remove_contact` (organizers).
  An agent role's explicit `contacts:` rules replace the defaults; deny rules always win.
- Panel: Contacts page (search, add, edit, share toggle, remove); viewers read, admins write. Admin MCP:
  `list_contacts`, `save_contact`, `remove_contact`.
- Tables on the page turn into cards on phones (`table.stack`, reused by the responsive pass #1).

## Acceptance — `test/contacts.test.js`
