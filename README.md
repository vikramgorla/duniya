<p align="center">
  <img src="docs/site/img/logo.svg" alt="" width="80" height="80">
</p>

<h1 align="center">Duniya</h1>

<p align="center"><b>AI agents for your WhatsApp groups and chats, on your own free server, run from a calm web panel.</b></p>

<p align="center">
  <a href="https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/vikramgorla/whatsapp-agent-duniya/releases/latest/download/whatsapp-agent-duniya.zip"><img src="https://oci-resourcemanager-plugin.plugins.oci.oraclecloud.com/latest/deploy-to-oracle-cloud.svg" alt="Deploy to Oracle Cloud" height="32"></a>
  <a href="https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https%3A%2F%2Fgithub.com%2Fvikramgorla%2Fwhatsapp-agent-duniya&cloudshell_git_branch=main&cloudshell_tutorial=infra%2Fgcp%2Ftutorial.md"><img src="https://gstatic.com/cloudssh/images/open-btn.svg" alt="Open in Cloud Shell" height="32"></a>
  <a href="https://vikramgorla.github.io/whatsapp-agent-duniya/"><img src="docs/img/btn-website.svg" alt="See the website" height="32"></a>
</p>

<p align="center">
  <a href="docs/README.md"><b>Guides</b></a> · <a href="docs/install.md">Install</a> ·
  <a href="docs/getting-started.md">Getting started</a> · <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <img src="docs/site/img/overview-desktop.webp" alt="The Duniya panel: everything running, the Ask box with a recap of this week's chats, WhatsApp numbers, agents with on/off switches and the server." width="900">
</p>

Duniya links to a spare WhatsApp number and runs helpers in the chats you choose: a car-pool planner, a school-class
assistant, a family organiser. **You** pick which chats they join, which model they use and what they may do. Every
chat is silent until you switch it on.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash
```

Any Ubuntu/Debian server with 1 GB of memory, or one click on Oracle Cloud or Google Cloud (free tiers), or
[Docker](docs/deploy/docker.md). It ends with the panel address and a setup code; **Getting started** on Overview
then takes about five taps: link WhatsApp, connect a model, pick a template, switch a group on, send a test.
[Install guide →](docs/install.md) · [Where is my panel?](docs/install.md#where-is-my-panel-find-the-ip--url)

## Highlights

<table>
<tr>
<td width="25%" valign="top"><a href="docs/agents.md"><img src="docs/img/thumb-agents.webp" alt="AI helper showing a visual diff of an agent change" width="100%"></a><br><b>Agents in plain words</b><br>A template or a sentence; every change as a visual diff. Quick replies and FAQ without AI. Test before, <b>Review &amp; teach</b> after.</td>
<td width="25%" valign="top"><a href="docs/owner-assistant.md"><img src="docs/img/thumb-ask.webp" alt="Ask box with a weekly recap" width="100%"></a><br><b>Your own assistant</b><br>Recaps, GIFs, voice and sends into your groups, in your WhatsApp or the <b>Ask</b> box. Changes wait for your OK.</td>
<td width="25%" valign="top"><a href="docs/chats.md#search-messages-owner"><img src="docs/img/thumb-chats.webp" alt="A chat's page with its agent and recent messages" width="100%"></a><br><b>Find &amp; search</b><br>Press <b>/</b> for any agent, chat or setting, or search what was said in every chat. <i>Why didn't it answer?</i> with a fix.</td>
<td width="25%" valign="top"><a href="docs/models.md"><img src="docs/img/thumb-fallback.webp" alt="When a model fails: fallback settings" width="100%"></a><br><b>Any model, with a backup</b><br>OpenRouter (free models), ChatGPT plan, Claude, OpenAI, Copilot, Ollama. Photos &amp; voice. Spending caps.</td>
</tr>
<tr>
<td valign="top"><a href="docs/privacy.md"><img src="docs/img/thumb-privacy.webp" alt="Privacy notice settings" width="100%"></a><br><b>Silent by default</b><br>Off chats are never stored or sent to a model; groups are told once. Tools are allowed per role, in code.</td>
<td valign="top"><a href="docs/everyday.md#on-your-phone"><img src="docs/img/thumb-phone.webp" alt="The panel on a phone" width="100%"></a><br><b>On your phone</b><br>Installs on your home screen: tab bar at your thumb, live, light and dark. Nothing from a store.</td>
<td valign="top"><a href="docs/small-servers.md"><img src="docs/img/thumb-small-server.webp" alt="Server card for a small server" width="100%"></a><br><b>Made for a 1 GB VM</b><br>~180 MB of RAM. Old data pruned by itself; reconnects, crashes and a full disk handled without you.</td>
<td valign="top"><a href="docs/backups-and-updates.md"><img src="docs/img/thumb-backups.webp" alt="Backups page" width="100%"></a><br><b>Backups &amp; updates</b><br>Encrypted to GitHub or S3. One-click updates that show what's new; breaking ones wait for you. No SSH.</td>
</tr>
</table>

More: [MCP tool services](docs/agents.md#tool-services-mcp) · [manage it from ChatGPT or Claude](docs/admin-mcp.md) ·
[your own domain](docs/domains-and-access.md) · [how it works](docs/architecture.md).

> [!WARNING]
> Use a **dedicated WhatsApp number**: Duniya links as a normal linked device (via
> [Baileys](https://github.com/WhiskeySockets/Baileys)), and unofficial clients can be banned.

<p align="center">
  <a href="docs/README.md"><img src="docs/img/btn-guides.svg" alt="Read the guides" height="32"></a>
</p>

---

<sub>[Feature specs](specs) · [Design language](DESIGN.md) · [AGENTS.md](AGENTS.md) (working rules, Definition of
Done) · [Security policy](SECURITY.md). Duniya is an independent open-source project, not affiliated with, endorsed by
or sponsored by WhatsApp or Meta. WhatsApp is a trademark of its owner.</sub>
