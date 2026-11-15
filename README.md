<p align="center">
  <img src="docs/site/img/logo.svg" alt="" width="72" height="72">
</p>

<h1 align="center">Duniya</h1>

<p align="center"><b>AI agents for your WhatsApp groups and chats, on your own server, managed from a calm web panel.</b></p>

<p align="center">
  <a href="https://vikramgorla.github.io/whatsapp-agent-duniya/">Website</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <img src="docs/site/img/overview-desktop.webp" alt="The Duniya panel: everything running, the Ask box with a recap of this week's chats, two WhatsApp numbers connected and agents with on/off switches." width="900">
</p>

## Highlights

- **Agents from templates or plain words.** School friends, Family, Car pooling, Office, Event planning, Neighbours —
  or describe one and the AI helper drafts it; every change comes back as a friendly visual diff to review before
  saving. Test console with *Test as* (participant or organizer, in a group or a direct chat). [Agents](docs/agents.md)
- **Silent by default.** Every chat is off until you switch it on; off chats are never stored or sent to a model.
  Groups get a one-time privacy notice (your text, per-group opt-out). [Privacy](docs/privacy.md)
- **Owner assistant.** Ask about all your chats from your own WhatsApp or the **Ask** box on Overview: recaps, who
  said what, why a group is quiet; changes need `confirm CODE`. [Owner assistant](docs/owner-assistant.md)
- **Several numbers, groups and direct messages.** Linked-device login by QR or pairing code, no commercial API.
- **Any model, with a backup.** Sign in with ChatGPT, GitHub Copilot, OpenRouter (free models), Anthropic or OpenAI
  keys, Ollama and compatible endpoints, or *Auto*. Automatic fallback when a model hits a limit, is down or its
  sign-in expired; several accounts per provider. [Models](docs/models.md)
- **Photos & voice.** Agents see photos and PDFs, transcribe voice notes, create pictures and reply with voice notes
  when a provider can (OpenAI key, OpenRouter paid models; Claude for photos). Sign in with ChatGPT and Copilot cover
  text and photos only — OpenAI doesn't offer transcription, images or speech for plan sign-in.
  [Photos & voice](docs/models.md#photos--voice)
- **Memory and contacts.** Notes per chat and shared across an agent's chats (organizers write shared notes);
  phone contacts plus your own list, shared with participants only when you say so.
- **WhatsApp powers.** Media, reactions, polls, group admin — chosen per role.
- **Spending caps and a weekly summary.** Monthly caps per agent or chat; an 80 % alert and a weekly WhatsApp summary
  (counts only). [Usage & caps](docs/spending.md)
- **"Why didn't it answer?"** Reasons per chat (not mentioned, chat off, rate limit, cap…) with one-click fixes.
- **Real tools via MCP.** Remote servers with OAuth or tokens, local ones from npm/GitHub; per agent or once for all
  agents; per-role allow lists enforced in code and a confirm step for changes.
- **Manage it from ChatGPT or Claude.** The app is an MCP server (OAuth 2.1, your panel role, confirmations).
  [Admin MCP](docs/admin-mcp.md)
- **Your domain behind any proxy.** Automatic HTTPS, a two-step address switch that never locks you out, an IP
  allow-list, or no open ports with Cloudflare Tunnel or Tailscale. Google-only sign-in.
  [Domains & access](docs/domains-and-access.md)
- **Run it without SSH.** Server health, OS and app updates, encrypted backups to GitHub, S3 or a download, a
  `duniya` CLI for recovery, and a native mobile app (preview, Expo Go). [Backups & updates](docs/backups-and-updates.md)
- **Free to host.** Oracle Cloud or Google Cloud free tiers; ~180 MB of RAM. 1 GB servers get guardrails: a photo &
  voice queue (nobody resends), memory checks, no heavy add-ons. [Small servers](docs/small-servers.md)

## Quick start

**Oracle Cloud (free, one click)**

[![Deploy to Oracle Cloud](https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg)](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip)

Pick your home region, click **Apply**, and open `http://<server-ip>/` to follow the install.
[Walkthrough](docs/deploy/oci-free-tier.md).

**Google Cloud (free e2-micro)**

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fvikramgorla%2Fwhatsapp-agent-duniya&cloudshell_git_branch=main&cloudshell_tutorial=infra%2Fgcp%2Ftutorial.md)

Follow the tutorial on the right. Public (`https://<ip>.sslip.io`, later your domain), or no open ports with
`--exposure cloudflare` or `--exposure tailscale`. [Details and costs](docs/install.md#google-cloud-always-free-e2-micro).

**Any Ubuntu/Debian server (x86_64 or arm64)**

```bash
curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash
```

The installer prints the panel address and a one-time setup code; the first-run checklist takes it from there (link a
dedicated WhatsApp number, connect a model, create an agent, switch a chat on). Options (`--ip-https`, `--domain`,
Cloudflare Tunnel, Tailscale, Docker): [Install](docs/install.md). Coming from 1.x: [Upgrading](docs/upgrading.md).

## Learn more

- [Documentation index](docs/README.md) · [Website with screenshots and short videos](https://vikramgorla.github.io/whatsapp-agent-duniya/)
- [Mobile app](mobile/README.md) · feature specs in [`specs/`](specs) · design language in [DESIGN.md](DESIGN.md)
- [Contributing](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) (working rules, Definition of Done) · [Security policy](SECURITY.md)

> Use a dedicated WhatsApp number: Duniya links as a normal linked device (via
> [Baileys](https://github.com/WhiskeySockets/Baileys)), and unofficial clients can be banned.
>
> Duniya is an independent open-source project, not affiliated with, endorsed by or sponsored by WhatsApp or Meta.
> WhatsApp is a trademark of its owner.
