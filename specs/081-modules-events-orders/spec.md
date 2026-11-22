# 081 · People step 3b: module frame, Events, Orders and payments

Issue #182. Builds on 078/079 (People) and 080 (pace). The design doc is approved; decisions are final.

## Why

Owners run family and community events from WhatsApp groups: who comes, how many kids, who brings what, who has paid.
That lived in spreadsheets next to Duniya. People already knows the families; events and payments hang off them. New
features of this kind should plug in the same way, and cost nothing on a small server until they are switched on.

## User stories

1. Settings → Modules: Events and Orders and payments, each with a switch, one line and the memory it uses. Off keeps
   the data; on brings it back.
2. I create *Sankranti 2027*: 14 Jan, Aigle hall, 40 places, closes 8 Jan, CHF, per household, confirmed
   automatically, CHF 25 per adult, CHF 10 per kid, kids under 5 free, pay by 10 Jan.
3. Anu writes "!panduga register us for Sankranti": the Chary family is registered with 2 adults and 2 kids (from the
   household), an order of CHF 60 appears (one kid is under 5), and every member's timeline says so.
4. The event is full: the next family goes on the waiting list; when someone cancels they get the place by themselves.
5. A picnic needs an organizer's OK: self-registrations are *to confirm*; an organizer confirms with the agent (held
   for `confirm CODE`) or in the panel.
6. "I'll set up the chairs" takes a duty; an organizer gives a duty to someone (held). In the panel I change a duty's
   task, time or number of people: what I do not change stays, and so do the people who took it; fewer people than
   already took it is refused.
7. People → Orders: not paid / overdue / paid / all, totals per event, CSV; an order's lines and payments; record a
   part payment in cash, the rest by TWINT (my own list of ways to pay); refund.
8. Agents answer "what do I owe?" (everyone) and "who hasn't paid for Sankranti?" (organizers); mark paid / refund are
   held for `confirm CODE`. The owner assistant answers the same and "how many kids registered?".
9. Merge, undo, export and erase in People cover registrations, duties, orders and payments; deleting a household
   deletes its registrations and orders.
10. Once a day I get one message with the open orders due within three days or overdue.

## Requirements

- R1 Module frame `src/modules/<id>/`: a catalogue entry (label, line, person/household refs and child tables) and a
  manifest (tables via CREATE TABLE, tools with roles, participant defaults and confirm, apply for held changes,
  person/household/event sections, upkeep, signals). `import()` only when on; off drops tools, pages and upkeep.
- R2 Module tools appear per agent like WhatsApp actions: `<module>:` rules, organizers all, participants the
  defaults, all/none ticks. Changes about anyone but the sender are held (runner confirm gate, `local:<module>`).
- R3 Events: validated dates (YYYY-MM-DD[THH:MM]), capacity in people, deadline for participants only, one currency,
  per household/person, auto/organizer confirmation, price list, pay-by; statuses registered / waiting / pending /
  cancelled; automatic promotion; duties with needed counts (changed in place, never below the number who took it);
  attendance; CSV safe against spreadsheet formulas. The event says whether registration is closed (the owner's day):
  the panel, the admin tool and the agent tools read that answer.
- R4 Orders: person or household, optional event (its currency), lines, cents, due date, payments with methods from
  the owner's list, refunds as negative payments; status open / part / paid / refunded / cancelled; price list →
  order on registration (kids free under an age by birthday); unpaid order follows registration changes.
- R5 Hidden people never appear in agent tool output; agents name only people their People access allows.
- R6 All new queries pass check-perf; workload: event page, registration list, orders list, who hasn't paid.
- R7 The one-time migrations of 2.40 are removed.

## Out of scope

Third-party modules; sending reminders or lists to people (step 4); taking payments.
