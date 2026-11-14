# whatsapp-agent-duniya

Self-hosted WhatsApp agents on one number. Each **bot** is a folder with a prompt, the MCP servers it may use, per-role tool rules and optional code hooks. A built-in **admin panel** shows what every bot is doing in real time and lets you control it. Runs on an Oracle Cloud Always Free VM, deployed from this repo with Terraform + GitHub Actions, and reachable through a Cloudflare Tunnel (no open ports).

No WhatsApp Business API: the server links to a normal WhatsApp number as a *linked device* via [Baileys](https://github.com/WhiskeySockets/Baileys).

```
WhatsApp groups / DMs
        │
  channels/whatsapp ── router ──► bot (bots/<id>/) ──► Claude (tool use)
        │                │                      ├─ MCP servers (role-filtered)
        │                │                      └─ local tools (index.js hooks)
        │                └─ confirm gate: "*_preview" → organizer replies "confirm CODE"
        └─ admin panel (127.0.0.1:8080 → Cloudflare Tunnel): status, QR, live activity,
           bots, chat binding, pending changes, secrets, update from GitHub
```

**Bots included**

| Bot | What it does |
|---|---|
| `panduga` | panduga.ch event assistant: agenda, menu, rooms, shopping via the panduga.ch MCP, aware of the group's discussion. Organizers make changes with preview + `confirm CODE`. |
| `_template` | Copy to start a new bot (shows MCP config, local tools, hooks). Ignored while it starts with `_`. |

## Setup

Follow **[docs/SETUP.md](docs/SETUP.md)**: create an OCI API key, add GitHub secrets, run the *Infrastructure (OCI)* workflow, open the panel, scan the QR, add secrets, bind groups. About 20 minutes.

## How bots work

`bots/<id>/bot.json`:

```jsonc
{
  "name": "Panduga",
  "model": "claude-sonnet-5-5",
  "triggers": ["!panduga"],            // group messages starting with this (or @mentions/replies) wake the bot
  "dm": "members",                     // who may DM: none | organizers | members (of its groups) | anyone
  "mcpServers": {
    "panduga": { "url": "${PANDUGA_MCP_URL}",          // ${NAME} = secret set in the panel
                 "tokens": { "organizer": "${PANDUGA_TOKEN_ORGANIZER}", "participant": "${PANDUGA_TOKEN_MEMBER}" } }
  },
  "tools": {                           // "<server>:<tool>" globs; "local:<name>" for hook tools
    "participant": ["panduga:agenda_*", "panduga:menu_list"],
    "organizer": ["panduga:*"],
    "deny": []
  },
  "confirm": { "preview": "panduga:*_preview", "tool": "panduga:confirm", "idField": "confirm_id", "ttlMinutes": 9 },
  "schedules": [{ "id": "morning", "at": "08:00", "days": "daily", "chats": "all", "prompt": "…" }]
}
```

- `prompt.md`: the bot's instructions.
- `index.js` (optional): `tools` (local tools the model can call), `onMessage` (answer without Claude, e.g. commands), `role` (custom organizer logic), `init`.
- **Roles** are enforced in code: a participant never receives organizer tools, and the confirm tool is never given to the model. When a preview tool returns a `confirm_id`, the server keeps it, hides it from the model, and posts a 4-letter code. Only an organizer replying `confirm CODE` in the same chat (or Apply in the panel) runs it.
- **Live settings** (enabled, triggers, organizers, chats, schedules, extra prompt, model) are edited in the panel and stored in `DATA_DIR/bots/<id>.json`, so deploys never overwrite them.

Add a bot: copy `bots/_template` to `bots/<id>`, edit it, push, then click **Update from GitHub** and **Reload bots** in the panel. Bind a group to it on the **Chats** tab.

## Memory (context awareness)

Every bot sees what is happening in its group, not only messages addressed to it:

- **All group messages are stored** (bound or not, including reply-quotes and the history WhatsApp delivers when
  the number is linked), so a bot bound later still has context. Retention: 90 days / 5,000 messages per chat.
- **Recent messages** (last 30, per bot `historySize`) go to the model verbatim.
- **Rolling summary**: older messages are folded into a per-chat summary (decisions, plans, open questions, who is
  who) by a low-cost model (`SUMMARY_MODEL`, default `claude-haiku-5-5`) in the background.
- **Notes**: "remember that…" saves a note via `memory__remember`; organizers can `memory__forget`;
  `memory__search_history` finds older messages by keyword.
- Memory is passed as information, never as instructions, and can't change roles or permissions.
- Panel → Chats → **Memory** shows the summary, notes and message count, and can rebuild or erase it.
- Opt out per bot with `"memory": { "enabled": false }`.

## Admin panel

- **Overview**: WhatsApp status, QR / pairing code, unlink, pause-all kill switch, per-bot on/off, server info, *Update from GitHub*.
- **Activity**: live stream of messages in/out, every tool call (input/output, timing), confirmations, schedule runs and errors.
- **Bots**: settings editor, schedules with *Run now*, and a test console that talks to the bot with real tools without posting to WhatsApp.
- **Chats**: all groups the number is in; choose which bot answers each.
- **Pending**: changes waiting for confirmation (apply/cancel).
- **Secrets**: API keys and tokens, write-only, stored in `DATA_DIR/secrets.json` (0600).

Login is password-based (scrypt, HttpOnly SameSite=Strict session cookie, rate-limited). It listens on 127.0.0.1 only; put Cloudflare Access in front of the tunnel hostname for a second factor.

## Spec-driven development (GitHub Spec Kit)

This repo is built with [GitHub Spec Kit](https://github.com/github/spec-kit). The constitution is in
`.specify/memory/constitution.md`; every feature has `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md` and `tasks.md` under `specs/`:

| Feature | Spec |
|---|---|
| 001 Multi-bot platform | [specs/001-multi-bot-platform](specs/001-multi-bot-platform/spec.md) |
| 002 Admin panel | [specs/002-admin-panel](specs/002-admin-panel/spec.md) |
| 003 OCI deployment from GitHub | [specs/003-oci-deployment](specs/003-oci-deployment/spec.md) |
| 004 Group memory | [specs/004-group-memory](specs/004-group-memory/spec.md) |

New work: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` →
`/speckit-implement` → `/speckit-converge` (Claude Code skills are in `.claude/skills/`).

## Development

```bash
npm install
ADMIN_PASSWORD=dev-password-123 npm start   # panel on http://127.0.0.1:8080, QR shown there
npm test                                    # e2e: fake MCP server + fake Claude API + fake channel (20 scenarios)
```

Layout: `src/channels/` (WhatsApp), `src/core/` (router, bots, agent, tools, MCP pool, scheduler, db, events), `src/panel/` (API + single-file UI), `bots/`, `deploy/` (install/update/backup), `infra/terraform/`, `.github/workflows/`.

## Notes

- **Use a dedicated number** (a prepaid SIM). Unofficial clients can get a number banned; this bot only replies when addressed and is rate-limited.
- **OCI idle reclamation**: Always Free VMs with low CPU/network can be reclaimed. Upgrade the tenancy to Pay-As-You-Go (you still pay nothing within Always Free limits) and keep backups (`deploy/backup.sh`, nightly; set `BACKUP_RCLONE_REMOTE` for off-VM copies).
- Memory on an E2.1.Micro: ~180 MB RSS for the app with two bots, plus 2 GB swap as a safety net.
