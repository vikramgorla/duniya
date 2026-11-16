# Feature Specification: 062 guided first run and Find anything

**Issue**: #125 · **Status**: implemented · **Version**: 2.23.0

## Why

From an empty data dir (`DEMO_EMPTY=1 node scripts/demo-panel.mjs`) a new owner needed about 14 taps over five screens
to get a first test answer, and the Getting started checklist (#36) ticked "Create an agent" on a fresh install because
the built-in owner assistant counted. Overview showed the Ask box before any model was connected and an **Unlink**
button on a number that was never linked. Twelve tabs did not fit even at 1440 px, Settings was 5,500 px tall with no
index, and nothing could be found by name.

## User stories

1. **Guided first run** — Overview's *Getting started* lists five steps in the order a new owner does them: *Link your
   WhatsApp number → Connect an AI model → Create your first agent → Switch a chat on → Send a test message*. The
   current step opens in place with its action, so the owner never leaves Overview:
   - WhatsApp: the QR code, or a pairing code for this phone number;
   - model: one box that takes any key and recognises it (`sk-or-` OpenRouter with free models only, `sk-ant-`
     Anthropic, `github_pat_` GitHub Copilot, `sk-` OpenAI), plus *Free key from OpenRouter ↗*, *Use my ChatGPT plan*
     (→ Models, ChatGPT card) and *All options*;
   - agent: the templates as cards (one tap creates the agent), or the AI helper ("describe it in your own words");
   - chat: the groups with **Switch on** (binds the new agent and switches the chat on; a Find box when there are more
     than six);
   - test: a box that asks the agent and shows the answer, with the trigger to use in WhatsApp.
   Each step can be **skipped** and brought back (**Skipped · undo**). When the last step is done the card says *All set:
   your agent is live*, shows the test answer and links to the next things (edit the agent, more chats, Find); after
   **Close** or a reload it is gone. **Hide** hides it; Settings → Getting started (or Find → *Show Getting started*)
   brings it back. Progress is computed on the server from the real state.
2. **Overview follows the first run** — the headline names the first missing thing (*Link your WhatsApp number to
   begin*, *Connect an AI model so agents can answer*, *Create your first agent*, then the usual states); Ask is hidden
   until a model is connected; the QR code shows once (in Getting started; the number card points there); an unlinked
   number offers **New QR code**, not Unlink; the phone install hint waits until Getting started is done.
3. **Find anything** — `/` or ⌘K / Ctrl+K, or the search button in the header (an icon on phones): screens, agents
   (and *Test …*), chats (with on/off and agent), every Settings section, model providers, and actions (pause/resume
   all agents, new agent, add a direct chat, back up now, why agents stayed quiet, show Getting started, sign out).
   Arrow keys and Enter; a tap opens. Two taps from anywhere to any agent, chat or setting.
4. **Tabs that fit** — everyday order: Overview, Chats, Agents, Activity, Usage, Models, Contacts, Server, Backups (owner),
   Settings. **Pending** appears (with a count) only while a change waits; `#pending` still opens. **Secrets** is a
   Settings section; `#secrets` opens it.
5. **Deep links** — `#tab/<section>` scrolls to the section and highlights it once: Settings sections
   (`#settings/secrets`), model providers (`#models/chatgpt`), chats (`#chats/<chat id>`), Overview parts
   (`#overview/whatsapp`, `#overview/start`, `#overview/quiet`).
6. **Settings index** — a row of section links on top, sections in a fixed order (agents-wide first, then people and
   access, then you and the server).
7. **Chats in one step** — choosing an agent for a chat that is Off switches it on (privacy notice and recent messages
   as with the switch). A Find box filters by chat, number or agent when there are more than six chats. Empty states say
   what is missing (WhatsApp not linked → link on Overview).

## Requirements

- FR-1 `GET /api/checklist` steps `whatsapp, provider, agent, chat, reply`; `agent` and `chat` ignore the built-in owner
  assistant; `chat` = an agent of yours has a chat that is on; `reply` ignores the owner assistant's messages and usage.
  Each step has `skipped`; `done` counts done and skipped steps; `agent: { id, name, trigger }` is the agent the inline
  steps use (one with a chat that is on, else the newest) or `null`.
- FR-2 `PUT /api/checklist` takes `dismissed`, `skip: <step>` or `unskip: <step>` (unknown step → 400); admins only.
  Stored in settings (`checklistDismissed`, `checklistSkipped`).
- FR-3 `POST /api/chats/bind` takes `enable: true`: binds and, if the chat is off, switches it on through the same path
  as `PUT /api/chats/:chat/prefs` (activity, privacy notice, history load). Answer `{ ok, enabled, history? }`.
- FR-4 Admin MCP: `get_overview` adds `gettingStarted` (open steps, or `"done"`); `assign_chat` takes `switch_on`.
- FR-5 The Find box is client-only: it reads `/api/agents` and `/api/chats` through the panel cache; no new endpoint, no
  polling.
- FR-6 `DEMO_EMPTY=1` starts the demo panel as a fresh install (no provider, no agent, WhatsApp waiting for a scan;
  *Get code* links it after 3 s with three groups).
- FR-7 Lean: the 2.22.0 one-time cleanup of the old mobile app's sign-in client is removed from `admin-oauth.js`.

## Out of scope

Splitting Settings into pages; a lighter Chats row; activity summaries that name chats instead of ids.
