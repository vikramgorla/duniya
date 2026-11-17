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
> secrets or users, sign-up links, WhatsApp numbers, restoring backups, updates, restarts.

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
> `get_overview` also lists the **Getting started** steps still open (link WhatsApp, connect a model, create an agent,
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

103 tools cover the panel:

| Area | Covers |
|---|---|
| Overview | status, activity |
| Agents | review (`list_agent_answers`: recent answers with the question and their 👍/👎; `rate_agent_answer`; fix a wrong one with `draft_agent_with_ai` + `update_agent`), create, update (also the built-in `owner-assistant`: character, model, tools, photos & voice, schedules incl. the weekly summary, `alerts.to` — owner only; it is marked `builtin` and cannot be deleted or assigned), draft with AI, test (`test_agent` says which path answered: quick reply, FAQ or model), export, enable, built-in answers without AI (`set_agent_quick_answers`: quick replies, `!help`, welcome, FAQ) |
| Chats | assign, settings (model, fallback mode and chain, logging, welcome new members; `list_chats` leaves out settings at their default), private, privacy notice, stored messages, `search_messages` (owner: across every chat that is on and not private), `load_chat_history` (Load recent messages from the phone, optional: unanswered loads retry by themselves; the owner assistant runs it without a confirm code), `set_history_on_switch_on`, prepare a direct chat before the person writes (`prepare_direct_chat`; confirmed when `send_intro` is set), first message by the agent (`send_chat_intro`, confirmed) |
| Money | usage, prices, spending caps, weekly summary preview (alerts number and schedule: `update_agent` on `owner-assistant`) |
| People & memory | contacts (`contact_names_status`; `refresh_contact_names`, `set_contact_names_for_agents`, optional — names refresh by themselves), memory, WhatsApp groups, WhatsApp numbers, users |
| Models | models, accounts (`list_model_accounts` with each account's health: paused until when and why, e.g. a usage limit), fallback, photos & voice |
| Tools | global tool services, browse and add from the MCP Registry (`search_mcp_registry`, `add_tool_service_from_registry`), secrets, confirmations, logging |
| Server | updates (`get_update_status` with the notes of every release in between, incl. breaking releases: `apply_update` with `breaking: true`, `snooze_update_decision`), release notes (`get_release_notes`: what each installed version brought, any range), metrics (with hosting), OS updates (`list_os_updates`: will install / rolling out gradually / held back; `run_maintenance` `os-update` or `os-update-all` to include gradual updates; restart-needed status), the root maintenance helper (`get_maintenance_status` → `helperOutdated`, `helperSelfUpdate`; `run_maintenance` `update-helper`), Small server mode (`set_small_server_mode`, confirm required), health and retention (`get_server_health`: database size, oldest kept data, last clean-up, disk, queue, clock; `set_retention`, confirm required), restart, backups |

The list is in `src/panel/admin-tools.js`; a feature that adds panel functionality adds its tool there
([AGENTS.md](../AGENTS.md)). The [owner assistant](owner-assistant.md) uses the same tools from WhatsApp.

---
**Next:** [Owner assistant](owner-assistant.md) · [Domains & access](domains-and-access.md) · [Docs index](README.md)
