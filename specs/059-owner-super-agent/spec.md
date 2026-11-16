# Feature Specification: The owner assistant as a super agent

**Feature**: 059-owner-super-agent · **Issue**: #119 · **Release**: v2.20.0 · **Status**: implemented

## Goal

Owner request: "The owner assistant should behave like a super agent." *Send me a gif* in the owner's own chat failed
because the assistant only had the admin tools. Follow-ups from the owner in the same release: give it the same
configuration editor as agents (character etc.), and fold the weekly summary and owner alerts into it.

## User stories

1. **Full agent in the own chat (P1)** — A linked user's direct chat gets what an agent has, from the agent machinery
   (no copy): global tool services (each service's role defaults, opt-out per service in its editor), WhatsApp actions
   (messaging: media/GIF, location, contact, react, reply, edit, delete, poll, poll results, group/profile info),
   photos, PDFs and voice notes in (media queue), voice replies, picture creation, memory (notes per user, never in a
   chat's memory). "Send me a gif" = GIF service search + `whatsapp__send_media` in the own chat, no confirm.
2. **Acting in other chats (P1)** — Owners and admins can send a text (`send_message`), GIF, photo URL, poll, location,
   … into a chat that is on and not private, by group name, contact name or id (existing name resolver). Every such
   send is held: preview + `confirm CODE` (WhatsApp) / Confirm (panel). Refused for chats that are off or private,
   also when switched off between preview and confirm. A person who never saw the DM privacy line gets it once.
   Read-only actions there (poll results, group info, profile) run directly.
3. **Roles in code (P1)** — owner/admin = the agent "organizer" set; viewer = "participant" set, own chat only, no
   sends elsewhere. Group administration WhatsApp actions, contacts tools and chat-history search are never given.
   Service tools named `confirm` / `*_confirm` / `confirm_*` or annotated `destructiveHint: true` are held for a code.
   Admin tools keep their confirm gate.
4. **Built-in agent record (P1)** — reserved id `owner-assistant`, always present, not deletable, not assignable to
   chats, reached only through the owner hand-off (never routed). The agent editor shows: name, description,
   character (appended to the built-in instructions), model + fallback, memory, tool services (global + own), WhatsApp
   actions (owner set), photos & voice, alerts, spending cap, schedules, timezone, history size, max tokens. Hidden:
   chats, triggers, people, DM policy, quick replies/FAQ/welcome, confirmation setup, test console. AI helper and diff
   work. Fixed fields are forced on save.
5. **Schedules and weekly summary (P2)** — its schedules run on the agent scheduler tick (also while agents are paused)
   and go to every linked owner and admin in their own chat; a prompt schedule is answered by the assistant with the
   user's role (SKIP sends nothing). The weekly summary is its `weekly-summary` schedule (default on, Monday 09:00,
   counts only, same text code); with nobody linked it goes to the Alerts number.
6. **Alerts (P2)** — the alert number is the record's `alerts.to` (Alerts section; only the owner changes it); alerts
   stay event-driven.
7. **Admin MCP (P2)** — `get_agent` / `update_agent` / `run_schedule_now` work on `owner-assistant`; `list_agents`
   marks it `builtin`; `preview_weekly_summary` kept; `set_owner_alerts`, `get_owner_alerts`, `send_weekly_summary`
   removed (folded).

## Acceptance

- `test/owner-super-agent.test.js`: GIF path (fake MCP service + fake `sendMedia`), cross-chat confirm, off/private
  refusal (also after preview), privacy line, viewer/admin limits, service confirm tool held, Ask-box confirm, memory,
  photo through the queue while the own chat is off, own schedules to linked owners/admins.
- `test/budget-weekly.test.js`: weekly summary as a schedule (preview, run now, once per day slot, paused), alert
  number owner-only, other agents never get it, built-in not deletable/assignable.
- `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive`, `node scripts/ci-checks.mjs` pass.

## Out of scope

Asking another agent to act in its chat (its own tools would run without a preview — not trivial safely); forwarding
a photo the owner just sent into another chat; quick replies/FAQ for the owner assistant; migrating the old
`ownerAssistant.model`, `alertsTo` and `weekly` settings (owner: defaults are fine).
