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

- R7 (Addition) The installed iPhone app sometimes stayed on skeleton cards while switching screens (Activity, More →
  a screen) until it was closed. Root causes, reproduced in headless Chrome by switching tabs fast on a slow network:
  - **Placeholder timer over a drawn screen.** The 120 ms placeholder timer replaced the screen with skeletons even
    when the screen had already drawn and was still waiting for more data. Activity draws its card, then loads the
    list, which then filled a card no longer on the page. Placeholders only replace what was there before the
    navigation.
  - **Older screen drawn over the newer one.** An older screen that finished while the newer one was still loading
    drew over it and stayed. The current screen is now drawn again when it finishes.
  - **Live status redraws Overview after you leave.** A status update could redraw Overview after you had already
    moved to another tab. It now draws only on a finished Overview.
  - **Errors left skeletons in place.** A render that failed showed only a toast. Now every failure or stall ends in
    *Couldn't load* + **Retry** and is logged to the console. A screen module missing after an update reloads the app
    once.
  - **Guards.** Deadlines on requests (failed ones leave the cache) and on sheets. After more than 30 s in the
    background, recover: drop waiting requests and reconnect the stream (it also reconnects when it was closed on
    `pagehide`). Pull to refresh, and **More → Refresh**.
  - **Regression check.** `nav-stress`, `load-failed` and `load-retry` in `check:responsive` run in CI.
- R8 (Addition) After switching screens in the installed iPhone app, the top two thirds of the screen were blank,
  header included, until a scroll. The new screen was drawn while the page was still scrolled deep into the previous,
  longer screen, which only reset to the top after the render. WebKit then left the composited area above unpainted;
  the blurred (`backdrop-filter`) sticky and fixed bars and the fixed page background make this worse.
  Fix:
  - scroll to the top before the new screen's content changes, and once more after it is drawn
  - no `backdrop-filter` on the phone app's bars
  - no fixed page background
  - phone screens fade in without a transform
  
  Checked in Playwright WebKit (iPhone 15 emulation, local only). `nav-stress` now fails when a switch leaves the page
  scrolled or the header out of view.

## Out of scope

Persisting the panel thread across reloads (the server keeps the conversation for the model).
