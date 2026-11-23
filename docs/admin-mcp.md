# Manage it from ChatGPT or Claude (admin MCP)

**Run Duniya by chatting: "which agents are on?", "turn off the carpool agent", "what happened in the school group
today?".**

**Do it:** panel → **Settings → Connected AI assistants** → copy `https://YOUR-HOST/mcp`.

**In 30 seconds**
- The assistant acts as you, with your panel role; risky actions need a second `confirm_action`.
- Every call is logged; disconnect any time. Needs public HTTPS (Caddy or Cloudflare Tunnel).

![Connected AI assistants card](site/img/card-assistants.webp)

## Connect

| Assistant | Steps |
|---|---|
| **ChatGPT** | Settings → Apps & Connectors → Advanced settings → turn on Developer mode → Create a connector: the address as MCP server URL, OAuth |
| **Claude** | Settings → Connectors → Add custom connector → paste the address → Add → Connect |

Then a Duniya page opens: sign in (if asked), check what the assistant may do, **Approve**.

<p align="center"><img src="diagrams/admin-mcp-confirm.svg" alt="Sequence: ChatGPT or Claude calls a risky tool such as delete_agent, Duniya returns a preview and a code, the assistant calls confirm_action, and Duniya carries it out and logs it in Activity" width="543"></p>

<details><summary>Diagram as text</summary>

1. ChatGPT or Claude calls a risky tool, for example `delete_agent`.
2. Duniya answers with a preview and a code; nothing has changed yet.
3. The assistant calls `confirm_action` with that code (single use, 10 minutes; a restart does not lose it).
4. Duniya does it and logs it in Activity.

</details>

> [!IMPORTANT]
> Viewers stay read-only; owner-only actions stay owner-only. Risky: deleting an agent, erasing memory, removing
> secrets or users, sign-up links, WhatsApp numbers, restoring backups, updates, the update source, restarts.

Every tool has a title and all four safety hints that app directories (ChatGPT, Claude) read, derived in one place
from what the tool does (`toolHints` in `src/panel/admin-tools.js`): **read-only** (only looks), **destructive**
(overwrites or deletes, or needs a confirmation), **idempotent** (repeating it changes nothing more) and **open world**
(reaches outside the server: sends WhatsApp or Telegram messages, calls a model, GitHub, apt). The server introduces
itself with a name, version, description, website and icon.

## No secrets through the assistant

The assistant never sees a key, password or passphrase (spec
[`060`](../specs/060-secretless-links/spec.md)):

| Tool | What happens |
|---|---|
| `set_secret` { `name` or `account` } | Returns a one-time link (15 minutes, single use). A signed-in owner or admin opens it and pastes the value in the panel; it goes straight to the server. `list_secrets` / `list_model_accounts` then show it as set. A `value` sent anyway is refused |
| `add_user` { `username`, `role` } | Creates the user without a password and returns a one-time sign-up link (48 hours) for that person only: they choose their own password and are signed in |
| `send_signup_link` { `user_id` } | A new sign-up link (expired link, forgotten password); older links stop working. Needs `confirm_action` |
| `restore_backup` { `source`, `file` } | Uses the backup passphrase stored on this server; the preview opens the backup and shows its date. A backup that does not open with it (another server, an older passphrase) is refused with a link to **Backups → Restore** in the panel |

> [!NOTE]
> `get_overview` lists the accounts of every channel and whether each is connected (`accounts`: WhatsApp numbers, a
> Telegram bot), and the **Getting started** steps still open (link WhatsApp, connect a model, create an agent,
> switch a chat on, send a test), so an assistant can tell a new owner what is next. `assign_chat` takes
> `switch_on: true` to switch an Off chat on in the same step, as choosing an agent does in the panel.

> [!TIP]
> Behind a proxy set `TRUST_PROXY=1`, or `PUBLIC_URL=https://your-host` so the OAuth issuer and MCP address are fixed
> ([settings](settings.md)).

