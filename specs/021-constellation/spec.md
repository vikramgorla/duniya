# Feature Specification: Constellation Design and Admins-as-Organizers Default

**Feature Branch**: `021-constellation` | **Created**: 2026-11-14 | **Status**: Implemented

**Input**: "I connected the first group, I am an organizer (because I was admin), but the activity log says I am a
participant." / "I don't like the world logo — I named it Duniya to say it is about a world of people." / "I don't
want a copy/paste of the Copilot look; inspired by it, not normal agent slop, but still futuristic."

## Requirements
- FR-001 While a bot has no organizers saved, WhatsApp admins of its groups ARE its organizers (in groups and in
  direct messages); once roles are saved, the saved list decides. The People & roles note says so.
- FR-002 New mark: five people in a circle around the world; favicon.
- FR-003 "Constellation" visual language (DESIGN.md): porcelain + ink, one lime signal colour, dot grid, mono
  instrument labels, LED status, status console on Overview; no emoji decoration.

## Tests
`test/people-ai.test.js`: admins are organizers before roles are saved; the saved list decides afterwards.
