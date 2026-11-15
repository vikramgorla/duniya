# Duniya reference

Everything that used to live in the README: install options, first steps, managing the app from AI assistants,
architecture, development and settings. For a visual tour see the
[project site](https://vikramgorla.github.io/whatsapp-agent-duniya/).

- [Install](#install)
- [First steps in the panel](#first-steps-in-the-panel)
- [Manage it from ChatGPT or Claude](#manage-it-from-chatgpt-or-claude)
- [How it works](#how-it-works)
- [Optional settings (environment)](#optional-settings-environment)
- [Development](#development)
- [Notes](#notes)

## Install

### One command (Ubuntu/Debian, x86_64 or arm64)

```bash
curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash
```

It asks how the panel should be reached. Or say it up front:

| Option | Panel address | Open ports |
|---|---|---|
| `--domain agents.example.com` | `https://agents.example.com` (automatic certificate) | 80, 443 |
| `--ip-https` | `https://<your-ip>.sslip.io` (automatic certificate, no domain needed) | 80, 443 |
| `--cloudflare-token <token>` | your Cloudflare Tunnel hostname ([guide](deploy/cloudflare-tunnel.md)) | none |
| `--local-only` | `ssh -L 8080:127.0.0.1:8080 you@server` → `http://localhost:8080` | none |

```bash
curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash -s -- --ip-https --yes
```

The installer prints the panel address and a **one-time setup code** to create your owner account. Run it again
any time to update or change how the panel is reached; your data stays. `--help` lists every option
(`--admin-password`, `--update-mode off|notify|auto`, `--branch`, `--dry-run`, …).

### Docker

```bash
git clone https://github.com/vikramgorla/whatsapp-agent-duniya && cd whatsapp-agent-duniya
cp .env.example .env            # optional: DOMAIN, TUNNEL_TOKEN, ADMIN_PASSWORD
docker compose up -d            # or: --profile https / --profile tunnel
```

See [deploy/docker.md](deploy/docker.md).

### Deploy to Oracle Cloud (Always Free)

[![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip)

Creates a free VM that installs itself. Walkthrough and tips: [deploy/oci-free-tier.md](deploy/oci-free-tier.md).
Prefer infrastructure-as-code from your own fork? [deploy/terraform-github-actions.md](deploy/terraform-github-actions.md).

**Manage an existing deployment:** [open your stacks](https://cloud.oracle.com/resourcemanager/stacks), then pick the stack.

- *Update the app:* nothing to do in Oracle. The panel updates itself (Settings → Updates).
- *Update the infrastructure:* **Edit stack**, upload the [latest stack zip](https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip), then **Apply**.
- *See what the server is doing:* while it installs, open `http://<server-ip>/` for a live progress page; if the
  install fails, that page shows the error. On Pay As You Go accounts you can also turn on *Send logs to OCI Logging*.
- *Remove everything:* run **Destroy**, then **Delete stack**. Take a backup first if you want to keep your bots.

Runs comfortably on a 1 GB VM (~180 MB RAM).

## First steps in the panel

1. **Setup**: enter the setup code, choose your username and password.
2. **Overview**: scan the QR with the bot's WhatsApp (*Settings → Linked devices*), or use a pairing code.
3. **Models**: connect OpenRouter in one tap, paste an Anthropic or OpenAI key, add an OpenAI-compatible endpoint,
   *Sign in with ChatGPT*, or connect GitHub Copilot.
4. **Bots → New bot**: pick a template (or *Create a bot with AI*), write the instructions, add organizers, connect
   tool services (URL → *Check* → *Connect* to sign in, or a token; *Discover tools* → tick per role), save. Use the
   **test console** to try it.
5. Add the bot number to a WhatsApp group. **Chats** → switch the chat **on** and choose the bot. Chats are off until
   you switch them on: agents ignore them completely (nothing stored, no model call).
6. In the group: `!yourtrigger hello` (or @mention the bot).
7. **Backups**: set a passphrase, connect GitHub or S3, turn on the schedule.

## Manage it from ChatGPT or Claude

The app is also an MCP server, so you can run it by chatting: "which bots are on?", "turn off the carpool bot",
"what happened in the school group today?". Open **Settings → Connected AI assistants**, copy the address
(`https://YOUR-HOST/mcp`) and follow the short steps shown there:

- **ChatGPT**: Settings → Apps & Connectors → Advanced settings → turn on Developer mode; then Create a connector with
  the address as MCP server URL and OAuth.
- **Claude**: Settings → Connectors → Add custom connector → paste the address → Add → Connect.

A Duniya page opens: sign in (if asked), check what the assistant may do, and click **Approve**. The assistant acts as
you, with your panel role (viewers stay read-only; owner-only actions stay owner-only). Risky actions (deleting a bot,
erasing memory, secrets, users, WhatsApp numbers, backups restore, updates, restarts) return a preview and only happen
after a second `confirm_action` call. Every call is in the activity log ("AI assistants (MCP)"); disconnect an
assistant any time in the same card.

It needs the panel reachable over public HTTPS (Caddy or Cloudflare Tunnel). Behind a proxy set `TRUST_PROXY=1`, or set
`PUBLIC_URL=https://your-host` so the OAuth issuer and MCP address are fixed. Under the hood: OAuth 2.1 with dynamic
client registration, PKCE S256, resource-bound tokens (access 1 h, refresh 30 days with rotation), see
[`specs/017-admin-mcp/`](../specs/017-admin-mcp/spec.md).

## How it works

```
WhatsApp (linked device) ─► allow-list ─► router ─► bot (stored in the app) ─► model provider
                                            │            ├─ MCP tool services (per-role allow lists, enforced in code)
                                            │            ├─ WhatsApp actions (media, reactions, polls, group admin)
                                            │            ├─ memory: recent messages + running summary + notes + search
                                            │            └─ plugins (optional code: tools, commands)
                                            └─ confirm gate: *_preview results held; an organizer replies "confirm CODE"
Admin panel (localhost:8080 behind Caddy / Cloudflare Tunnel / SSH) · SQLite · encrypted secrets & backups
```

- **Chats** are off by default (#10). Messages from chats that are off are dropped before storage and before any
  model call.
- **Roles**: organizers (phone numbers per bot; while none are saved, the WhatsApp admins of its groups) get organizer
  tools and can confirm changes; everyone else in a bound group is a participant. The model never sees or calls the
  confirm tool.
- **Panel users**: owner (everything), admin (bots, chats, models, memory), viewer (read-only). Sign in with a
  password or Google; owners invite people by email.
- **Models**: OpenRouter (optionally free models only), Anthropic API key, OpenAI API key, any OpenAI-compatible
  endpoint (Ollama, …), your ChatGPT Plus/Pro plan via Sign in with ChatGPT, or your GitHub Copilot allowance via the
  official Copilot SDK (downloaded only if you connect it). Pick per bot and per chat, or *Auto*.
- **Plugins** (`plugins/<name>/index.js`) add local tools or commands for advanced cases; see `plugins/example-dice`.
- **Bot templates** (`templates/`): New bot, School friends, Family, Car pooling, Office colleagues, Event planning,
  Neighbours. Bots themselves are data in the app (export/import as JSON).
- **Several WhatsApp numbers**: chats on the first number keep their WhatsApp id; others are `<number>#<jid>`.

## Optional settings (environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | from the request | Public address of the panel (set by the installer); used for sign-in redirects and the MCP address |
| `TRUST_PROXY` | off | Trust `X-Forwarded-*` headers from a reverse proxy |
| `PANEL_HOST` / `PANEL_PORT` | `127.0.0.1` / `8080` | Where the panel listens |
| `ADMIN_PASSWORD` | — | Create owner `admin` with this password on first start (otherwise a setup code is printed) |
| `DATA_DIR` | `data` | SQLite database, WhatsApp sessions, local backups |
| `TZ_DEFAULT` | `Europe/Zurich` | Default timezone for schedules |
| `RATE_LIMIT_PER_MIN` | 6 | Requests one person may make to one bot per minute |
| `MEMORY_RETENTION_DAYS` / `MEMORY_MAX_MESSAGES` | 90 / 5000 | Stored-message limits per chat |
| `WA_MEDIA_MAX_MB` | 16 | Largest media file an agent may send |
| `UPDATE_MODE` | `notify` | `off`, `notify` or `auto` |
| `BACKUP_UPLOAD_MAX_MB` | 200 | Largest backup file accepted by "Restore from a file" |

## Development

```bash
npm install
ADMIN_PASSWORD=dev-password-123 npm start     # panel on http://127.0.0.1:8080
npm test                                      # e2e with fake WhatsApp, Claude, OpenAI, MCP, GitHub and S3
npm run lint
```

Built with [GitHub Spec Kit](https://github.com/github/spec-kit): the constitution is
`.specify/memory/constitution.md` and every feature has its spec, plan and tasks under [`specs/`](../specs).
New work: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` → `/speckit-converge`.
Process: [CONTRIBUTING.md](../CONTRIBUTING.md). Design language: [DESIGN.md](../DESIGN.md).

Releases: bump the version in `package.json` and merge to `main` (or push a `vX.Y.Z` tag, or run the workflow by hand).
The release workflow creates the tag and GitHub release, attaches the OCI stack zip and publishes the Docker image to
`ghcr.io/vikramgorla/whatsapp-agent-duniya`.

The project site lives in [`site/`](site/) (plain HTML/CSS, no build step) and is deployed to GitHub Pages by
`.github/workflows/pages.yml` on every push to `main` that touches it.

## Notes

- Use a **dedicated WhatsApp number**. Unofficial clients can be banned; bots only reply when addressed and are
  rate-limited to keep that risk low. Tell your groups that the assistant keeps context.
- Claude **subscriptions** (Pro/Max) can't be used by third-party apps under Anthropic's terms, so Claude needs an
  API key. ChatGPT plan usage uses OpenAI's official open-source flow (preview).
- GitHub *device login* for backups needs a GitHub OAuth App client id (Device Flow enabled); the one-click GitHub App
  or pasting a token always works.
