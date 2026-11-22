# 094 · How agents use tool services (when, changes, share on its own, limits; risk from annotations)

Issue #216 (owner request after real group conversations, one minor release).

## Problem
Two group agents whose prompts ask for frequent Telugu-movie GIFs on celebrations and thank-yous kept answering with text
only ("Just a message? No gif?"): smart model choice sends exactly these moments to the light model; a GIF needs two
tool calls (search, then send_media) and send_media may be organizer-only; nothing in code makes it a behaviour. More
generally, how an agent should use a tool lives in prompt paragraphs, and the risk of a change came from tool names
(v2.54 table and words, per-agent `risk` globs).

## Principle
Nothing depends on a tool's or service's name. Everything comes from what a tool declares (MCP annotations
`readOnlyHint`, `destructiveHint`; its output schema or results) plus the owner's per-tool overrides.

## User stories
Per tool service, a default in Settings → Tool services, overridable per agent on its Tools page (each service row →
**How it uses it**; the tool list underneath for per-tool overrides):
1. **Who can use it** — the per-role ticks (unchanged).
2. **When to use it** — asked | useful (default) | proactive + a short note; one compact line per service in the
   instructions (only when it differs from "useful" or has a note; budgeted).
3. **Changes it makes** — ask | clear | act for that service (default: the agent's *How sure before changing things*).
   Risk: `readOnlyHint` → read (never asks); `destructiveHint` → destructive (always asks); anything else or nothing →
   change (follows the setting); an input asking to delete → destructive; per-tool override read | change | destructive.
   Duniya's own tools (People, modules, WhatsApp actions, memory, promises, pictures) carry the same annotations.
4. **Share results on its own** — off | sometimes | often + style words, offered only for a read-only tool that returns
   media (media fields in its output schema, or media in a result seen before) and takes free text. One action
   (`share_media(mood)`) for the roles allowed to use the service; moments found in code (celebrations, thanks, welcomes,
   jokes, praise, settled plans, requests); "often" posts one itself after a text-only reply; serious topics never; one
   per moment (one per answer, none within a few minutes); no repeats (last 30 per chat); only mood and style words sent
   (names known in the chat, the sender's, the agent's and the group's removed); the credit text the tool returns as the
   caption; text first, then the media.
5. **Limits** — most uses per reply and per day (per agent and service), where results may go (groups and DMs | DMs
   only); enforced in code; Activity *Limit reached*.

## Acceptance
- The v2.54 name-based risk table, HIGH/LOW words, `_preview` name detection and the agent `risk` field are removed;
  preview → confirm stays as a pattern (a sibling confirm tool + a confirm id in a result), its risk from the tool that
  made the preview (a read-only preview counts as a change).
- One-time migration (remove next release): agents whose prompt mentions GIFs and that can use a media-returning
  read-only service get that service as proactive + share often, style words from the prompt when it names a film style.
- Admin MCP `get_tool_behaviour`, `set_tool_behaviour` (per agent, or the default); AI helper writes `services`
  instead of prompt paragraphs.
- Tests with fakes: risk from annotations (read / change / missing / destructive / delete-like input / override),
  when-to-use rendering, share on its own (celebration, light-tier fallback, participant without send_media, serious,
  two quick messages, repeats, names, sometimes / off, not for a non-read-only media tool), limits, admin MCP, migration;
  the Killi and car-pooling scenarios still pass.
