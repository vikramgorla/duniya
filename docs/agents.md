# Agents, tools and memory

**An agent is data, not code: instructions, triggers, organizers, tools, a model, memory, a cap and scheduled posts.**

**Do it:** panel → **Agents → New agent** → pick a template, or **Create an agent with AI**.

**In 30 seconds**
- Template or plain words; every change comes back as a visual diff.
- Tools are allowed per role **in code**; changes need an organizer's `confirm CODE` (kept across restarts until it expires).
- Memory per chat and shared across chats; export/import agents as JSON.

![Agents page](site/img/agents-desktop.webp)


> [!TIP]
> **Triggers work anywhere in a message.** "can mochi help with this?" wakes the agent whose trigger is `mochi`, the
> same as "mochi, help". Only whole words count (`mochiko` doesn't), case doesn't matter, and when several agents'
> triggers appear, the first one in the message wins. In your own direct chat with the owner assistant, a trigger only
> hands the message to that agent when the message *starts* with it, so you can talk *about* agents freely.

## Create and change agents

| Way | How |
|---|---|
| **Templates** (`templates/`) | New agent, School friends, Family, Car pooling, Office colleagues, Event planning, Neighbours |
| **AI helper** | Describe the agent ("a helper for our running club that posts Sunday's run every Saturday") or a change ("shorter replies, make Lea an organizer") |
| **Import** | An agent exported as JSON |

The AI helper shows before → after for model, triggers, organizers, tools and schedules, and the instructions word by
word (*Changes only*, *Side by side*, *Whole new text*). Skip any part; nothing is saved until you apply. Admin MCP:
`draft_agent_with_ai`.

![AI helper visual diff](site/img/card-ai-diff.webp)

## Roles

| Role | Who | Gets |
|---|---|---|
| **Organizer** | phone numbers saved on the agent; while none are saved, the WhatsApp admins of its groups | organizer tools; confirms changes |
| **Participant** | everyone else in a bound group | participant tools |

> [!IMPORTANT]
> The model never sees or calls the confirm tool. Permissions are decided in code, not by the prompt.

## Tool services (MCP)

<p align="center"><img src="diagrams/tool-permissions.svg" alt="Tool permissions: a tool not allowed for the role is never offered; an allowed tool that changes something is held as a preview until an organizer replies confirm CODE; other tools run directly" width="442"></p>

<details><summary>Diagram as text</summary>

1. The model wants to use a tool.
2. Is the tool allowed for this role? If not, it is not offered at all.
3. Does it change something? If not, it runs.
4. If it does, a preview is held and an organizer replies `confirm CODE`; then it runs.

</details>

1. Agent page → tool services → enter the URL → **Check**.
2. **Connect** to sign in (OAuth, your own OAuth app), or use a token or custom headers.
3. **Discover tools** → tick what participants and organizers may use → save.

Or skip the URL hunting: **Browse tool services** (below).

### Browse tool services (MCP Registry)

**Find a service in the official [MCP Registry](https://registry.modelcontextprotocol.io) and add it in one step.**

1. Agent page → Tool services → **Browse tool services** (or **Settings → Tool services** for all agents).
2. Search by name. Each card shows the publisher, **Hosted** or **Local (npm)**, the keys it needs, a trust hint and a
   link to its source code.
3. **Add** → fill in what it asks for (keys are stored as secrets and never shown again) → the tools are listed with
   **organizers on, participants off**; tools that change things are marked. A service that previews changes
   (`*_preview` + `confirm`) gets the agent's confirm step.
4. Sign-in services (OAuth) get a **Connect** button; local packages an **Install and list tools** button.

| Badge | Meaning |
|---|---|
| Verified publisher | The publisher signed in to the registry with that GitHub account (`io.github.<owner>/…`) or proved the domain (`com.example/…`) |
| Source linked | The entry links its source code |
| Check before adding | No source code for a hosted service, source under another account, or deprecated |
| Not supported here | PyPI, Docker (OCI), NuGet and MCPB packages and SSE-only hosts: this app runs only streamable-HTTP hosts and npm packages over stdio |

> [!WARNING]
> **Local packages run code on this server.** Only the owner can add them, and they are refused on small servers
> (1 GB / 1 CPU): choose a hosted one there. A trust hint says who published an entry, not that the code is safe.

> [!NOTE]
> **Settings → Tool services → MCP Registry** (owner): switch browsing off, or point it at a private registry with the
> same API (https). The panel only talks to that registry host, sends no credentials, and caches answers for 5
> minutes. Admin MCP and the owner assistant: `search_mcp_registry`, `add_tool_service_from_registry` (confirm
> required; keys are set with `set_secret` or in the panel, never passed to the tool).

Local services from npm or GitHub are owner-only (scrubbed environment, install scripts off unless allowed).

**Global tool services** (035): define once under **Settings → Tool services** for every agent.

- An agent can switch one off (`globalMcp.disabled`); an agent's own service with the same name replaces it.
- Tools still follow the agent's `server:tool` rules; without explicit rules a role gets the service's defaults
  (`server:-` = none).
- OAuth sign-ins are per service (shared by all agents).
- Admin MCP: `list_global_tool_services`, `add_global_tool_service`, `remove_global_tool_service`.

> [!TIP]
> The standard way to give agents ready-made tools is **MCP**: add a tool service (Agents → Tool services, or
> Settings → Tool services for all agents), e.g. with [Browse tool services](#browse-tool-services-mcp-registry) from
> the official MCP Registry. Duniya has no code plugins (removed in 2.16.0).

## WhatsApp actions

23 actions, chosen per role: send images, documents, voice notes, locations and contact cards, react, run polls and
read votes, and (organizers) manage the group: name, description, picture, settings, invite link, members. Every
action is logged (`whatsapp.action`). Admins get the same group tools on **Chats** (a group's *WhatsApp* card).

![WhatsApp card of a group](site/img/card-wa-group.webp)

## Memory

| | What | Who writes |
|---|---|---|
| **Chat memory** | recent messages, a running summary and notes per chat; limits `MEMORY_RETENTION_DAYS`, `MEMORY_MAX_MESSAGES` | the agent |
| **Shared memory** | notes across all of an agent's chats (agent page → *Shared memory*) | organizers only, so one group can't plant facts for another |

Admins can read, search (each look logged), rebuild or erase it. Tools:
`memory__remember`, `list_notes`, `find_notes`, `update_note`, `forget` (last two organizers only), `search_history`.

![Memory card](site/img/card-memory.webp)

### Earlier messages when a chat is switched on

Chats start **off**, so the history WhatsApp sends when you link a number is not stored (only the id and time of each
chat's newest message are kept). When you switch a chat **on**, the server asks your phone for its recent messages
(default 50; *When a chat is switched on, load its last …* on **Chats**, 0–200) and builds the running summary from
them. The chat row shows *Loading recent messages from your phone…*, then *Loaded N earlier messages*.

- **Load recent messages** on a chat that is on asks for the messages before the oldest stored one (again for older
  ones; at most every 30 s). Admin MCP: `load_chat_history`.
- The phone must be **online** (WhatsApp answers from the phone, not from the server). No answer within a minute →
  *Your phone didn't send history (keep it online and try again)*.
- The agent is told what it has ("12 stored messages since 3 Nov …", or "none yet") and says so instead of guessing.

> [!NOTE]
> The newest message seen while the chat was off is the starting point, so that one message is not loaded itself.

## Contacts

Names synced from the linked phone(s) plus your own entries with notes (**Contacts**). Agents look people up
(`contacts__find_contact`): participants only see contacts marked **Shared**; organizers see all and can save or
remove entries.

## Several WhatsApp numbers and direct messages

- Link more numbers on **Overview** (QR or pairing code). Replies leave from the number the chat belongs to.
- Each number chooses which agent takes direct messages (or the default under **Settings → Direct messages**); a
  person can be assigned an agent on **Chats**.
- Chats on the first number keep their WhatsApp id; others are `<number>#<jid>`.

### Set up a direct chat before the person writes

1. **Chats → + Add a direct chat** (or **Contacts → Set up chat** on a person's row).
2. Enter the number with country code (`+41 79 123 45 67`) or pick a contact; pick the WhatsApp number if you have
   several.
3. Choose the agent, **On** and, if you like, **Private to members**, then **Set up chat**. Model, logging, fallback and
   spending cap are on the same row afterwards.

The chat shows **Waiting for the first message** until the person writes; that message goes straight to the agent
with these settings. WhatsApp sometimes delivers a person's messages from a private id (`…@lid`) instead of their
number: the app matches it to the prepared chat by phone (or by the id WhatsApp shared when the number was checked)
and keeps using the one chat, so replies, memory and settings stay together.

> [!NOTE]
> A number that does not seem to be on WhatsApp gets a warning but can still be set up. Nothing is sent to the
> person. **Send intro…** on the row lets the agent write first: you see the exact text (and the privacy line, the
> first time) and it goes out only when you press **Send intro now**. A chat that is off never gets one.

Owner assistant and admin MCP: `prepare_direct_chat` (with `send_intro` it needs a confirmation) and
`send_chat_intro` (always confirmed).

---
**Next:** [Models](models.md) · [Owner assistant](owner-assistant.md) · [Privacy](privacy.md) · [Docs index](README.md)
