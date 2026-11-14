# Feature Specification: Design Refresh and Experience-First Principle

**Feature Branch**: `014-design-refresh` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "Make the design language of the app more fresh and unique; create a DESIGN.md." / "I am focusing a lot on
experiences, so have that as a core principle of all we do." Also fixes reported in testing: Overview flicker,
update button losing its state, contradictory update status.

## Requirements
- FR-001 New visual language (DESIGN.md): warm paper, peacock teal, marigold, rounded display type, pill tabs,
  translucent header, brand mark, dark mode.
- FR-002 Constitution VIII "Experience First"; DESIGN.md checklist applies to all UI work.
- FR-003 No flicker on refresh; updates run once, in the background, with server-side progress.
