# Spec 066: Phone readability and the Ask conversation

Issue #132. The owner tested v2.25.0 on an iPhone (installed app, dark mode).

## Problems (owner feedback)

1. "White icon on green is not visible": the active bottom tab draws a lime pill under a near-white icon.
2. "Activity screen is not readable, text blocks are not distinguishable": rows run together, and the pill and text
   repeat each other ("Owner assistant" + "Owner assistant (admin): get_maintenance_status").
3. "Find anything is overly big": in the More sheet the search icon fills the whole button. Close shows a focus ring
   when the sheet is opened by touch.
4. Add a provider says "Free to start" and "Best answers" instead of the provider names.
5. Overview: the status line is shouty monospace caps; the Ask answer shows raw markdown "- "; Ask is too big on phones.
6. (Addition) Ask should feel like a modern assistant: thinking, live tool steps, streaming with a caret, Stop, Copy,
   follow-ups, Retry.

## Requirements

- R1 Text and icons on lime use the on-accent ink in both themes. `check:responsive` fails an icon under 3:1 against
  what is behind it, including a pill drawn by an ancestor's `::before`.
- R2 Activity is grouped by day. Each row has a type marker, one bold subject in plain words, the time on the right and
  a muted line with the type, agent and chat. Tool names reach people only through `toolPhrase()` (`names.js`): in
  Activity summaries, in Ask chips and in WhatsApp status entries. The filter is a compact select. Overview's recent
  activity uses the same rows.
- R3 Icons in buttons are always icon-sized. Find anything in More is a compact row. Sheets opened by touch focus
  themselves.
- R4 Add a provider lists every provider by its `names.js` name, as compact rows with a mark and one line. A connected
  provider stays listed ("Connected · add another account"), so ChatGPT sign-in is always offered.
- R5 Labels are sentence case in the text font. Overview status chips read as phrases. The Ask answer is a safe
  markdown subset (paragraphs, lists, bold, code) built from text nodes only. Ask is compact on phones.
- R6 Ask conversation:
  - the question as a bubble, then *Thinking…*
  - tool chips: running ("Checking …"), then done; folded to *Used N tools* when the answer is complete
  - the answer streams with a caret; auto-scroll stops when the reader scrolls up
  - **Stop** aborts the request: the server stops the model call (AbortSignal through the streaming providers), runs
    no further tool or round, keeps the partial text with "(Stopped.)" and does not blame the account
  - **Copy**, follow-ups (the server already sends earlier turns), and **Retry** after an error
  - respects reduced motion
  - the same component is *Try it* on the owner assistant's page

- R7 (Addition) The installed iPhone app sometimes stayed on skeleton cards until it was closed. Root causes:
  - requests had no deadline, and a request or socket left hanging after iOS suspended the app kept the screen waiting
  - its pending promise sat in the `api()` cache
  - a failed or stalled render left the skeleton in place (only a toast was shown)
  - a stalled dynamic import (More, Find anything) can never be retried in the page
  - `pagehide` set the live stream to null, so a later `visibilitychange` never reconnected it
  
  Fix:
  - deadlines (AbortController) on every request; failed or aborted promises leave the cache
  - a screen deadline that ends in *Couldn't load* + **Retry** (a stuck module reloads the page)
  - after more than 30 s away (`visibilitychange` / `pageshow`), drop waiting requests, reconnect and redraw an
    unfinished screen
  - pull to refresh on touch screens, and **More → Refresh**

## Out of scope

Persisting the panel thread across reloads (the server keeps the conversation for the model).
