# Duniya documentation

Start with the [README](../README.md) for the pitch and the [website](https://vikramgorla.github.io/whatsapp-agent-duniya/)
for screenshots. These pages are the reference.

**Set up**
- [Install](install.md): one command, Docker, Oracle Cloud and Google Cloud free VMs (public, Cloudflare Tunnel, Tailscale)
- [Getting started](getting-started.md): first steps, first-run checklist, test console and *Test as*, why agents stay quiet
- [Domains, proxies, tunnels and access](domains-and-access.md): your own domain behind any proxy, automatic HTTPS,
  safe switching, IP allow-list
- [Upgrading](upgrading.md): within 2.x, and from 1.x

**Use**
- [Agents, tools and memory](agents.md): templates, AI helper with visual diff, roles, MCP tool services (also global),
  WhatsApp actions, memory, contacts, several numbers and direct messages
- [Models, fallback and photos & voice](models.md): providers incl. Sign in with ChatGPT, Copilot and OpenRouter,
  automatic fallback, several accounts, what each provider can do with photos and voice
- [Owner assistant, alerts and weekly summary](owner-assistant.md): ask about your chats from WhatsApp or the Ask box
- [Usage, cost and spending caps](spending.md)
- [Privacy](privacy.md): silent by default, privacy notice, private chats, logging
- [Manage it from ChatGPT or Claude](admin-mcp.md): the admin MCP server
- [Mobile app (preview)](mobile-app.md)

**Run**
- [Backups and updates](backups-and-updates.md)
- [Small servers](small-servers.md): 1 GB guardrails
- [Command line (`duniya`)](cli.md)
- [Optional settings (environment)](settings.md)
- Deploy guides: [Oracle Cloud](deploy/oci-free-tier.md) · [Docker](deploy/docker.md) ·
  [Cloudflare Tunnel](deploy/cloudflare-tunnel.md) · [Terraform + GitHub Actions](deploy/terraform-github-actions.md)

**Build**
- [How it works](architecture.md)
- [Development](development.md): run locally, tests, demo panel, screenshots, releases
- [AGENTS.md](../AGENTS.md): working rules and the Definition of Done for people and AI agents
- Feature specs: [`specs/`](../specs) · design language: [DESIGN.md](../DESIGN.md)

**Notes**
- Use a **dedicated WhatsApp number**. Unofficial clients can be banned; agents only reply when addressed and are
  rate-limited to keep that risk low. Tell your groups that the assistant keeps context.
- Claude **subscriptions** (Pro/Max) can't be used by third-party apps under Anthropic's terms, so Claude needs an
  API key. ChatGPT plan usage uses OpenAI's official open-source flow (preview).
- GitHub *device login* for backups needs a GitHub OAuth App client id (Device Flow enabled); the one-click GitHub App
  or pasting a token always works.
