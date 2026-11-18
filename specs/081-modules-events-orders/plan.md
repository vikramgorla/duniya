# 081 · Plan

| Concern | Decision |
|---|---|
| Frame | `src/modules/index.js`: `MODULES` catalogue (refs + children, `load: () => import()`), `startModules` (startup), `setModuleOn` (setting `modulesOn`, memory measured as RSS delta at load), `need(id)` (409 when off), `moduleRules`, `changeOrHold` / `applyModuleAction`, `moduleSections(kind, id)`, `modulesUpkeep`, `emit` (signals), generic `moveModuleRows` / `restoreModuleRows` / `exportModuleRows` / `eraseModuleRows` |
| Hooks | `tools.js` adds live module tools; `runner.applyPending` handles `local:<module>`; `upkeep.js` runs module upkeep (skipped while memory is tight); `people-ops.js` merge/undo/export/erase; `people.js` deleteHousehold; person/household API `modules` sections |
| Events | `src/modules/events/index.js` (tables `ev_events`, `ev_registrations`, `ev_duties`, `ev_duty_people`), `tools.js` (9 tools) |
| Orders | `src/modules/orders/index.js` (tables `ord_orders`, `ord_lines`, `ord_payments`; setting `paymentMethods`), `tools.js` (4 tools); listens to the `registration` signal |
| Panel API | `routes/modules.js`: `/api/modules`, `/api/modules/tools`, `/api/module/events…` (`/api/events` is the live stream), `/api/module/registrations/:id`, `/api/module/duties/:id`, `/api/orders…`, CSV |
| Panel | Settings → Modules (settings.js), People nav Events · Orders (people.js), `events.js` (lists and pages, loaded on visit), `moduleBlocks` on person, household and event pages, module tool ticks in the agent editor (WhatsApp ticks generalised) |
| Admin MCP | list_modules, set_module_enabled*, list_events, get_event, save_event, delete_event*, register_for_event, update_registration, save_event_duty, list_orders, get_order, create_order, record_payment*, set_payment_methods |
| Indexes | ev_events_starts, ev_registrations_event (tenant, event, status, created), _person, _household; ev_duties_event; ev_duty_people_person; ord_orders_status (tenant, status, due), _event (tenant, event, status), _person, _household, _registration, _created; ord_payments_ord. About 60–80 bytes per registration or order per index |
| Perf | fixture: 20 events, 4k registrations, ~2.7k orders with lines and payments, 200 duties; budgets: event page 15 ms, registration list 15, orders list 20, who hasn't paid 15 (measured 4.6 / 5.9 / 8.8 / 4.5); tag filter pinned to `person_tags_tag`; Orders → All allowed as newest-first with LIMIT |
| Small servers | nothing loads while off; no timers (upkeep tick: one reminder query a day); lists capped (200 events, 200 orders) |
| Panel budget | first screen +0.1 KB (62 600), total +6.8 KB (196 500) |
| Migrations | removed: migratePeopleChats, migrateRolesToPeople, people source/hidden ALTER, contacts: rule mapping. Added: none (new tables via CREATE TABLE) |
| Dependencies | none |
