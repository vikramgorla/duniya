# Tool services: how agents use them

**Tell each agent how to use a tool service — when, how carefully it changes things, whether it shares results on its
own, and how often — without writing it into the prompt.**

**Do it:** panel → **Settings → Tool services** → a service → **How it uses it** (the default for every agent), or an
agent's page → **Tools** → the service → **How it uses it** (just that agent).

**In 30 seconds**
- Every tool service has five settings: **who can use it**, **when to use it**, **changes it makes**, **share results
  on its own** and **limits**. The service's settings are the default; an agent can differ in any of them.
- How risky a tool is comes from what the tool itself declares (MCP annotations): *read-only* never asks, *destructive*
  always asks, anything else is a change that follows **Changes it makes**. You can correct a tool that declares
  itself wrongly.
- **Share results on its own** appears for a read-only tool that returns pictures, GIFs or stickers: the agent adds one
  after its text at the right moments (celebrations, thanks, jokes), with the credit the service gives.
- Nothing is decided by a tool's name; Duniya's own tools (People, Events, Orders, WhatsApp actions, memory) declare
  their risk the same way.

## How agents use a service

| Setting | Choices | What it does |
|---|---|---|
| **Who can use it** | ticks per role | Which tools participants and organizers get (Discover tools → ticks). Decided in code: a tool a role may not use is never offered. |
| **When to use it** | *Only when asked* · *When useful* (default) · *Proactively*, plus a note | One short line per service in the agent's instructions, e.g. "- tracker: only when someone asks for that kind of thing; only for this year's event." Services left at *When useful* without a note add nothing. |
| **Changes it makes** | *Agent's setting* (default) · *Ask first* · *Clear requests* · *Act and report* | Like the agent's [How sure before changing things](agents.md#how-sure-before-changing-things), for this service only. |
| **Share results on its own** | *Off* · *Sometimes* · *Often*, plus style words | Only for a read-only tool that returns media; see [below](#share-results-on-its-own). |
| **Limits** | most uses per reply, most uses per day, *Groups and direct* · *Direct only* | Enforced in code. A use a limit stops is not made; the agent is told why and Activity shows *Limit reached*. |

On an agent's page every choice starts with **Default (…)**: what the service says. Pick another choice to differ;
pick **Default** again to follow the service.

> [!TIP]
> Long prompt paragraphs about tools ("use the GIF search for celebrations, then send_media with the URL, credit
> KLIPY…", "always ask before saving") are no longer needed: set the service instead, and trim the prompt so the two
> never disagree.

## Risk from annotations

Tool services describe their tools (the [MCP tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool)).
Duniya reads them:

| The tool declares | Risk | What happens |
|---|---|---|
| `readOnlyHint: true` | **Read** | Runs; never asks. |
| `destructiveHint: true` | **Destructive** | Always waits for a yes (or `confirm CODE`), whatever the setting. |
| anything else, or nothing | **Change** | Follows **Changes it makes**: on *Clear requests* an organizer's clear request is the go-ahead. |
| any tool, when its input asks to delete (`{ "op": "delete" }`, `{ "delete": true }`) | **Destructive** | Always asks. |

1. **Discover tools** lists each tool with its risk; *(not declared)* means the service says nothing, so it counts as a
   change.
2. A tool that declares itself wrongly: pick **Read**, **Change** or **Destructive (override)** in its **Risk** column.
   In Settings that corrects it for every agent; on an agent's page for that agent.
3. A service that previews changes and has a sibling `confirm` tool works as before: a result with a confirm id is a
   preview, and its risk is the risk of the tool that made it. On a clear request Duniya confirms a *change* itself in
   the same turn; a *destructive* one waits for a yes in a later message.

> [!IMPORTANT]
> Permissions stay in code: who may use a tool, which changes may happen without a yes, and the limits. The prompt
> only explains them.

## Share results on its own

**An agent with a GIF or sticker service adds one fitting GIF after its text, at the right moments, by itself.**

1. **Settings → Tool services** → the service → **How it uses it** → **Share GIFs on its own** → *Sometimes* or
   *Often*; add style words (e.g. *Telugu movie reactions, Brahmanandam*). Or set it per agent on its **Tools** page.
2. That's it: no prompt text needed.

| | Sometimes | Often |
|---|---|---|
| Celebrations ("congrats!", 🎉), thanks said to the agent, "send a gif" | ✓ | ✓ |
| Other thanks, welcomes, jokes (😂), praise ("well said"), settled plans ("all set") | | ✓ |
| Serious, worried, upset, safety or money topics ("accident", "sick", "refund") | never | never |

- **One call.** The agent gets one action, *share media* with a mood ("party", "thank you"). Duniya searches the
  service with the mood and your style words, picks a result it did not post in that chat lately, and posts it right
  after the text with the credit text the service returns (KLIPY: *Powered by KLIPY*).
- **Not up to the model alone.** Duniya spots the moment itself and asks for one in that turn; with *Often*, when a
  model (often a light one) answers with text only, Duniya posts one anyway.
- **One per moment.** At most one per answer, and none when one went out in that chat in the last few minutes.
- **Who.** Every role that may use the service; participants don't need *send media*.
- Which tools qualify: read-only (`readOnlyHint: true`), with media in its results (media fields such as `mp4Url` or
  `imageUrl` in its output schema, or pictures and GIF/MP4/WebP links in a result seen before) and a free-text input
  (`query`, `q`, `search`, …).

> [!NOTE]
> Only mood and style words go to the service, never names, phone numbers or message text: names people use in the
> chat, the sender's, the agent's and the group's are removed first ([Privacy](privacy.md#tool-services)).

## For service authors

Declare your tools and Duniya does the right thing without settings:

```json
{ "name": "search_gifs", "annotations": { "readOnlyHint": true },
  "outputSchema": { "type": "object", "properties": { "results": { "type": "array", "items": { "type": "object",
    "properties": { "id": { "type": "string" }, "mp4Url": { "type": "string" }, "attribution": { "type": "string" } } } } } } }
```

- `readOnlyHint: true` on tools that only read; `destructiveHint: true` on deletes, payments and anything that touches
  someone else's data.
- Return media as `results` with an `id`, a media URL (`mp4Url`, `gifUrl`, `webpUrl`, `imageUrl` or `url`) and, when
  you need credit, an `attribution` line.

Admin MCP and the owner assistant: `get_tool_behaviour` (per agent or the defaults, with each tool's risk) and
`set_tool_behaviour` (per agent with `agent_id`, or the service's default).

---
**Next:** [Agents](agents.md#tool-services-mcp) · [Privacy](privacy.md) · [Admin MCP](admin-mcp.md) · [Docs index](README.md)
