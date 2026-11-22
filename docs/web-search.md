# Web search

**Agents look up current facts on the web — opening hours, prices, train times, news, the weather — with the search
built into your AI provider. Nothing to install or configure.**

**Do it:** nothing: it is on. To switch it off: **Settings → Modules** → **Web search** off. To change who may search
with an agent: the agent's page → **Tools** → **Web search** → a tick per role.

**In 30 seconds**
- It uses the provider's own web search: **Claude** (Anthropic API key) and **ChatGPT** (sign-in). An agent answering
  with another provider (OpenRouter, Copilot, a compatible endpoint, Claude Code, Codex) simply answers without it.
- The AI decides when a question needs the web; at most 3 searches per step of an answer.
- Answers stay WhatsApp-friendly: links appear as plain addresses, and an answer from the web without a link gets up
  to two of the pages its search used.
- **Cost:** Claude's searches have a price per search (the provider's: $10 per 1,000 at the time of writing), shown
  under **Usage → Cost per feature → Web searches**; with ChatGPT they are part of the plan.

## Who may search

Web search is a module tool like the others ([Modules](modules.md#agent-tools)): on an agent's **Tools** page,
**Web search** has a tick for participants and one for organizers (both on by default). Untick participants to keep
it for organizers. The decision is made in code: an agent whose role may not search never gets the search tool.

> [!NOTE]
> The search runs at the provider, not on your server, so it costs no memory and works on the smallest server.

## Privacy

What the AI searches for goes to its provider (Anthropic or OpenAI), as the conversation already does; Duniya sends
nothing else anywhere. Chats that are off never reach a model, so never reach a search
([Privacy](privacy.md#what-is-kept-and-who-sees-it)).

> [!TIP]
> Need a page the search cannot read, or a site behind a sign-in? Add a browser or fetch tool as a
> [tool service](tool-services.md) instead.

**Next:** [Modules](modules.md) · [Usage & spending caps](spending.md) · [Tool services](tool-services.md) · [Docs index](README.md)
