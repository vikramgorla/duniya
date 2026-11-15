# Getting started

## Where is my panel?

After a one-click install the address is easy to miss:

- **Oracle Cloud**: on the job page, wait for *Succeeded*, **reload the page**, then **Application information**
  (or **Outputs**) → **Open the panel** / **Watch the install**, with copy buttons for the address and IP. It is also at
  the end of the job **Logs** (`panel_url = "https://…"`) and under **Compute → Instances → duniya → Public IP
  address**. Sign in as `admin` with the stack's owner password.
- **Google Cloud**: the end of the Cloud Shell output (`Ready: https://…sslip.io` and the setup code), or **Compute
  Engine → VM instances → External IP**.
- **Own server**: the installer's last lines; later `sudo duniya status` and `sudo duniya show-setup-code`.
- **Docker**: `http://localhost:8080` on that machine (or your domain / tunnel).

Open `http://<server-ip>/`: while installing it is a progress page that opens the panel by itself, afterwards it
forwards to `https://<ip-with-dashes>.sslip.io`. More detail per host: [Install → Where is my
panel?](install.md#where-is-my-panel-find-the-ip--url).

## First steps

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
