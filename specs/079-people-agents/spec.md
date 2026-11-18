# 079 · People step 2: agents and people

Issue #176. Builds on 078 (People, the PRM core). Owner-approved design; decisions are final.

## Why

Agents answer in groups full of people the owner knows, but they knew only a name and a phone number, and People only
held those who wrote. The owner wants agents that know who is writing (household, tags, notes), tools to look people up
and keep notes, roles that follow a person across WhatsApp and Telegram, consent recorded per person, and everyone the
owner knows in People without chores — while each agent sees only the people of its own chats.

## User stories

1. As the owner I open People and see everyone: people who wrote in or are members of chats that are on, every contact
   from my phone, and people I added. The count is total people; a Source filter tells them apart.
2. An agent answering Gita gets a short card: "Gita ("Gits"), Household: Rao family (adult), Tags: driver, Note:
   prefers the 9:10 train". Never message text.
3. An organizer asks the agent "add a note to Hari: brings the speakers"; the agent holds it and the organizer
   confirms with "confirm K7Q2".
4. The Panduga agent cannot look up someone who only wrote in the Carpool group; when I share the Committee list with
   it, it sees the committee too. I can switch an agent to "Everyone in People" or "Nobody".
5. When I write to an agent myself, it sees everyone (like my owner assistant); other members' turns stay scoped.
6. "Organizers = the Committee list": a committee member is an organizer on WhatsApp and Telegram.
7. A person's page shows Consent (privacy notice seen, updates, marketing: yes/no, source, date; unknown = no) and the
   agents that can see them.
8. I Hide someone: they leave lists, search, agent tools and cards; my phone's contacts do not bring them back;
   "Show again" undoes it. A true delete is only via the admin MCP with a confirmation.

## Requirements

- R1 `person_chats` (person, chat, wrote, member, last at): noted when someone writes in a chat that is on (router,
  at most hourly per person and chat) and from the member lists of groups that are on (the existing upkeep refresh: on
  switch-on, on member changes, every 12 h; 2 groups per tick). Leaving a group drops that membership, not the person.
  Chats that are off note nobody.
- R2 Phone contacts become people (source `phone`, a WhatsApp identity for the number, no last contact): after a
  contact sync and on the upkeep tick, ≤ 300 changed contacts per tick, idempotent, never for a number someone (hidden
  people included) already holds.
- R3 `people.source` (chat | phone | owner; phone → chat when they show up in a chat that is on) and `people.hidden`.
  Lists, search, counts, agent tools and cards leave hidden people out; a Hidden filter and Show again.
- R4 People access per agent (`peopleAccess`: own | everyone | off; `peopleLists`): own = people in person_chats of its
  chats plus members of shared lists. Owner turns (sender's verified number linked to an owner panel user) get
  everyone. Decided in code (people-access.js) for tools and cards.
- R5 Agent tools `people__find_person`, `get_person`, `add_note`, `tag_person`, `add_to_list`; participants: find and
  get of Shared people; changes are organizer tools; a change about anyone but the sender is held for "confirm XXXX"
  (runner confirm gate, also for agents without a tool-service confirm). Never merge, hide, export or erase. Old
  `contacts:` rules map to the matching `people:` rules for one release.
- R6 Sender card in the turn (name as the agent may see it, nickname, households, tags, latest 3 owner/agent notes).
- R7 Roles: organizers/participants accept numbers, `p_…` people and `l_…` lists; a number matches directly, a
  person by the number the channel vouches for (or the identity's person without one), a list by membership. Saved
  numbers of people in People move to the person once; merges rewrite role entries.
- R8 Consent `person_consents` (privacy_notice | updates | marketing; yes | no; source; at): the group notice records
  everyone in the group (later members when noted), the DM line records the person; editable in the panel and admin MCP.
- R9 Panel: People list (Source and Hidden filters, total count, the names line gone, one line on where people come
  from), person page (Their groups, Consent, Agents that can see them, Hide / Show again; Erase removed), agent editor
  People (People access, shared lists, organizers/participants as people, lists and numbers).
- R10 Admin MCP: `set_person_hidden`, `set_person_consent`, `list_people` source/hidden, `get_person` consents and
  agents, `update_agent` peopleAccess/peopleLists; `erase_person` stays (owner, confirm) as the only delete.
- R11 Every new query passes check-perf; the workload covers the tools, the card, members and phone sync.
- R12 Removed: the 078 one-release migrations (contacts move, column ALTERs) and the contacts tools.

## Out of scope

Sending to lists (uses consent later), saved filters, modules (events, orders, surveys, campaigns).
