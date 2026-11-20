# Usage, cost and spending caps

**See what every agent and chat costs, and cap it per month.**

**Do it:** agent page or **Chats → Spending cap** → set a monthly cap.

**In 30 seconds**
- **Usage**: the totals, your caps, a bar per day, then **Breakdown**: *Agents · Chats · Models · Accounts · Kind*, one
  row each (name · calls and tokens · cost), and how many calls a fallback model answered.
- Prices are yours, published, plans ("included") or free: never guessed.
- Caps: one alert at 80 %; quiet (or a cheaper model) at 100 %.
- Agents on [Smart model choice](intelligence.md#smart-model-choice): **Usage → Smart model choice** shows how many
  answers a light model gave, the cost per answer and what it saved. *Kind* lists the classifier (*Choosing light or
  strong*) and *Self-check rewrites* separately.

![Usage page](site/img/usage-desktop.webp)

## Prices

![Usage breakdown: one row per agent with calls, tokens and cost](site/img/card-usage-breakdown.webp)

**Usage → Breakdown → Models** shows each model's price per million tokens (*price not set*, *free*, or the plan that
includes it). To set or change one: the model's **⋯ → Set price…** (input and output, in USD per million tokens; empty
removes it). Admin MCP: `set_model_price`.

## Spending caps

1. Agent page → **Spending cap**, or **Chats** → a chat → **Spending cap**.
2. Choose cost in USD and/or tokens per month.
3. Optional: a cheaper model to switch to at 100 %.

| At | What happens |
|---|---|
| 80 % | one WhatsApp alert to the owner ([owner alerts](owner-assistant.md#owner-alerts-and-weekly-summary)) |
| 100 % | the agent stays quiet in that scope, or switches to the cheaper model, until the month ends (server timezone) |

> [!NOTE]
> Cost caps count only priced calls (your prices, published prices, plans and free models). Kinds: reply, summary,
> transcribe, image, speech.

![Monthly spending caps](site/img/card-caps.webp)

Admin MCP: `get_usage`, `set_model_price`, `get_spending_caps`, `set_spending_cap`.

---
**Next:** [Owner alerts & weekly summary](owner-assistant.md#owner-alerts-and-weekly-summary) · [Models](models.md) ·
[Docs index](README.md)
