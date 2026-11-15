# Implementation Plan: Weekly Summary

**Spec**: [spec.md](spec.md) · **Issue**: #38 · **Release**: v2.4.0

## Design

- `src/core/stats.js` — `daily_stats` counters (`handled`, `reply` per agent; `ignored`, `budget` per chat), incremented
  in the router/runner; never message text.
- `src/core/weekly.js` — settings, `weeklyData()` (stats, usage this vs last week, pending, update status, backup errors
  from Activity), `weeklyText()`, `sendWeekly()`, `weeklyTick()` called by the existing scheduler every 30 s with a kv
  slot per date.
- Routes in `src/panel/routes/owner-alerts.js`; Settings card `ownerAlertsCard()`; admin MCP tools.

## Constitution Check

- No message contents leave the server in the summary (privacy). V: sends are recorded in Activity. VI: no dependencies.
- VIII: one status line ("✓ Alerts go to … Weekly summary every Monday at 09:00"), Send now shows the result.

## Complexity Tracking

None.
