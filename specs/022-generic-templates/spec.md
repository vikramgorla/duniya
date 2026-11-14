# Feature Specification: Generic Bot Templates

**Feature Branch**: `022-generic-templates` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "Don't ship the panduga template, ship other templates like school friends, family, car pooling, office
colleagues, …"

## Requirements
- FR-001 The panduga template is no longer shipped (moved to `test/fixtures/panduga-bot.json` for tests); existing
  bots are unaffected.
- FR-002 Templates: New bot (blank), School friends, Family, Car pooling (weekday 06:45 rides post), Office colleagues
  (Monday action items, off by default), Event planning, Neighbours — memory on, no tool services, triggers per theme,
  instructions written for the theme with privacy rules.
- FR-003 A test validates every shipped template and checks none is panduga-specific.
