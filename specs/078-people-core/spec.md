# 078 · People (step 1: PRM core)

Issue #172. "People" in the UI, "PRM core" (personal relationship manager) in docs and code comments.

## Why

Owners run agents for family, friends, car-pools and clubs. Today a person is a phone number with a saved name and a
note (Contacts). Owners need one place that knows who is who: kids without a phone, who belongs to which household,
who is whose partner, notes over time, and groupings, so later modules (events, orders, surveys) and agents can build
on it. Contacts move into it; nothing parallel stays.

## User stories

1. As the owner I open **People** and find anyone who wrote in a chat that is on, or whom I added, by name, nickname,
   number or tag; filter by tag, list, household or app; each row shows name, apps and last contact.
2. On a **person's page** I see name and apps at the top, then *Family and ties*, *Notes and timeline*, *Tags and
   lists*, their chats; ⋯ holds Merge, Export, Erase (each confirmed with the panel's dialog).
3. I add a kid with no phone and put them in the "Chary family" household as a kid; agents never message a person
   without an identity (they are reached through a household adult).
4. I say "Ravi is the parent of Mia": Ravi's page shows *Parent of Mia*, Mia's shows *Child of Ravi*.
5. I merge two people (same human on two numbers) in one tap; identities, notes, ties, households, tags and lists move;
   I can undo for 30 days.
6. I export one person (JSON) or erase them (their stored messages, notes, ties, memberships, tags, list entries,
   identities).
7. I ask the owner assistant "who is Ravi's kid?" or "which household is Mia in?" and it answers from People;
   changes it proposes go through the confirm gate. AI assistants (admin MCP) get the same.

## Requirements

- R1 Person: display name, optional nickname, phone (when known), optional birthday (YYYY-MM-DD or --MM-DD), created,
  last contact (newest identity activity). Built on `people` + `identities`; same verified phone = same person.
- R2 People are created only from chats that are on (router, as today) or by the owner (panel, admin MCP, migration).
  Phone address-book names never create people; they stay the name source.
- R3 Relationship: A, B, kind (`parent` ↔ child, `partner`, `sibling`, `works_with`, `custom` with a label and an
  inverse label). Shown from both sides with the right word.
- R4 Household: name, optional address, members with role `adult` | `kid`; a person may be in several.
- R5 Notes: owner notes and agent notes (marked as agent); an agent note that contains a stored message of that
  person is refused unless the logging policy records message contents (verbose). Timeline events (created, merged,
  household joined…) in the same stream; later modules write events.
- R6 Tags (free, lower-case, ≤ 40 chars) and named lists (manual membership).
- R7 Merge: owner only; suggested only on evidence (an identity whose verified phone is another person's number);
  moves identities, notes, ties, memberships, tags, lists; undo for 30 days (pruned on the upkeep tick).
- R8 Export (JSON, incl. their stored messages) and erase per person, owner only.
- R9 Contacts migrate once at startup: own names, notes (→ owner note), Shared → people; the Contacts screen, routes,
  admin tools and wording are removed; the contacts agent tools read People.
- R10 Agent access stays as today in this step (no new agent tools); the data model keeps identities per chat so step
  2 can limit agents to people from their own chats.
- R11 Panel: People under More with Households and Lists (list → page each), person page, Find anything, links from
  chats, messages, group member lists. Budgets kept or raised with a reason; responsive states for each new screen.
- R12 Small servers: CREATE TABLE only, no timers, ~1–3 MB.

## Out of scope

Agent people tools, sender card, roles on people, consent, saved filters, modules (events, orders, lists sending,
surveys, campaigns).
