# Agents, tools and memory

An agent is data in the app: instructions, triggers, organizers, tool services, WhatsApp actions, a model, memory
settings, a spending cap and scheduled posts. Create one from a template or with the AI helper, export it as JSON and
import it elsewhere. No agent needs code.

## Create and change agents

- **Templates** (`templates/`): New agent, School friends, Family, Car pooling, Office colleagues, Event planning,
  Neighbours.
- **AI helper**: describe the agent in plain words ("a helper for our running club that posts Sunday's run every
  Saturday") or a change ("shorter replies, make Lea an organizer"). The proposal comes back as a friendly visual diff:
  model, triggers, organizers, tools and schedules as before → after, the instructions word by word (*Changes only*,
  *Side by side*, *Whole new text*). Skip any part; nothing is saved until you apply. Admin MCP: `draft_agent_with_ai`.

![AI helper visual diff](site/img/card-ai-diff.webp)

## Roles

- **Roles**: organizers (phone numbers per agent; while none are saved, the WhatsApp admins of its groups) get organizer
  tools and can confirm changes; everyone else in a bound group is a participant. The model never sees or calls the
  confirm tool.

## Tool services (MCP)

Connect remote MCP servers (Sign in with OAuth, your own OAuth app, a token or custom headers) or local ones from npm or
GitHub (owner only; scrubbed environment, install scripts off unless allowed). Tick which tools participants and
organizers may use; the allow lists are enforced in code, and tools that change things go through the confirm gate:
an organizer replies `confirm CODE`.

- **Global tool services** (035): MCP servers defined once under **Settings → Tool services** are available to every
  agent. An agent can switch one off (`globalMcp.disabled` in its config), and an agent's own service with the same name
  replaces the global one for that agent. Tools still follow the agent's `server:tool` rules; for a role without explicit
  rules for that service, the service's defaults apply (`server:-` = none). OAuth sign-ins are per service (shared by
  all agents); local (npm/GitHub) services are owner-only. Admin MCP tools: `list_global_tool_services`,
  `add_global_tool_service`, `remove_global_tool_service`.

- **Plugins** (`plugins/<name>/index.js`) add local tools or commands for advanced cases; see `plugins/example-dice`.

- **Agent templates** (`templates/`): New agent, School friends, Family, Car pooling, Office colleagues, Event planning,
  Neighbours. Agents themselves are data in the app (export/import as JSON).

## WhatsApp actions

23 actions per role: send images, documents, voice notes, locations and contact cards, react, run polls and read the
votes, and (organizers) manage the group: name, description, picture, settings, invite link, members. Every action is
logged (`whatsapp.action`). Admins get the same group tools on **Chats** (the *WhatsApp* card of a group).

## Memory

- **Chat memory**: recent messages, a running summary and notes per chat, with retention limits
  (`MEMORY_RETENTION_DAYS`, `MEMORY_MAX_MESSAGES`). Admins can read and search what was stored (each look is logged),
  rebuild the summary or erase it.
- **Shared memory**: notes an agent keeps across all its chats. Only organizers write them, so one group cannot plant
  facts for another. Agent page → *Shared memory*.
- Tools: `memory__remember`, `list_notes`, `find_notes`, `update_note`, `forget` (the last two organizers only),
  `search_history`.

## Contacts

Names synced from the linked phone(s) plus your own entries with notes (**Contacts**). Agents look people up
(`contacts__find_contact`); participants only see contacts marked **Shared**, organizers see all and can save or remove
entries.

## Several WhatsApp numbers and direct messages

Link more numbers on Overview (QR or pairing code). Replies leave from the number the chat belongs to. Each number
chooses which agent takes direct messages (or the default under **Settings → Direct messages**), and a person can be
assigned an agent on **Chats**. Chats on the first number keep their WhatsApp id; others are `<number>#<jid>`.

---
[Docs index](README.md)
