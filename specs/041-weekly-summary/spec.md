# Feature Specification: Weekly Summary to the Owner on WhatsApp

**Feature Branch**: `feat/features-b` (issue #38)

**Created**: 2026-11-15

**Status**: Implemented (v2.4.0)

**Input**: Owner request (#38): "Weekly message to the owner: per agent activity, cost, chats ignored, items waiting
(pending confirms, updates, failed backups). Configurable day/time; on by default for the owner."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A short weekly message (Priority: P1)

The owner adds their number under **Settings → Owner alerts on WhatsApp**. Every Monday at 09:00 (server time, both
configurable) the agents' number sends them a short message:

```
*Duniya — your week* (9 Nov – 15 Nov)

- Car pooling: 42 messages handled, 40 replies, $0.31 (last week $0.25)
- Quiet this week: U11 football

Ignored: 35 messages in 2 chats that are switched off.
Needs you: 1 change waiting for confirmation; update available: v2.5.0 (running v2.4.0). Open the panel to sort it out.
```

**Acceptance Scenarios**:

1. **Given** an alert number, **Then** the summary is on by default; the owner can switch it off or change day/time.
2. The message contains counts and costs only — never message contents.
3. It is sent once per chosen day, at or after the chosen time, also while agents are paused.
4. **Send now** sends it immediately and shows the text; without a number it shows a preview (not sent).

## Requirements *(mandatory)*

- **FR-001** Per agent: messages handled, replies, cost this week vs last (cost only from known prices, "price not set"
  otherwise). Counters live in `daily_stats` (counts only, kept 60 days) so they don't depend on activity logging.
- **FR-002** Chats ignored (messages and chats), replies held back by caps, pending confirmations, update available,
  backup failures this week.
- **FR-003** Settings: `alertsTo`, `weekly { enabled (null = default on), day, at }`; owner-only to change.
- **FR-004** API: `GET|PUT /api/alerts`, `GET /api/alerts/weekly/preview`, `POST /api/alerts/weekly/send`; admin MCP
  tools `get_owner_alerts`, `set_owner_alerts`, `preview_weekly_summary`, `send_weekly_summary`.
