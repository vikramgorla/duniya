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
  Sign in with ChatGPT, or your **GitHub Copilot** allowance via the official Copilot SDK (downloaded only if you connect it). Pick per
  bot, or *Auto*; test each connection with one tap.
- **People & roles**: pick organizers from a group's member list (group admins pre-selected).
- **AI helper**: describe a new bot or a change ("shorter replies", "make Ravi an organizer") and review the draft
  before saving.
- **Sign in with Google** (guided 4-step setup) and invites by email; password sign-in stays.
- **Backups made easy**: one-click GitHub App, or download a backup and restore it by upload (also on a fresh
  server's welcome screen).
- **Several WhatsApp numbers**, groups and 1:1 chats: choose the bot, the model (or Auto) and the logging level per
  chat.
- **Usage & cost**: tokens and estimated cost by bot, chat, provider and model, next to each and in a Usage tab.
- **Stored messages**: admins can read and search what the bots stored for each chat (each look is logged).
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

## Deploy on a free cloud VM

Two providers give you a server that stays free (checked November 2026, sources in
[specs/030-free-vms/research.md](specs/030-free-vms/research.md)). Both buttons create the VM and run the same installer.

| Provider | Free server | Button |
|---|---|---|
| **Oracle Cloud** (Always Free) | 1 GB AMD VM, or Arm up to 2 OCPU / 12 GB; 200 GB disk; 10 TB traffic | [![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip) |
| **Google Cloud** (Always Free) | one e2-micro (1 GB) in us-central1 / us-west1 / us-east1; 30 GB disk; 1 GB traffic. The public IPv4 may cost ~US$3.65/month | [![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fvikramgorla%2Fwhatsapp-agent-duniya&cloudshell_git_branch=main&cloudshell_tutorial=infra%2Fgcp%2Ftutorial.md) |

Both need a card for sign-up. AWS and Azure only offer 6–12 month trials, Hetzner has no free tier, Fly.io/Render
are not always-on VMs, and "lifetime free VPS" sites such as GratisVPS are not trustworthy (see the research).
Any other Ubuntu/Debian VM works with the one-command installer above.

### Google Cloud (Always Free e2-micro)

Click **Open in Cloud Shell**, confirm, and follow the tutorial on the right: choose a project with billing, run
`bash infra/gcp/deploy.sh`, wait ~15 minutes (live progress at `http://<ip>/`), then open `https://<ip>.sslip.io` with the
setup code it prints. Your own domain: *Settings → Web address & access* in the panel.
Without the button: `git clone` this repository in any shell with `gcloud`, then `bash infra/gcp/deploy.sh --help`.

### Oracle Cloud (Always Free)

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

## Command line (`duniya`)

On an installer server, `sudo duniya <command>` (Docker: `docker compose exec app duniya <command>`). Safe while the
service runs.

| Command | What it does |
|---|---|
| `reset-password <user> [--password PW]` | new password (asks, or makes one up and prints it); signs the account out everywhere |
| `create-user <name> --role admin\|viewer\|owner`, `list-users`, `set-role`, `remove-user` | manage panel accounts |
| `enable-password-login` | switch passwords back on if "Only allow Sign in with Google" locked you out |
| `show-setup-code` | the one-time code that creates the first owner |
| `status` | version, uptime, WhatsApp numbers, bots, last backup |
| `doctor` | checks DNS, HTTPS, ports, disk, memory, swap and prints fixes |
| `backup-now`, `restart`, `logs [-f]`, `update [--check]` | maintenance |
| `open-access` | remove the IP allow-list if it locked you out of the panel |

## Your own domain and IP allow-list

*Settings → Web address & access* (owner): enter a domain, **Check DNS** shows the record to create, **Use this
domain** gets the certificate — if HTTPS does not come up within 4 minutes the previous address comes back by itself.
**Who can open the panel**: everyone, **Only Cloudflare** (Cloudflare's published IP ranges, refreshed daily; the real
visitor address is used behind the proxy), or your own list of IPs/ranges (your current IP is always kept). Applied by
the root maintenance helper with strict validation; needs the installer (re-run it once on older servers).

## Manage it from ChatGPT or Claude

The app is also an MCP server, so you can run it by chatting: "which bots are on?", "turn off the carpool bot",
"what happened in the Panduga group today?". Open **Settings → Connected AI assistants**, copy the address
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
`specs/017-admin-mcp/`.

## Mobile app (preview)

A native iOS and Android app (React Native with Expo) for owners and admins: status, agents, chats, activity, usage,
server updates and waiting confirmations. While in preview it runs in **Expo Go**: open **Settings → Mobile app** in
the panel and follow the three steps (install Expo Go, open the app, scan the connect QR code). The app signs in with
your panel account through the panel's own OAuth sign-in and can do what your account can do. Developer notes and
store-build instructions: [`mobile/README.md`](mobile/README.md). The server never installs `mobile/`.

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
- **Bot templates** (`templates/`): New bot, School friends, Family, Car pooling, Office colleagues, Event planning,
  Neighbours. Bots themselves are data in the app (export/import as JSON).

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

### Optional settings (environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | from the request | Public address of the panel (set by the installer); used for sign-in redirects and the MCP address |
| `BACKUP_UPLOAD_MAX_MB` | 200 | Largest backup file accepted by "Restore from a file" |
