# 093 · Plan

- `src/core/autonomy.js` (new, the one place): `AUTONOMY`, the risk table (People notes / tags / lists low; events
  register_someone, update_registration, assign_duty, orders mark_paid / refund, sending send_to_list high; other
  built-in high), name rules for remote tools, `changeTools` (preview / confirm / undo of a service: the agent's
  `confirm` settings, else `*_preview` next to `confirm`), `mayChangeWithoutAsking`, `isAgreement`, `autonomyNote`,
  the tool-result notes. `matchesAny` moved to `config.js` (shared helper).
- `runner.js`: `autonomyNote` replaces the organizer / confirm wording; `ctx.hold` applies low-risk held changes at once
  (and returns the "held" text otherwise, moved here from People and modules); previews: apply now (Duniya calls the
  confirm), or `[held]` code (agent confirm settings), or wait note; `confirmGate` for a model's own confirm calls;
  Activity `change.auto`.
- `tools.js`: meta `change` / `confirmTool` / `undo` per MCP tool. `owner-assistant.js` reuses `isConfirmTool`.
- `schema.js`: `autonomy` (default `clear`), `risk { low, high }`. `ai-builder.js`: the field, no confirmation rules
  in prompts. `db.js`: `listActivity({ type })`, index `activity(type, id)` (~1 MB per 50k rows); check-perf workload.
- Panel: Tools section choice (three `.choice` buttons, the rule line, "?" help, link to Activity); agent page row
  shows it; Activity `#activity/type=…` chip and live filter; label *Changed without asking*.
- Admin MCP descriptions (`update_agent`, `list_activity` type). Docs: agents.md section (examples, enforcement, risk
  overrides), diagram `tool-permissions`, privacy, architecture, admin-mcp, SECURITY, README, website.
- Small servers: no timers, no new dependencies; one extra MCP call per auto-applied change (fewer model rounds).
- Deferred: WhatsApp group-admin actions stay immediate for organizers (owner decision #2); a Settings UI for risk
  overrides (agent file / admin MCP for now).
