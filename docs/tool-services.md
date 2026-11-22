# Tool services: how agents use them

**Tell each agent how to use a tool service — when, how carefully it changes things, whether it shares results on its
own, and how often — without writing it into the prompt.**

**Do it:** panel → **Settings → Tool services** → a service → **How it uses it** (the default for every agent), or an
agent's page → **Tools** → the card **How it uses it** right under the service's name → **Change** (just that agent).

**In 30 seconds**
- Every tool service has four settings: **who can use it**, **when to use it**, **changes it makes** and **limits**.
  The service's settings are the default; an agent can differ in any of them.
- How risky a tool is comes from what the tool itself declares (MCP annotations): *read-only* never asks, *destructive*
  always asks, anything else is a change that follows **Changes it makes**. You can correct a tool that declares
  itself wrongly.
- For a service that returns pictures, GIFs or stickers, **When to use it → Proactively** or **Often** means the agent
  adds one at the right moments (celebrations, thanks, jokes) by itself, in the same message as a short answer.
- Nothing is decided by a tool's name; Duniya's own tools (People, Events, Orders, WhatsApp actions, memory) declare
  their risk the same way.

## How agents use a service

| Setting | Choices | What it does |
|---|---|---|
| **Who can use it** | ticks per role | Which tools participants and organizers get (Discover tools → ticks). Decided in code: a tool a role may not use is never offered. |
| **When to use it** | *Only when asked* · *When useful* (default) · *Proactively* · *Often* (services that return media), plus a note | One short line per service in the agent's instructions, e.g. "- tracker: only when someone asks for that kind of thing; only for this year's event." Services left at *When useful* without a note add nothing. For a service that returns media, *Proactively* and *Often* also share on their own ([below](#share-results-on-its-own)). |
| **Changes it makes** | *Agent's setting* (default) · *Ask first* · *Clear requests* · *Act and report* | Like the agent's [How sure before changing things](agents.md#how-sure-before-changing-things), for this service only. |
| **Limits** | most uses per reply, most uses per day, *Groups and direct* · *Direct only* | Enforced in code. A use a limit stops is not made; the agent is told why and Activity shows *Limit reached*. |

On an agent's page every choice starts with **Default (…)**: what the service says. Pick another choice to differ;
pick **Default** again to follow the service.

> [!NOTE]
> A service that does not answer never holds an agent up: services are asked at once, each for a few seconds, and one
> that failed is left out for a minute before it is tried again. The agent answers with the tools it has.

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

**An agent with a GIF or sticker service adds one fitting GIF at the right moments, by itself.**

1. **Settings → Tool services** → the service → **How it uses it** → **When to use it** → *Proactively* or *Often*;
   add style words (e.g. *Telugu movie reactions, Brahmanandam*). Or set it per agent on its **Tools** page.
2. That's it: no prompt text needed.

**The AI decides, code keeps it safe.** A hint alone is not enough for an extra like a GIF (models often just
answer), so with *Proactively* or *Often* the AI must make a choice at the end of **every** answer: a mood
(`[share: festive lights]`) or `[share: none]`. It reads the whole conversation, so any culture, language or kind of
good news counts — Diwali, Eid, an exam passed, a joke that landed — with no word list. The tag is never shown.

| | Proactively | Often |
|---|---|---|
| Where one clearly adds warmth: celebrations and festivals, good news, thanks to the agent, "send a gif" | ✓ | ✓ |
| Whenever the mood is light: also thanks, welcomes, jokes, praise, settled plans | | ✓ |
| Serious, worried, upset, safety or money topics ("accident", "sick", "refund") | never | never |

- **No extra call.** The choice is a few words at the end of the answer it writes anyway. Duniya searches the
  service with the mood and your style words and picks a result it did not post in that chat lately.
- **One message.** A short answer (up to 500 characters) goes as the GIF's caption and nothing else: no title, credit
  or link. A longer answer, or a sticker, goes first and the GIF right after it.
- **Credits live in the panel.** Each result says what credit it needs in `creditText` (schema.org). One every result
  shares, e.g. *Powered by KLIPY*, shows on the service's card in **Settings → Tool services** and in **Settings →
  Help → Credits**; Activity keeps each GIF's own credit and link. A result that needs its own credit (an author and
  license) is not shared on its own. Links to GIFs, videos and pictures, and those credits, are taken out of the agent's text
  and of captions it writes itself.
- **Code keeps the limits.** Serious topics never get one, whatever the AI picks; at most one per answer and none
  shortly after another; the limits apply; only mood and style words are searched.
- **A model that forgets the tag** falls back to simple rules (celebrations, festival greetings, thanks, requests; with
  *Often* also jokes, welcomes, praise), so a weak model still behaves. The card shows the last 7 days: how many were
  shared and how many the AI picked.
- **Who.** Everyone in the chat, once it is set to *Proactively* or *Often*: participants need neither the service's
  tools (a service added from the Registry gives them none) nor *send media*; only its read-only media tool is used,
  and the agent's deny list still wins.
- Which tools qualify: read-only (`readOnlyHint: true`), returning schema.org `ImageObject`s whose `encodingFormat`
  the output schema declares ([For service authors](#for-service-authors)), with a free-text input (`query`, `q`,
  `search`, …).

> [!NOTE]
> Only mood and style words go to the service, never names, phone numbers or message text: names people use in the
> chat, the sender's, the agent's and the group's are removed first ([Privacy](privacy.md#tool-services)).

## For service authors

Declare your tools and Duniya does the right thing without settings:

```json
{ "name": "search_gifs", "annotations": { "readOnlyHint": true },
  "outputSchema": { "type": "object", "properties": { "results": { "type": "array", "items": { "type": "object", "properties": {
    "@type": { "const": "ImageObject" }, "identifier": { "type": "string" }, "contentUrl": { "type": "string" },
    "encodingFormat": { "const": "image/gif" }, "encoding": { "type": "array" }, "creditText": { "type": "string" } } } } } } }
```

- `readOnlyHint: true` on tools that only read; `destructiveHint: true` on deletes, payments and anything that touches
  someone else's data.
- Return media as `results` of [schema.org `ImageObject`s](https://schema.org/ImageObject): `identifier`,
  `contentUrl`, `encodingFormat` (declare it in the output schema, e.g. `const: "image/gif"`: that is how Duniya knows
  what the tool returns), `encoding` for other formats of the same item (`MediaObject`s; an MP4 of a GIF is what chat
  apps send), `thumbnailUrl`, `contentSize`, `creator`, `license`, `provider` and, when a credit is needed,
  `creditText` (IPTC *Credit Line*): the credit without the item's title or link. Give every result the same text for a platform credit (*Powered by
  …*): Duniya shows it in its panel, never in messages. A work's own credit (author, license) differs per result:
  Duniya then does not post that result on its own, since the credit would have to go with it.

Admin MCP and the owner assistant: `get_tool_behaviour` (per agent or the defaults, with each tool's risk) and
`set_tool_behaviour` (per agent with `agent_id`, or the service's default).

---
**Next:** [Agents](agents.md#tool-services-mcp) · [Privacy](privacy.md) · [Admin MCP](admin-mcp.md) · [Docs index](README.md)
