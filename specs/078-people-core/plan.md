# 078 · Plan

## Data (SQLite, `src/core/people.js`)

- `people` gains `name`, `nickname`, `birthday`, `shared` (CREATE TABLE; existing databases get the columns once by
  `ALTER TABLE … ADD COLUMN` in the one-release migration). `identities` gains `name` (the name the channel showed).
- New: `person_ties (id, a, b, kind, label, inverse, created_at)`, `households (id, name, address, created_at)`,
  `household_members (household, person, role)`, `person_notes (id, person, kind note|event, by owner|agent, author,
  text, at)`, `person_tags (person, tag)`, `person_lists (id, name)`, `person_list_members (list, person)`,
  `person_merges (id, kept, merged, snapshot JSON, at)`.
- Names: display name = own name > phone contact > business > profile (contacts resolver, `personInfo`) > the name a
  channel showed > +number > "Unknown". `personInfo` reads the own name from `people.name`.
- `personFor` no longer overwrites a person's phone with a second number (a merged person keeps one phone; the
  others stay on their identities); `personByPhone` also finds people by an identity's phone.

## Operations (`src/core/people-ops.js`)

merge (snapshot of moved rows → undo), undo merge, export, erase, migrate contacts (removed in the next release),
prune undo records older than 30 days (upkeep tick).

## API (`src/panel/routes/people.js`, replaces routes/contacts.js)

`/api/people` list/create/summary/agent-names/refresh-names, `/api/people/:ref` (id or phone) get/put/delete(erase),
notes, ties, tags, merge, merges/:id/undo, export; `/api/households…`, `/api/lists…`. Reading and editing: admin;
merge, export, erase: owner.

## Panel

`people.js` (list with search + filter chips, person page, ⋯ Merge/Export/Erase), `people-groups.js` (Households and
Lists, list → page). `#people`, `#people/<id|phone>`, `#people/households[/<id>]`, `#people/lists[/<id>]`. `#contacts…`
moves to `#people…`. Find anything lists people, households and lists.

## Owner assistant & admin MCP

Admin tools `list_people`, `get_person`, `add_person`, `update_person`, `add_person_note`, `set_person_tie`,
`remove_person_tie`, `set_person_tags`, `merge_people` (risky), `undo_merge` (risky), `export_person`, `erase_person`
(risky), `list_households`, `get_household`, `save_household`, `set_household_member`, `list_people_lists`,
`save_people_list`, `set_list_member`, `people_names_status`, `refresh_contact_names`, `set_contact_names_for_agents`.
The owner assistant gets them by role: reads run, changes wait for the confirm code.

## Small servers

No timers; undo pruning rides on the upkeep tick (bounded). Tables are small (+1–3 MB for thousands of people).

## Risks

- Existing owners' saved contacts: migrated once (own name, note, Shared); checked by tests.
- Contacts agent tools (`contacts__*`) keep their names so agent allow lists keep working; step 2 replaces them.
