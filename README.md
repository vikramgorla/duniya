# Duniya — self-hosted WhatsApp agents

Run AI assistants in your WhatsApp groups, on your own server, managed from a web panel.

- **Bots built in the panel**: instructions, triggers, who can message them, organizers, schedules. Start from a
  template or import a bot file.
- **Tools via MCP**: connect remote MCP servers (**Sign in** with OAuth, your own OAuth app, a token, or custom
  headers) or install **local** ones from npm or GitHub (owner only), and tick which tools participants and
  organizers may use. Changes go
  through a **confirm step**: the bot prepares them and an organizer replies `confirm CODE` before anything happens.
- **Group memory**: bots follow the whole conversation, keep a running summary of long discussions, remember notes
  on request and can search older messages.
- **Your choice of models**, set up with guided steps: OpenRouter in one tap (free models only, if you like),
  Anthropic API key, OpenAI API key, any OpenAI-compatible endpoint (Ollama, …), your **ChatGPT Plus/Pro plan** via
  Sign in with ChatGPT, or your **GitHub Copilot** allowance via the official Copilot SDK (optional package). Pick per
  bot, or *Auto*; test each connection with one tap.
- **Several WhatsApp numbers**, groups and 1:1 chats: choose the bot, the model (or Auto) and the logging level per
  chat.
- **Server page**: CPU, memory, disk, network, logs, OS updates and restart — no SSH needed.
- **Admin panel**: live activity (every message, tool call, model and token count), pause switch, users with
  roles, encrypted secrets, WhatsApp QR / pairing code, in-place updates.
- **Encrypted backups** on a schedule to this server, a **private GitHub repo** the app creates for you, or any
  **S3-compatible** bucket; restore in a few clicks.
- **No commercial WhatsApp connector**: the server links to a normal WhatsApp number as a linked device
  ([Baileys](https://github.com/WhiskeySockets/Baileys)). Use a dedicated number.

Runs comfortably on a 1 GB VM (~180 MB RAM), including Oracle Cloud's Always Free tier.

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
| `--cloudflare-token <token>` | your Cloudflare Tunnel hostname ([guide](docs/deploy/cloudflare-tunnel.md)) | none |
| `--local-only` | `ssh -L 8080:127.0.0.1:8080 you@server` → `http://localhost:8080` | none |

```bash
curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash -s -- --ip-https --yes
```

The installer prints the panel address and a **one-time setup code** to create your owner account. Run it again
any time to update or change how the panel is reached; your data stays. `--help` lists every option.

### Docker

```bash
git clone https://github.com/vikramgorla/whatsapp-agent-duniya && cd whatsapp-agent-duniya
cp .env.example .env            # optional: DOMAIN, TUNNEL_TOKEN, ADMIN_PASSWORD
docker compose up -d            # or: --profile https / --profile tunnel
```

See [docs/deploy/docker.md](docs/deploy/docker.md).

### Deploy to Oracle Cloud (Always Free)

[![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip)

**Manage an existing deployment:** [open your stacks](https://cloud.oracle.com/resourcemanager/stacks), then pick the stack.
- *Update the app:* nothing to do in Oracle. The panel updates itself (Settings → Updates).
- *Update the infrastructure:* **Edit stack**, upload the [latest stack zip](https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip), then **Apply**.
- *See what the server is doing:* while it installs, open `http://<server-ip>/` for a live progress page; if the install fails, that page shows the error. On Pay As You Go accounts you can also turn on *Send logs to OCI Logging*.
- *Remove everything:* run **Destroy**, then **Delete stack**. Take a backup first if you want to keep your bots.


Creates a free VM that installs itself. Walkthrough and tips: [docs/deploy/oci-free-tier.md](docs/deploy/oci-free-tier.md).
Prefer infrastructure-as-code from your own fork? [docs/deploy/terraform-github-actions.md](docs/deploy/terraform-github-actions.md).

## First steps in the panel

1. **Setup**: enter the setup code, choose your username and password.
2. **Overview**: scan the QR with the bot's WhatsApp (*Settings → Linked devices*), or use a pairing code.
3. **Models**: paste an Anthropic or OpenAI key, add an OpenAI-compatible endpoint, or *Sign in with ChatGPT*.
4. **Bots → New bot**: pick a template, write the instructions, add organizers, connect tool services
   (URL → *Check* → *Connect* to sign in, or a token; *Discover tools* → tick per role), save. Use the **test console** to try it.
5. Add the bot number to a WhatsApp group. **Chats** → choose the bot for that group.
6. In the group: `!yourtrigger hello` (or @mention the bot).
7. **Backups**: set a passphrase, connect GitHub or S3, turn on the schedule.

## How it works

```
WhatsApp (linked device) ─► router ─► bot (stored in the app) ─► model provider (Anthropic / OpenAI / ChatGPT / compatible)
                              │            ├─ MCP tool services (per-role allow lists, enforced in code)
                              │            ├─ memory: recent messages + running summary + notes + search
                              │            └─ plugins (optional code: tools, commands)
                              └─ confirm gate: *_preview results held; an organizer replies "confirm CODE"
Admin panel (localhost:8080 behind Caddy / Cloudflare Tunnel / SSH) · SQLite · encrypted secrets & backups
```

- **Roles**: organizers (phone numbers per bot) get organizer tools and can confirm changes; everyone else in a bound
  group is a participant. The model never sees or calls the confirm tool.
- **Panel users**: owner (everything), admin (bots, chats, models, memory), viewer (read-only).
- **Plugins** (`plugins/<name>/index.js`) add local tools or commands for advanced cases; see `plugins/example-dice`.
- **Bot templates** live in `templates/`; bots themselves are data in the app (export/import as JSON).

## Development

```bash
npm install
ADMIN_PASSWORD=dev-password-123 npm start     # panel on http://127.0.0.1:8080
npm test                                      # e2e with fake WhatsApp, Claude, OpenAI, MCP, GitHub and S3
```

Built with [GitHub Spec Kit](https://github.com/github/spec-kit): the constitution is
`.specify/memory/constitution.md` and every feature has its spec, plan and tasks under `specs/`:
[001 platform](specs/001-multi-bot-platform/spec.md) · [002 admin panel](specs/002-admin-panel/spec.md) ·
[003 OCI deployment](specs/003-oci-deployment/spec.md) · [004 group memory](specs/004-group-memory/spec.md) ·
[005 app-managed bots & users](specs/005-app-managed-bots/spec.md) · [006 model providers](specs/006-model-providers/spec.md) ·
[007 backups](specs/007-backups/spec.md) · [008 install & updates](specs/008-install-and-exposure/spec.md).
New work: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` → `/speckit-converge`.

Releases: bump the version in `package.json` and merge to `main` (or push a `vX.Y.Z` tag, or run the workflow by hand).
The release workflow creates the tag and GitHub release, attaches the OCI stack zip and publishes the Docker image to
`ghcr.io/vikramgorla/whatsapp-agent-duniya`.

## Notes

- Use a **dedicated WhatsApp number**. Unofficial clients can be banned; bots only reply when addressed and are
  rate-limited to keep that risk low. Tell your groups that the assistant keeps context.
- Claude **subscriptions** (Pro/Max) can't be used by third-party apps under Anthropic's terms, so Claude needs an
  API key. ChatGPT plan usage uses OpenAI's official open-source flow (preview).
- GitHub *device login* for backups needs a GitHub OAuth App client id (Device Flow enabled); pasting a token always works.


Design language: [DESIGN.md](DESIGN.md).
