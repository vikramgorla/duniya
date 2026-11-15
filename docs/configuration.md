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
| `--tailscale-authkey <tskey-…>` | `https://<machine>.<tailnet>.ts.net`, only for devices in your tailnet (turn on MagicDNS and HTTPS Certificates in the Tailscale admin console; Tailscale Funnel can make it public) | none |
| `--local-only` | `ssh -L 8080:127.0.0.1:8080 you@server` → `http://localhost:8080`, or any tunnel of your own (e.g. frp, ngrok, Pangolin, zrok) pointed at `http://127.0.0.1:8080` | none |

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
- *Remove everything:* run **Destroy**, then **Delete stack**. Take a backup first if you want to keep your agents.

Runs comfortably on a 1 GB VM (~180 MB RAM).

## Deploy on a free cloud VM

Two providers give you a server that stays free (checked November 2026, sources in
[specs/030-free-vms/research.md](../specs/030-free-vms/research.md)). Both buttons create the VM and run the same installer.

| Provider | Free server | Button |
|---|---|---|
| **Oracle Cloud** (Always Free) | 1 GB AMD VM, or Arm up to 2 OCPU / 12 GB; 200 GB disk; 10 TB traffic | [![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip) |
| **Google Cloud** (Always Free) | one e2-micro (1 GB) in us-central1 / us-west1 / us-east1; 30 GB disk; 1 GB traffic; Google's free-tier guide says its external IP is not charged (static IPs, more VMs and Cloud NAT are) | [![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fvikramgorla%2Fwhatsapp-agent-duniya&cloudshell_git_branch=main&cloudshell_tutorial=infra%2Fgcp%2Ftutorial.md) |

Both need a card for sign-up. AWS and Azure only offer 6–12 month trials, Hetzner has no free tier, Fly.io/Render
are not always-on VMs, and "lifetime free VPS" sites such as GratisVPS are not trustworthy (see the research).
Any other Ubuntu/Debian VM works with the one-command installer above.

### Google Cloud (Always Free e2-micro)

Click **Open in Cloud Shell**, confirm, and follow the tutorial on the right: choose a project with billing, run
`bash infra/gcp/deploy.sh`, wait ~15 minutes (live progress at `http://<ip>/`), then open `https://<ip>.sslip.io` with the
setup code it prints. Your own domain: *Settings → Web address & access* in the panel.
Without the button: `git clone` this repository in any shell with `gcloud`, then `bash infra/gcp/deploy.sh --help`.

How the panel is reached (`--exposure`):

| Mode | Panel | Firewall | Cost |
|---|---|---|---|
| `public` (default) | `https://<ip>.sslip.io`, later your domain | tcp 80, 443 (rule `duniya-web`) | free |
| `cloudflare --cloudflare-token …` | your Cloudflare Tunnel hostname | no rule for 80/443 | free |
| `tailscale --tailscale-authkey …` | `https://<vm>.<tailnet>.ts.net` (your devices only) | no rule for 80/443 | free |
| add `--no-external-ip` (tunnel modes only) | same | no external IP at all; outbound through Cloud NAT | **billed**: ~US$0.0014/h gateway + US$0.005/h NAT IP + US$0.045/GiB ≈ US$4.70/month + traffic |

The VM needs outbound internet (WhatsApp, AI providers). Its ephemeral external IP does that for free — Google's
free-tier guide states the free tier does not charge for an external IP address — so keep it unless you really want
no public address. A reserved (static) IP, an IP on a second VM, or Cloud NAT is billed
([VPC pricing](https://cloud.google.com/vpc/pricing), [Cloud NAT pricing](https://cloud.google.com/nat/pricing)).
Google's default network still allows SSH (port 22) unless you remove the `default-allow-ssh` rule.

Oracle Cloud details (managing the stack, logs, removal) are in the section above.

## Your own domain, proxies/CDNs and access

*Settings → Web address & access* (owner). Applied by the root maintenance helper with strict validation (re-run the
installer once on older servers). If HTTPS does not come up within 4 minutes, the previous settings come back by
themselves; the check always runs on the server itself (127.0.0.1 with the domain as SNI), never through public DNS.

**Does the domain lead here?** **Check** looks at DNS only as a hint (*points straight here*, *behind a proxy/CDN
(looks like …)*, *other*, *missing*). What decides is a one-time proof: the panel serves a random token at
`/.well-known/duniya-check/<token>` and fetches it through the public domain. So a domain behind any proxy or CDN works,
whatever its DNS says.

**HTTPS is automatic in every mode:**

| The domain… | Certificate on this server | Proxy SSL/TLS mode |
|---|---|---|
| points straight here (no proxy) | Let's Encrypt (HTTP-01 / TLS-ALPN) | – |
| goes through a proxy/CDN (any provider) | Let's Encrypt through the proxy (HTTP-01); until it is issued, a temporary certificate from the web server's own CA (2-hour certificates, Let's Encrypt is retried about every 80 minutes) | **Full** at once, **Full (strict)** once the card says the real certificate is issued |

The panel is served over HTTPS only; port 80 only answers certificate challenges, the reachability token and
redirects. A proxy that talks to this server **without encryption** is never supported: it is detected (the token
arrives over plain HTTP although the visitor used HTTPS, or a redirect loop) and shown as a blocking error. If Let's
Encrypt keeps failing behind a proxy, the card shows the web server's reason and the fix (typically a firewall/bot rule
blocking `/.well-known/acme-challenge/`: add a rule that skips security checks for that path, and turn off
"under attack" style challenges for it). Let's Encrypt follows redirects to HTTPS, so a proxy's "always use HTTPS"
setting is fine.

**Changing the address is two-step and never cuts you off:** *Add this domain* serves it **next to** the current
address. Open the panel at the new address and click **Confirm — new address works** (accepted only from a request
that really arrived through the new domain); it becomes the main address while the old one keeps working. When nobody
needs the old address any more, **Turn off** it (it then only forwards). Nothing switches off on a timer.

**Who can open the panel:** everyone; **only a proxy/CDN** — its published address list, refreshed daily (Amazon
CloudFront, Bunny CDN, Cloudflare, Fastly, Gcore) or your own proxy's ranges — so nobody can bypass it via the server's
IP; and/or **your own list** of IPs/ranges (your current IP is kept by default). The visitor's real address is read
from the provider's header behind trusted proxies only (Cloudflare: `CF-Connecting-IP`; others: `X-Forwarded-For`
read right to left, which needs Caddy 2.8+ when combined with your own list). Stricter rules are a **trial**: confirm
them from the panel (through the new rules) within 10 minutes, or the previous rules come back by themselves; a
warning comes first if the rules would block the request you are making. Locked out anyway: `sudo duniya open-access`.

**No open ports at all:** install with a tunnel instead — Cloudflare Tunnel (`--cloudflare-token`) or Tailscale
(`--tailscale-authkey`; Tailscale Funnel can make it public). Other tunnels (frp, ngrok, Pangolin, zrok, …) work with
`--local-only` pointed at `http://127.0.0.1:8080`.

## Command line (`duniya`)

On an installer server, `sudo duniya <command>` (Docker: `docker compose exec app duniya <command>`). Safe while the
service runs.

| Command | What it does |
|---|---|
| `reset-password <user> [--password PW]` | new password (asks, or makes one up and prints it); signs the account out everywhere |
| `create-user <name> --role admin\|viewer\|owner`, `list-users`, `set-role`, `remove-user` | manage panel accounts |
| `enable-password-login` | switch passwords back on if "Only allow Sign in with Google" locked you out |
| `show-setup-code` | the one-time code that creates the first owner |
| `status` | version, uptime, WhatsApp numbers, agents, last backup |
| `doctor` | checks DNS, HTTPS, ports, disk, memory, swap and prints fixes |
| `backup-now`, `restart`, `logs [-f]`, `update [--check]` | maintenance |
| `open-access` | remove the IP allow-list if it locked you out of the panel |

## Mobile app (preview)

A native iOS and Android app (React Native with Expo) for owners and admins: status, agents, chats, activity, usage,
server updates and waiting confirmations. While in preview it runs in **Expo Go**: open **Settings → Mobile app** in
the panel and follow the three steps (install Expo Go, open the app, scan the connect QR code). The app signs in with
your panel account through the panel's own OAuth sign-in and can do what your account can do. Developer notes and
store-build instructions: [`mobile/README.md`](../mobile/README.md). The server never installs `mobile/`.

## Upgrading from 1.x to 2.0

2.0 renames bots to agents everywhere (database tables, settings, API paths such as `/api/agents`, admin MCP tool
names such as `create_agent`, export files `duniya-agent`) and has **no migration**: a 1.x database, a 1.x backup or a
1.x agent export cannot be used. Install 2.0 on a fresh server (or remove the data directory), link WhatsApp again and
set the agents up again (the AI helper and templates make this quick).

## First steps in the panel

1. **Setup**: enter the setup code, choose your username and password.
2. **Overview**: scan the QR with the agent's WhatsApp (*Settings → Linked devices*), or use a pairing code.
3. **Models**: connect OpenRouter in one tap, paste an Anthropic or OpenAI key, add an OpenAI-compatible endpoint,
   *Sign in with ChatGPT*, or connect GitHub Copilot.
4. **Agents → New agent**: pick a template (or *Create an agent with AI*), write the instructions, add organizers, connect
   tool services (URL → *Check* → *Connect* to sign in, or a token; *Discover tools* → tick per role), save. Use the
   **test console** to try it. Tool services every agent should have (a calendar, a shared planner) go under
   **Settings → Tool services** instead: add them once, tick the default tools per role, and switch them off per agent
   if needed (see below).
5. Add the agent number to a WhatsApp group. **Chats** → switch the chat **on** and choose the agent. Chats are off until
   you switch them on: agents ignore them completely (nothing stored, no model call).
6. In the group: `!yourtrigger hello` (or @mention the agent).
7. **Backups**: set a passphrase, connect GitHub or S3, turn on the schedule.

## Manage it from ChatGPT or Claude

The app is also an MCP server, so you can run it by chatting: "which agents are on?", "turn off the carpool agent",
"what happened in the school group today?". Open **Settings → Connected AI assistants**, copy the address
(`https://YOUR-HOST/mcp`) and follow the short steps shown there:

- **ChatGPT**: Settings → Apps & Connectors → Advanced settings → turn on Developer mode; then Create a connector with
  the address as MCP server URL and OAuth.
- **Claude**: Settings → Connectors → Add custom connector → paste the address → Add → Connect.

A Duniya page opens: sign in (if asked), check what the assistant may do, and click **Approve**. The assistant acts as
you, with your panel role (viewers stay read-only; owner-only actions stay owner-only). Risky actions (deleting an agent,
erasing memory, secrets, users, WhatsApp numbers, backups restore, updates, restarts) return a preview and only happen
after a second `confirm_action` call. Every call is in the activity log ("AI assistants (MCP)"); disconnect an
assistant any time in the same card.

It needs the panel reachable over public HTTPS (Caddy or Cloudflare Tunnel). Behind a proxy set `TRUST_PROXY=1`, or set
`PUBLIC_URL=https://your-host` so the OAuth issuer and MCP address are fixed. Under the hood: OAuth 2.1 with dynamic
client registration, PKCE S256, resource-bound tokens (access 1 h, refresh 30 days with rotation), see
[`specs/017-admin-mcp/`](../specs/017-admin-mcp/spec.md).

## How it works

```
WhatsApp (linked device) ─► allow-list ─► router ─► agent (stored in the app) ─► model provider
                                            │            ├─ MCP tool services (per-role allow lists, enforced in code)
                                            │            ├─ WhatsApp actions (media, reactions, polls, group admin)
                                            │            ├─ memory: recent messages + running summary + notes + search
                                            │            └─ plugins (optional code: tools, commands)
                                            └─ confirm gate: *_preview results held; an organizer replies "confirm CODE"
Admin panel (localhost:8080 behind Caddy / Cloudflare Tunnel / SSH) · SQLite · encrypted secrets & backups
```

- **Chats** are off by default (#10). Messages from chats that are off are dropped before storage and before any
  model call.
- **Roles**: organizers (phone numbers per agent; while none are saved, the WhatsApp admins of its groups) get organizer
  tools and can confirm changes; everyone else in a bound group is a participant. The model never sees or calls the
  confirm tool.
- **Panel users**: owner (everything), admin (agents, chats, models, memory), viewer (read-only). Sign in with a
  password or Google; owners invite people by email.
- **Models**: OpenRouter (optionally free models only), Anthropic API key, OpenAI API key, any OpenAI-compatible
  endpoint (Ollama, …), your ChatGPT Plus/Pro plan via Sign in with ChatGPT, or your GitHub Copilot allowance via the
  official Copilot SDK (downloaded only if you connect it). Pick per agent and per chat, or *Auto*.
- **Fallback and several accounts** (042): when a model hits a rate or usage limit, runs out of credit, is down, times
  out or its sign-in expired, the agent answers with the next model of the fallback chain (**Models → When a model
  fails**; default: any other connected provider's Auto; per agent and per chat: inherit / switch / don't switch, own
  chain). Refused requests (400) never switch, and tools that already ran never run again. A failing account is paused
  (1 min, doubling to 30 min; usage limits until the provider's reset time) and shown as "Paused until 14:20 — usage
  limit reached"; the owner gets a WhatsApp alert after 15 minutes or when no provider can answer. Each provider can
  have several accounts with a label (model refs `openai-work:gpt-…`), used *in order* (failover) or *spread* (least
  recently used). Use your own accounts: some plans' terms forbid sharing accounts or getting around their limits.
- **Global tool services** (035): MCP servers defined once under **Settings → Tool services** are available to every
  agent. An agent can switch one off (`globalMcp.disabled` in its config), and an agent's own service with the same name
  replaces the global one for that agent. Tools still follow the agent's `server:tool` rules; for a role without explicit
  rules for that service, the service's defaults apply (`server:-` = none). OAuth sign-ins are per service (shared by
  all agents); local (npm/GitHub) services are owner-only. Admin MCP tools: `list_global_tool_services`,
  `add_global_tool_service`, `remove_global_tool_service`.
- **Spending caps** (040, #35): monthly caps per agent (agent page) and per chat (**Chats → Spending cap**), by cost in
  USD (counts only priced calls: your prices, provider-published prices, plans and free models) and/or by tokens. At 80%
  the owner gets one WhatsApp alert; at 100% the agent stays quiet in that scope (or switches to a cheaper model you
  chose) until the month ends (server timezone). Bars on **Usage**. Admin MCP tools: `get_spending_caps`,
  `set_spending_cap`.
- **Owner alerts and weekly summary** (041, #38): under **Settings → Owner alerts on WhatsApp** the owner enters their
  number. Cap alerts go there, and a weekly summary (on by default once a number is set; day and time configurable):
  messages handled, replies and cost per agent this week vs last, ignored chats, pending confirmations, update available,
  backup failures — counts only, never message contents. **Send now** sends it at once. Admin MCP tools:
  `get_owner_alerts`, `set_owner_alerts`, `preview_weekly_summary`, `send_weekly_summary`.
- **Plugins** (`plugins/<name>/index.js`) add local tools or commands for advanced cases; see `plugins/example-dice`.
- **Agent templates** (`templates/`): New agent, School friends, Family, Car pooling, Office colleagues, Event planning,
  Neighbours. Agents themselves are data in the app (export/import as JSON).
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
| `RATE_LIMIT_PER_MIN` | 6 | Requests one person may make to one agent per minute |
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
node scripts/demo-panel.mjs                   # seeded demo panel on :8099 (admin / demo-password-123), no network
npm run check:responsive                      # every screen at 375 / 393 / 1440 px, light + dark (needs Chrome)
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

- Use a **dedicated WhatsApp number**. Unofficial clients can be banned; agents only reply when addressed and are
  rate-limited to keep that risk low. Tell your groups that the assistant keeps context.
- Claude **subscriptions** (Pro/Max) can't be used by third-party apps under Anthropic's terms, so Claude needs an
  API key. ChatGPT plan usage uses OpenAI's official open-source flow (preview).
- GitHub *device login* for backups needs a GitHub OAuth App client id (Device Flow enabled); the one-click GitHub App
  or pasting a token always works.
