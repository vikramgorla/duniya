# 088 · Smart model choice and self-check of facts

Issue #203 (intelligence features 10 and 11, owner-approved).

## User stories
- As the owner, an agent on "Auto: light for simple, strong when needed" answers greetings and short questions with a
  cheap (or free) model and uses the strong model for the owner, photos, changes, long or multi-step messages and the
  records, so I pay less without worse answers.
- As the owner, I see per answer which model answered and why (one short reason), and in Usage what Smart choice saved.
- As the owner, I choose the light and strong models once (Settings → Models) and override them per agent.
- As a participant, I never get a wrong amount or date from the records: the agent checks its figures and corrects
  itself, or says it cannot double-check.

## Acceptance
- Rules decide first, in code; a classifier call happens only when the rules are unsure and the switch is on; it reads
  at most 400 characters and writes at most 4 tokens; its usage is its own kind.
- A failing light model → the strong model answers the same turn (normal fallback applies to the strong call).
- A spending cap's fallback model wins over Smart choice; a fixed model ignores tiers.
- Activity `model.usage` names the tier and reason; no message text added anywhere.
- Usage: answers per tier, top reasons, cost per answer now and if strong-only, saved (priced answers only).
- Self-check runs only when the turn used People or module tools; amounts, dates, counts and amount ↔ name pairs are
  compared in code; mismatch → one rewrite without tools; still wrong → a plain answer without figures. Activity shows
  "checked". Switch per agent, default on.
