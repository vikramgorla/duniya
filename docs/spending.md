# Usage, cost and spending caps

**Usage** shows tokens and estimated cost by agent, chat, provider, account, model and kind (reply, summary,
transcribe, image, speech), and whether a call was a first choice or a fallback. Prices come from your own prices, the
provider's published prices, plans ("included") or free models; they are never guessed. Admin MCP: `get_usage`,
`set_model_price`.

- **Spending caps** (040, #35): monthly caps per agent (agent page) and per chat (**Chats → Spending cap**), by cost in
  USD (counts only priced calls: your prices, provider-published prices, plans and free models) and/or by tokens. At 80%
  the owner gets one WhatsApp alert; at 100% the agent stays quiet in that scope (or switches to a cheaper model you
  chose) until the month ends (server timezone). Bars on **Usage**. Admin MCP tools: `get_spending_caps`,
  `set_spending_cap`.

![Monthly spending caps](site/img/card-caps.webp)

The [weekly summary](owner-assistant.md#owner-alerts-and-weekly-summary) on WhatsApp reports messages, replies and cost
per agent.

---
[Docs index](README.md)