<details>
<summary>Under the hood</summary>

OAuth 2.1 with dynamic client registration, PKCE S256, resource-bound tokens (access 1 h, refresh 30 days with
rotation). Spec: [`specs/017-admin-mcp/`](../specs/017-admin-mcp/spec.md).

</details>

## Tools

124 tools cover the panel. Chats always come with their name (`chatName`) next to the id: group subjects and people's names from the same resolver as the panel.

| Area | Covers |
|---|---|
| Overview | status, activity (`list_activity`), why agents stayed quiet (`list_silences`: per chat, reason and count) |
| Agents | review (`list_agent_answers`: recent answers with the question and their 👍/👎; `rate_agent_answer`; fix a wrong one with `draft_agent_with_ai` + `update_agent`), create, update (also the built-in `owner-assistant`: character, model, tools, photos & voice, schedules incl. the weekly summary, `alerts.to` — owner only; it is marked `builtin` and cannot be deleted or assigned), draft with AI, test (`test_agent` says which path answered: quick reply, FAQ or model), export, enable, built-in answers without AI (`set_agent_quick_answers`: quick replies, `!help`, welcome, FAQ), how sure before changing things (`update_agent` with `autonomy`: `ask`, `clear` or `act`, and optional `risk` overrides; [Agents](agents.md#how-sure-before-changing-things)); `list_activity` with `type: "change.auto"` lists the changes agents made without asking |
| Chats | assign, settings (model, fallback mode and chain, logging, welcome new members; `list_chats` leaves out settings at their default), private, privacy notice, stored messages (`list_chat_messages`: each answer with its agent and rating, and what a message's photo, GIF, video or voice note is (`media`; the file plays in the panel only); `around_id` opens them at one answer; `delete_chat_message`, confirmed: the agent forgets it; `edit_chat_message`, confirmed: edit an agent's answer in the chat within the edit window, or send a correction), `search_messages` (owner: across every chat that is on and not private), `load_chat_history` (Load earlier from your phone, optional: unanswered loads retry by themselves; the owner assistant runs it without a confirm code), `set_history_on_switch_on`, prepare a direct chat before the person writes (`prepare_direct_chat`; confirmed when `send_intro` is set), first message by the agent (`send_chat_intro`, confirmed) |
| Money | usage (`get_usage` with the [cost per feature](spending.md#cost-per-feature)), prices, spending caps, weekly summary preview (alerts number and schedule: `update_agent` on `owner-assistant`) |
| People & memory | [People](people.md) (`list_people`, `get_person`: one person's page — apps, ties, households, notes and timeline, tags, lists, their chats, consents, the agents that can see them; `add_person`, `update_person`, `add_person_note`, `set_person_tie`, `remove_person_tie`, `set_person_tags`, `set_person_hidden` (Hide / Show again), `set_person_consent` (privacy notice, updates, marketing), `merge_people`, `undo_merge`, `export_person`, `erase_person` (the only true delete, owner, confirmed); `list_people` filters by `source` (chat, phone, owner) and `hidden`; `update_agent` sets `peopleAccess`, `peopleLists` and organizers as people or lists; households: `list_households`, `get_household`, `save_household`, `set_household_member`; lists: `list_people_lists`, `save_people_list`, `set_list_member`; names: `people_names_status`, `refresh_contact_names`, `set_contact_names_for_agents`, optional — names refresh by themselves), memory, WhatsApp groups, WhatsApp numbers, users |
| Modules | `list_modules`, `set_module_enabled` (confirm required; also [Web search](web-search.md), on by default); [Events](events.md): `list_events`, `get_event` (counts incl. kids, registrations, duties), `save_event`, `delete_event` (confirm required), `register_for_event`, `update_registration`, `save_event_duty` (add, change or give a duty); [Orders and payments](orders.md): `list_orders` ("who hasn't paid?"), `get_order`, `create_order`, `record_payment` (payments and refunds, confirm required), `set_payment_methods`; [Lists and sending](sending.md): `list_sends`, `get_send`, `send_to_people` (preview, confirm required), `control_send` (pause, resume, stop), `save_send_audience`, `set_payment_reminders` (confirm required), [campaigns](campaigns.md): `start_campaign` (confirm required), `get_campaign`, `control_campaign`; [Surveys](surveys.md): `list_surveys`, `get_survey_results`, `save_survey`, `delete_survey` (confirm required) |
| Sending pace | `get_sending_pace`, `set_sending_pace` (preset, read receipts, custom ranges: [Sending pace](sending-pace.md)) |
| Channels | `list_channels` (state, numbers or bot connected, memory used, the Telegram bot's name and privacy mode), `set_channel_enabled` (switching a channel off needs `confirm_action`), `set_telegram_dm_agent`; connect Telegram with `set_secret` `TELEGRAM_BOT_TOKEN` (one-time link) |
| Owner assistant | morning brief (`get_morning_brief`, `set_morning_brief`), suggested next steps (`list_suggested_steps`, `approve_suggested_step` confirmed, `dismiss_suggested_step`), `catch_up_chat` ([Owner assistant](owner-assistant.md#morning-brief)) |
| Promises & people | `list_commitments` (open, overdue, done; by person, agent or chat), `update_commitment`, `delete_commitment` (confirmed), `get_person_preferences`, `set_person_preferences`, `list_tie_suggestions`, `decide_tie_suggestion` ([People → Promises](people.md#promises)) |
| Lessons | `list_lessons`, `add_lesson`, `edit_lesson` (approve, reword, scope), `delete_lesson`, `join_in_feedback` ([Lessons](intelligence.md#lessons)) |
| Models | models, [Smart choice](intelligence.md#smart-model-choice) (`set_default_models` with `light_model`, `strong_model`, `smart_classifier`; `get_smart_model_savings`), accounts (`list_model_accounts` with each account's health: paused until when and why, e.g. a usage limit; for [agent apps](models.md#agent-apps) also whether the app is downloaded and its measured memory), fallback, photos & voice. Agent apps are connected by the owner in the panel (their own sign-in) |
| Tools | global tool services, how agents use each service (`get_tool_behaviour`, `set_tool_behaviour`: when to use it (for media services also sharing on its own), changes, limits, per-tool risk; per agent or the default), browse and add from the MCP Registry (`search_mcp_registry`, `add_tool_service_from_registry`), secrets, confirmations, logging |
| Server | updates (`get_update_status` with the notes of every release in between, incl. breaking releases: `apply_update` with `breaking: true`, `snooze_update_decision`; `rolledBack` when a release did not start and the server put the previous one back; the update source: `source` in `get_update_status`,
`set_update_source` to a fork or back to the project, confirm required), release notes (`get_release_notes`: what each installed version brought, any range), metrics (with hosting), OS updates (`list_os_updates`: will install / rolling out gradually / held back; `run_maintenance` `os-update` or `os-update-all` to include gradual updates; restart-needed status), the root maintenance helper (`get_maintenance_status` → `helperOutdated`, `helperSelfUpdate`; `run_maintenance` `update-helper`), Small server mode (`set_small_server_mode`, confirm required), health and retention (`get_server_health`: database size, oldest kept data, last clean-up, disk, queue, clock; `set_retention`, confirm required), restart, backups |

The list is in `src/panel/admin-tools.js`, one file per area in `src/panel/admin-tools/`; a feature that adds panel
functionality adds its tool there
([AGENTS.md](../AGENTS.md)). The [owner assistant](owner-assistant.md) uses the same tools from WhatsApp.

---
**Next:** [Owner assistant](owner-assistant.md) · [Domains & access](domains-and-access.md) · [Docs index](README.md)
