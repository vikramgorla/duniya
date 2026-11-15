# Getting started

After the install you have a panel address and a one-time setup code. Overview shows a **first-run checklist**
(connect a model, link a number, create an agent, switch a chat on, get a first reply); each step links to where it is
done, and the checklist can be dismissed once you know your way around.

![First-run checklist](site/img/card-checklist.webp)

1. **Setup**: enter the setup code, choose your username and password.
2. **Overview**: scan the QR with the agent's WhatsApp (*Settings → Linked devices*), or use a pairing code.
3. **Models**: connect OpenRouter in one tap, paste an Anthropic or OpenAI key, add an OpenAI-compatible endpoint,
   *Sign in with ChatGPT*, or connect GitHub Copilot.
4. **Agents → New agent**: pick a template (or *Create an agent with AI*), write the instructions, add organizers, connect
   tool services (URL → *Check* → *Connect* to sign in, or a token; *Discover tools* → tick per role), save. Use the
   **test console** to try it. Tool services every agent should have (a calendar, a shared planner) go under
   **Settings → Tool services** instead: add them once, tick the default tools per role, and switch them off per agent
   if needed (see below).
5. Add the agent number to a WhatsApp group. **Chats** → switch the chat **on** and choose the agent. Chats are off until
   you switch them on: agents ignore them completely (nothing stored, no model call).
6. In the group: `!yourtrigger hello` (or @mention the agent).
7. **Backups**: set a passphrase, connect GitHub or S3, turn on the schedule.

## Trying an agent: test console and *Test as*

Every agent page has a **test console**: it uses the real tools and saved settings, and nothing is posted to WhatsApp.
**Test as** picks the role (participant or organizer) and the chat (one of the agent's chats or a new direct chat), and shows the tools that role really gets. If the chosen chat is off, a note says that in
WhatsApp the agent would stay silent there.

![Test as an organizer](site/img/card-test-as.webp)

## Why didn't it answer?

**Overview → Why agents stayed quiet** (and a line per chat on **Chats**) lists, for the last 7 days, why agents did
not answer: *chat is off*, *not mentioned*, *no agent chosen*, *agent is off*, *all agents paused*, *direct messages
off*, *sender not allowed*, *rate limit*, *model error*, *empty answer*, *budget cap reached*, *server busy*, *waited
too long* — with counts and one-click fixes (switch the chat on, open triggers, …). Only counts, the last time and one
sample sender are kept, never the messages. Admin MCP: `list_silences`.

---
[Docs index](README.md)
