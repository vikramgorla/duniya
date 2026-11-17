# Duniya guides

**Everything you need to run AI agents in your WhatsApp groups, in the order you'll need it.**

<p>
  <a href="install.md"><img src="img/btn-install.svg" alt="Install on any server" height="32"></a>
  <a href="https://vikramgorla.github.io/whatsapp-agent-duniya/"><img src="img/btn-website.svg" alt="See the website" height="32"></a>
</p>

**In 30 seconds**
- New here? Follow **1 → 8** below: install, then the panel's *Getting started* does the rest in about five taps.
- Every page opens with what it is for, the one thing to do and a 30-second summary.
- Already running? Jump to [Run your server](#run-your-server). Something missing? Press **/** in the panel.

## Start here

| | Step | Guide | Use this when… |
|---|---|---|---|
| <img src="img/thumb-overview.webp" alt="" width="120"> | **1** | **[Install](install.md)** | you want Duniya on a server: one click on Oracle or Google Cloud, or one command |
| <img src="img/thumb-checklist.webp" alt="" width="120"> | **2** | **[Getting started](getting-started.md)** | the panel is open: five taps to a first answer, and *Where is my panel?* |
| <img src="img/thumb-whatsapp.webp" alt="" width="120"> | **3** | **[Connect WhatsApp](whatsapp.md)** | you link the agents' number (QR or pairing code), or add another one |
| <img src="img/thumb-fallback.webp" alt="" width="120"> | **4** | **[Add a model](models.md)** | you connect OpenRouter, ChatGPT, Claude, OpenAI, Copilot or Ollama, with a backup model |
| <img src="img/thumb-agents.webp" alt="" width="120"> | **5** | **[Agents](agents.md)** | you create your first agent, test it, review its answers, give it tools and quick replies |
| <img src="img/thumb-chats.webp" alt="" width="120"> | **6** | **[Chats](chats.md)** | you switch groups on, set up a person's chat, search messages, sort out names |
| <img src="img/thumb-ask.webp" alt="" width="120"> | **7** | **[Owner assistant](owner-assistant.md)** | you want your own agent in your WhatsApp and the Ask box: recaps, sends, alerts, weekly summary |
| <img src="img/thumb-phone.webp" alt="" width="120"> | **8** | **[Everyday use](everyday.md)** | you use Overview, Find anything, *Why didn't it answer?*, Activity, and the panel on your phone |

> [!WARNING]
> Use a **dedicated WhatsApp number**: Duniya links as an unofficial client, and those can be banned.

## More for agents and models

| | Guide | Use this when… |
|---|---|---|
| <img src="img/thumb-photos-voice.webp" alt="" width="120"> | **[Photos & voice](models.md#photos--voice)** | agents should see photos, hear voice notes or reply with voice |
| <img src="img/thumb-usage.webp" alt="" width="120"> | **[Usage & spending caps](spending.md)** | you want to see or limit what it costs |
| <img src="img/thumb-mcp.webp" alt="" width="120"> | **[Tool services (MCP)](agents.md#tool-services-mcp)** | agents need real tools: a calendar, a planner, GIFs |
| <img src="img/thumb-assistants.webp" alt="" width="120"> | **[Manage from ChatGPT or Claude](admin-mcp.md)** | you want to run Duniya by chatting with an AI assistant |
| <img src="img/thumb-privacy.webp" alt="" width="120"> | **[Privacy](privacy.md)** | you want to know what is stored, who sees it, and what groups are told |

## Run your server

| | Guide | Use this when… |
|---|---|---|
| <img src="img/thumb-backups.webp" alt="" width="120"> | **[Backups & updates](backups-and-updates.md)** | you set up backups, update, or move to a new server |
| <img src="img/thumb-small-server.webp" alt="" width="120"> | **[Small servers](small-servers.md)** | you run on 1 GB / 1 CPU: what adapts, Health, automatic clean-up |
| <img src="img/thumb-web-access.webp" alt="" width="120"> | **[Domains & access](domains-and-access.md)** | you want your own domain, a proxy/CDN, an IP allow-list, or no open ports |
| `GOOGLE` | **[Sign in with Google](google-sign-in.md)** | people should sign in with Google |
| `2.x` | **[Upgrading](upgrading.md)** | a release needs a step from you |
| `CLI` | **[Command line](cli.md)** | the panel is not enough: lost password, locked out |

<details>
<summary><b>Every task per host</b>: update, recreate, remove, find the IP and logs</summary>

| Hosted on | Update the app | Update the infrastructure | Recreate | Remove | Find IP, logs, errors |
|---|---|---|---|---|---|
| Oracle Cloud stack ([guide](deploy/oci-free-tier.md)) | [panel](deploy/oci-free-tier.md#update-the-app) | [new zip → Plan → Apply](deploy/oci-free-tier.md#update-the-stack-infrastructure) | [Destroy → Apply → restore](deploy/oci-free-tier.md#recreate-from-scratch) | [Destroy, then Delete](deploy/oci-free-tier.md#remove-everything) | [console](deploy/oci-free-tier.md#find-things-fast) · [errors](deploy/oci-free-tier.md#common-errors) |
| Google Cloud script ([guide](deploy/google-cloud.md)) | [panel](deploy/google-cloud.md#update-the-app) | [re-run safely](deploy/google-cloud.md#update-the-infrastructure) | [delete VM → script → restore](deploy/google-cloud.md#recreate-from-scratch) | [VM, firewall rule, IPs](deploy/google-cloud.md#remove-everything) | [console](deploy/google-cloud.md#find-things-fast) · [errors](deploy/google-cloud.md#common-errors) |
| Own server (installer) | [panel / `duniya update`](install.md#update-the-app) | [re-run the installer](install.md#change-how-the-panel-is-reached) | [backup → install → restore](install.md#recreate-from-scratch-new-server-or-fresh-os) | [commands](install.md#remove-duniya-from-a-server) | [where to look](install.md#find-things-fast) |
| Docker ([guide](deploy/docker.md)) | [pull + up](deploy/docker.md#update-the-app) | n/a | [down / new machine](deploy/docker.md#recreate-from-scratch) | [down (-v)](deploy/docker.md#remove-everything) | [commands](deploy/docker.md#find-things-fast) |

Also: [Cloudflare Tunnel](deploy/cloudflare-tunnel.md) · [Terraform + GitHub Actions](deploy/terraform-github-actions.md).
The panel's **Server** page has a **Hosting help** card that links to the right guide.

</details>

## Reference

| | Guide | Use this when… |
|---|---|---|
| `ENV` | **[Optional settings](settings.md)** | you set environment variables for the service |
| `ARCH` | **[How it works](architecture.md)** | you want the big picture: routing, roles, data |
| `DEV` | **[Development](development.md)** | you run it locally, test, take screenshots, release |
| `RULES` | **[AGENTS.md](../AGENTS.md)** | you contribute (people or AI agents): rules and Definition of Done |
| `SECURITY` | **[Security policy](../SECURITY.md)** | you found a vulnerability |

Feature specs: [`specs/`](../specs) · design language: [DESIGN.md](../DESIGN.md).

---
**Next:** [Install](install.md) · [Getting started](getting-started.md) · [Website](https://vikramgorla.github.io/whatsapp-agent-duniya/)
