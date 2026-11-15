# Feature Specification: Spending Caps per Agent and per Chat

**Feature Branch**: `feat/features-b` (issue #35)

**Created**: 2026-11-15

**Status**: Implemented (v2.4.0)

**Input**: Owner request (#35): "Monthly caps (cost or tokens) per agent and per chat; alert the owner on WhatsApp at 80%
and 100%; at 100% the agent goes quiet (or a cheaper model fallback). Panel controls + usage page bars."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cap an agent (Priority: P1)

An admin opens an agent, sets **Monthly spending cap** to "$5 per month" (or "2,000,000 tokens per month" when the
model has no known price) and chooses what happens at the cap: **Stay quiet until next month** or **Switch to** a
cheaper model.

**Acceptance Scenarios**:

1. **Given** a cap, **When** the agent's month-to-date spend reaches 80%, **Then** the owner gets one WhatsApp alert
   (once per cap and month) and the agent keeps answering.
2. **Given** spend at 100% and no cheaper model, **When** someone addresses the agent, **Then** no model is called, the
   agent stays quiet, the owner gets one alert, and Activity records "Stayed quiet: monthly … spending cap reached"
   with silence reason `budget`.
3. **Given** spend at 100% and a cheaper model, **Then** the agent answers with that model and the owner is told once.
4. **Given** a new calendar month (server timezone), **Then** spend starts at zero and alerts can fire again.
5. The panel test console is never held back.

### User Story 2 - Cap a chat (Priority: P1)

Under **Chats → Spending cap** an admin caps one chat. Only that chat is affected; the agent keeps answering elsewhere.

### User Story 3 - See where the money goes (Priority: P2)

**Usage** shows **Monthly spending caps**: one bar per cap with "47% · within cap", "$0.71 of $1.50 · resets Dec 1",
and a plain warning when calls have no price and a cost cap therefore can't count them.

### Edge Cases

- No alert number set: alerts are written to Activity only; Usage says where to add the number.
- Cost caps count only priced calls (prices from owner settings, provider-published prices, plans = $0, free = $0 —
  never guessed). Token caps count every call.
- A turn that already started finishes (tool rounds); the cap is checked before the first model call of each turn.
- Background memory summaries are recorded in usage (and count toward the cap) but are not held back.

## Requirements *(mandatory)*

- **FR-001** Caps per agent and per chat: monthly cost (USD, the usage currency) and/or monthly tokens, optional fallback
  model (`provider:model`). Removing both limits removes the cap.
- **FR-002** Check before a model call (runner); worst scope wins (quiet > fallback > ok).
- **FR-003** Alerts at 80% and 100%, once per scope, month and level, to the owner's WhatsApp number (see 041).
- **FR-004** Silence reason `budget` recorded in Activity detail and on the turn context (`ctx.silenceReason`).
- **FR-005** API: `GET /api/budget`, `GET|PUT /api/budget/:scope/:id` (admin to change); admin MCP tools
  `get_spending_caps`, `set_spending_cap`.
- **FR-006** Panel: agent page fieldset, Chats → Spending cap, Usage bars; phone rules of DESIGN.md.

## Success Criteria

- Tests (`test/budget-weekly.test.js`) cover validation, 80/100% alerts once, quiet scope, fallback model, timezone months.
