# 082 · People step 4a: lists and sends, consent, pace, reminders

Issue #184. Builds on 078/079 (People, consent), 080 (pace) and 081 (module frame, Events, Orders). The design doc is
approved; decisions are final.

## Why

Organizers reach families one by one: "Sankranti is on the 14th", "CHF 50 is still open". Copy-pasting into dozens of
chats is slow and, done carelessly, gets a WhatsApp number banned. People already knows who agreed to what; Events and
Orders know the facts. Sending should use both, never message someone who said no, and look like a person typing.

## User stories

1. People → Sending → New message: to the Committee list, purpose updates, replies go to Panduga, "Hi {first_name}, the
   committee meets Friday". The preview says 12 people (10 WhatsApp, 2 Telegram), about 25 minutes, 3 skipped (2 not
   asked, 1 hidden), with three sample messages. I start it.
2. Each person gets their own wording with their facts; nothing invented; every fact kept or my text goes out.
3. Messages go one at a time within 09:00–20:00, after the chat's unread messages are read and typing shown, with a
   random gap, twice as long for people who never wrote; at today's limit it waits for tomorrow by itself.
4. Ravi replies "stop": his updates consent becomes no, he gets one confirmation, the run pauses and I am told.
5. 20 people in a row did not answer, three sends failed, WhatsApp logged out: the run pauses with the reason.
6. Orders → Send reminders: everyone with an open order gets a reminder with their amount, due date and ways to pay;
   an event can send them automatically three days before the due date.
7. An event's page → Message registered people: one message per household, to an adult who agreed.
8. An organizer asks the agent "tell the committee the agenda is out": it prepares the run and waits for `confirm CODE`.
9. The owner assistant / an AI assistant previews, starts, pauses, resumes and stops runs (confirm for starting).
10. A restart in the middle carries on; a message that was being sent is never sent twice.

## Requirements

- R1 Module `sending` (`src/modules/sending/`), off by default; tables `snd_runs`, `snd_recipients`, `snd_filters`.
- R2 Audiences: list, tag, household, event (registered), orders (open, optional event), people; saved audiences.
  Households get one message (the first adult who can get it, people who wrote first); kids without an app are reached
  through household adults.
- R3 Skips in code with reasons: hidden, consent not yes (unknown = no), no app, chat switched off, household without
  adults; agent runs also skip people outside the agent's People access. Consent and hidden re-checked before each send.
- R4 Per-person text: background model rewrite of the filled template; kept only if every used fact appears verbatim.
- R5 Channel: Telegram direct chat when the person has one and Telegram is on, else WhatsApp (their chat or their
  phone on the first number). Or one post in a group that is on. Direct chats are switched on with the run's agent.
- R6 Pace (src/core/pace.js, extended): hours, typing after reads, gap (×2 never wrote), longer pause every N,
  daily cap (never wrote = new chats with warm-up; wrote = 3×). Global WhatsApp gap across runs. Telegram 3 s.
- R7 Upkeep tick: at most one send at a time; drafts expire after a day; a send left "sending" > 10 min is failed.
- R8 Stop signals pause + owner alert: stop word/tool, N unanswered in a row (> 30 min, since start/resume), 3 failures
  in a row, logged out, offline 15 min. Waits (no pause): hours, cap, offline < 15 min.
- R9 Stop/start words (several languages) answered without a model within 30 days of a list message; agent tool
  `stop_messages` for other phrasings; one confirmation.
- R10 Orders: reminder template; automatic reminders per event (days, agent, message), once per due date.
- R11 Agent tools: stop_messages (all), sending_status, send_to_list (held for confirm with the preview line).
- R12 Admin MCP: list_sends, get_send, send_to_people*, control_send, save_send_audience, set_payment_reminders*.
- R13 check-perf: run page, history, event recipients budgets; previews of every audience kind, a send, a stop word.

## Out of scope

Surveys and campaigns (083); detecting reports/blocks (WhatsApp does not tell); media in list messages.
