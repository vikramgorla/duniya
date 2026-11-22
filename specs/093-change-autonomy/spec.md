# 093 · How sure before changing things (agent autonomy, enforced in code)

Issue #213 (owner request after a real conversation on the owner's server, one minor release).

## Problem
An organizer said "Add Killi to tracker", "should go to shopping list", "Yes", "Qty must match 3× adults", "Yes"; the
agent asked "Shall I save?" five times: its prompt said a request is not approval, and the tool service's preview says
"If the user does not clearly agree, do not confirm".

## User stories
- As the owner, I choose per agent (agent page → Tools) **Ask first**, **Act on clear requests** (default for new and
  existing agents) or **Act and report**.
- As an organizer, a clear request ("add Killi to the shopping list") is applied in the same answer, with one line that
  says what changed (+ "say undo to revert" when possible); a follow-up tweak is applied without asking again.
- As an organizer, deletes, payments / refunds, sends to lists and changes to someone else's registration, duty or money
  always wait for my yes, whatever the setting; an unclear request gets one question.
- As a participant, I can never change what I am not allowed to (unchanged).
- As the owner, every change made without asking is in Activity ("Changed without asking"), one tap from the agent.

## Acceptance
- The runner's system instructions carry one short paragraph from the setting (no duplicated confirmation wording).
- Code, not the prompt, decides: a per-tool risk table (Duniya's own held changes) and name rules (remote preview →
  confirm tools; unknown = high; a delete in the input = high), per-agent `risk` overrides.
- clear / act + organizer (or owner) + live addressed turn + low risk → applied at once (Duniya confirms remote previews
  itself; module / People holds apply without a code). Otherwise: Duniya's holds keep `confirm CODE`; a model's
  same-turn confirm of a remote preview is blocked, and allowed only after a later explicit yes.
- Test console and schedules never apply without asking; follow-ups without the wake word (judged turns) count, so
  "should go to the shopping list" and "Yes" work as in the real conversation (2.54.1).
- Activity type `change.auto` with the tool, input, role and undo tool; `#activity/type=change.auto`; admin MCP
  `update_agent` (`autonomy`, `risk`) and `list_activity` (`type`); the owner assistant sets it through `update_agent`.
- Tests with fakes: the Killi replay, tweak, unclear, delete, participant, ask mode, a fake preview / confirm service
  blocked from a same-turn confirm, module gate by risk class, validation, panel API.
