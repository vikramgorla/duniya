# 079 · Plan

| Concern | Decision |
|---|---|
| Where | `src/core/people-access.js` (person_chats, scope, roles, sender card, consent, phone sync, one-time migrations), `src/core/people-tools.js` (agent tools, held changes), tables in `people.js` (`person_chats`, `person_consents`, `people.source`, `people.hidden`) |
| Agent access | in code: `peopleScope(agent, { owner })` → null / all / { chats, lists }; `canSee`; `listPeople({ scope })` filters through `person_chats_chat` and list members |
| Owner turns | router: `userForPhone(msg.phone)?.role === 'owner'` → `ctx.ownerTurn` |
| Confirm gate | runner `ctx.hold()` → pending row `server = local:people`; `applyPending` applies it (WhatsApp "confirm XXXX" and the panel's Pending) |
| Members | upkeep group refresh (existing, 2 per tick, 12 h, on member change) → `noteMembers` |
| Phone contacts | `syncPhonePeople` after a contact sync and each upkeep tick; cursor (updated_at, phone) in kv; index `contacts_updated` |
| Roles | `inRole(entries, { phone, person })`; `roleIn(agent, phone, person)` in agents.js; router, chat tools, agent people page |
| Consent | privacy-notice.js calls `noticePostedInGroup` / `noticeSeenInDm` |
| Small servers | no timers (upkeep tick), bounded batches (300 contacts, 2 groups), +~1 KB per person in person_chats/consents; indexes: `person_chats_chat`, `people_source`, `people_hidden` (partial), `contacts_updated` |
| Lean code | contacts tools and the 078 migrations removed; `contacts:` rule mapping and the 079 migrations are one release only |
| Panel budget | +2 KB total (picker, People access, Consent, agents, Hide, filters) |
| Small servers / perf | new queries pass `npm run check:perf`; budgets added: sender card, people tool find |
| Dependencies | none |

Migrations to remove in the next release: `migratePeopleChats`, `migrateRolesToPeople`, the people `source`/`hidden`
ALTER block in people.js, the `contacts:` → `people:` rule mapping in people-tools.js.
