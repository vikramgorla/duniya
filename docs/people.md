# People

**One place for everyone around your agents: who is who, families and kids, notes, tags and lists.**

**Do it:** panel → **More → People** → tap a person (or **+ Add** for someone new, a kid without a phone too).

**In 30 seconds**
- People who write in a chat that is **on** appear by themselves, one person across WhatsApp and Telegram (the same
  phone number is the same person). Chats that are off store nobody.
- A person's page shows their apps, **Family and ties**, **Notes and timeline**, **Tags and lists** and their chats.
- **Households** group adults and kids. A kid without a phone is never messaged: they are reached through the adults.
- **Merge** two entries of the same human in one tap, with 30 days to undo. **Export** or **Erase** anyone.
- Ask the owner assistant *"who is Ravi's kid?"* or *"which household is Mia in?"*.

![Anu's page: partner of Ravi, parent of Vedika and Kabir, the Chary family, notes, tags and lists, her chats](site/img/card-person.webp)

## The People screen

- **People · Households · Lists** sit at the top; each is a list, and a row opens its page (`#people/<id>`,
  `#people/households/<id>`, `#people/lists/<id>`).
- One row per person: name, their apps (*WhatsApp · Telegram*, or *No app*) and the last contact.
- **Search** finds names (yours, phone contact, business, profile), nicknames, numbers, tags and notes. **Show**
  filters by app (*No app* finds the kids), tag, list or household.
- The line under the search says how many names came from your phone; **Refresh** is optional (it happens by itself
  after a number connects, then daily). **Agents may use the names from your phone contacts** (owner, on by default):
  switch it off if your address book holds private labels; agents then see business or profile names.
- Press **/** anywhere: Find anything lists people, households and lists too.

> [!NOTE]
> Your phone's address book never adds anyone to People: it only gives names. A person comes in when they write in a
> chat that is on, or when you add them.

## A person's page

**Header:** name, number, apps, nickname, birthday, *in People since* and the last contact. **⋯** holds **Edit…**
(name, nickname, number, birthday, *Shared*), and for the owner **Merge…**, **Export** and **Erase…**.

- **Shared:** participants may look this person up through agents (the agents' *find contact* tool). Organizers see
  everyone.
- **Their chats:** the direct chat (or **Set up a direct chat**) and the groups they wrote in. A direct chat's page links
  back with **Person page ›**; names in a chat's *Messages* and in group member lists open the person too.
- **Apps:** each app account with the name it showed and since when.

A number that wrote in a chat but is not in People (for example before you switched the chat on) still has a page with
**Add to People**.

## Family and ties

**Add a tie** → choose *Parent of*, *Child of*, *Partner of*, *Sibling of*, *Works with* or *Something else…* (your own
word and its other side, e.g. *Godmother of* / *Goddaughter of*) → find the person → **Add tie**.

Each tie reads right from both pages: *Anu · Parent of Vedika* shows as *Child of Anu* on Vedika's page. **×** removes
a tie from both.

## Households

1. **Households → + New** (e.g. *Chary family*, an address if you like), or **Add to a household** on a person's page.
2. **Add a person** and choose **Adult** or **Kid**. A person can be in several households (parents who live apart,
   grandparents).
3. A household's page lists adults first, then kids; a kid without any app shows *reached through the adults*.

> [!IMPORTANT]
> A person without an app (a kid) has no chat, so no agent can ever message them. Their page says who reaches them:
> the adults of their households who have an app.

## Notes and timeline

- Write a note and tap **Add note**. Notes show who wrote them: you (your user name) or *Agent* (an AI assistant or the
  owner assistant through the admin tools).
- Agent notes never hold message text: a note that copies one of the person's stored messages is refused, unless your
  logging policy keeps message contents (*verbose*, [Privacy](privacy.md)).
- The timeline also shows what happened: added to People, joined a household, merged, merge undone. Later modules
  (events, orders, surveys) will write here too.

## Tags and lists

- **Tags** are free words (*badminton*, *driver*): type one and press Enter; **×** removes it. They save at once.
- **Lists** are named groups you fill by hand (*Badminton Tuesdays*, *Christmas cards*): **Lists → + New**, then
  **Add a person**, or **Add to a list** on a person's page.

## Merge, export, erase

- **Merge…** (owner): choose the other entry of the same human; their apps, notes, ties, households, tags and lists
  move here. The page then offers **Undo merge** for 30 days. When there is evidence (a verified phone number of one
  person belongs to the other), the page suggests the merge: one tap.
- **Export** (owner) downloads everything stored about the person as JSON: their page, names, notes, ties, households,
  tags, lists and their stored messages.
- **Erase…** (owner, type *erase*): deletes their stored messages in every chat, their direct chat's memory, notes,
  ties, household memberships, tags, list entries and app accounts. The activity log keeps only counts. If they write
  again in a chat that is on, they come back as a new person.

## From Contacts to People

Up to version 2.38 saved names, notes and *Shared* lived on a **Contacts** screen. On the first start of 2.39 they
move into People by themselves: each saved name and *Shared* goes to the person with that number, and each note becomes
a note on their timeline. Nothing to do; old `#contacts` links open People.

## AI assistants and the owner assistant

Admin MCP tools ([Manage from ChatGPT or Claude](admin-mcp.md)): `list_people`, `get_person`, `add_person`,
`update_person`, `add_person_note`, `set_person_tie`, `remove_person_tie`, `set_person_tags`, `merge_people`* ,
`undo_merge`*, `export_person`, `erase_person`*, `list_households`, `get_household`, `save_household`,
`set_household_member`, `list_people_lists`, `save_people_list`, `set_list_member`, `people_names_status`,
`refresh_contact_names`, `set_contact_names_for_agents`* (* needs `confirm_action`).

The [owner assistant](owner-assistant.md) uses the same tools: it reads People directly and every change waits for
your confirmation.

> [!NOTE]
> In this release agents in chats keep their *find contact* tool and see only what you shared. Agent tools for People
> (who is writing, their household) come in a later step.

---
**Next:** [Chats](chats.md) · [Privacy](privacy.md) · [Docs index](README.md)
