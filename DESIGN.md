# Duniya design language

*Duniya* means "the world". The panel should feel futuristic, human and personal: a tool a family-event organiser opens on
an iPad between two errands, not an enterprise console. This document is the reference for every screen. When you
add or change UI, check it against the principles and the checklist at the end.

## Principles

1. **Experience first.** The person on the other side may not be technical. Every screen must tell them what it is
   for, what state things are in and what to do next, in plain words. If a step needs a code, a key or a setting
   from somewhere else, link straight to that place and say exactly what to copy.
2. **One clear state.** Show one status line per thing ("✓ Up to date: v1.3.0", "Update available: v1.3.1 · running
   v1.3.0", "Installing… started 20 s ago"). Never show two contradicting badges, raw `null`, ids instead of names,
   or stale data after an action.
3. **Progress you can trust.** Long actions (updates, installs, sign-ins, OS updates) show a spinner with what is
   happening, survive reloads (state lives on the server), cannot be started twice, and finish with a clear result.
4. **Calm by default, detail on demand.** Primary actions are visible; advanced options live in `<details>`
   ("Advanced", "More", "Update settings"). Logs and raw output are collapsible.
5. **Safe by design.** Destructive or disruptive actions are red outline buttons and always confirm in plain words
   with the consequence ("Agents are offline for 1–2 minutes"). Owner-only actions are hidden or explained for others.
6. **Stable screens.** Nothing flickers: live updates (server-sent events, no polling) update values in place and only redraw when something
   visible changed; inputs being typed in are never replaced.
7. **Works on a phone and an iPad.** Down to 375 px wide (iPhone SE; iPhone 15 is 393 px): touch targets ≥ 40 px
   and text ≥ 13 px on phones, no page wider than the screen (only the tab bar, code and `.tscroll` boxes scroll
   sideways), wide tables become cards (`table.stack`), long ids and URLs wrap, no hover-only affordances.
   Installed on the home screen it must feel like an app: form fields are 16 px on phones (no zoom on focus), the
   header and sides keep clear of notches (`env(safe-area-inset-*)`), floating actions sit above the home indicator.

## Visual language — "Constellation" (since v1.7)

Futuristic but human. Inspired by the friendliness of modern AI assistants, **not** a copy of any of them, and
deliberately not the generic "AI app" look (no purple-blue gradients everywhere, no glass on every surface, no ✨).

- **Mark:** a friendly robot in a chat bubble — an assistant that lives in your chats. A solid green (`#4d9b00`,
  "leaf", a yellow-green between the bubble greens of chat apps and our lime) rounded-square speech bubble with the
  tail at the **lower right** holds a dominant ink (`#101216`) robot head: white helmet with an ink rim, ear pads, a
  short antenna with a ball, an ink visor with two smiling lime (`--signal #c6f432`) arc eyes.
  - **Files:** master `docs/site/img/logo.svg` (64-unit grid, transparent); small variant
    `docs/site/img/logo-small.svg` for 16–32 px (no helmet rim, no antenna ball, bigger visor and eyes). The same
    geometry is in `logo()` (panel), the consent pages (`admin-mcp.js`) and the install progress page
    (`infra/oci/bootstrap.sh`). Home-screen icons in `src/panel/public/icons/` are rendered from the master:
    `icon-192/512.png` and `apple-touch-icon.png` (mark at 80 % on porcelain `#f2f1ec`) and `maskable-512.png` (mark
    at 50 %, so Android's circle and squircle masks never cut the tail).
  - **Colours are fixed** in light and dark mode; the solid bubble and white helmet read on both grounds.
  - **Sizes:** small variant at 16–32 px (favicons); master from 30 px up (header 30–32 px, sign-in 76 px, consent
    page 40 px). Home-screen icons: mark at 80 % of the canvas on porcelain; 50 % on the maskable icon so the
    tail stays inside Android's safe zone.
  - **Clear space:** at least ⅛ of the mark on every side; never crop the tail.
  - **Don't:** recolour the bubble or the robot, add gradients, shadows or outlines, stretch or rotate it, put it in
    another container shape, or place it on busy photos.
  - Illustrations (site hero orbit, chat mock avatars) may still use the five "people" colours: saffron `#ff7a3d`,
    rose `#f2477e`, teal `#13b3a1`, indigo `#5363ff`, lime `#9bd400`.
- **Trademark:** Duniya works with WhatsApp, so the mark may *feel* like a chat app, but it must never be confusable
  with WhatsApp's logo (a green circular speech bubble, tail at lower left, white phone handset) — app stores reject
  look-alikes. Rules: the robot head is the dominant element; the bubble is a rounded square with the tail at the
  lower right (never a circle with a lower-left tail); the green stays `#4d9b00`, never WhatsApp's `#25D366` /
  `#128C7E` / `#075E54` family; no phone handset, no WhatsApp name or wordmark in the icon; the app name is "Duniya"
  (never "WhatsApp …"). README and site footer say Duniya is not affiliated with WhatsApp or Meta.
- **Ground:** porcelain `#f2f1ec` with a faint 22 px dot grid (dark: near-black `#0b0c0f`); solid white cards
  (dark `#121419`), hairline borders, a soft shadow; 16 px card radius, 10 px controls.
- **Ink + one signal:** primary actions and the active tab are **ink** (`#101216`); the single signal colour is
  electric lime `--signal #c6f432`, used for "live" — the active-tab dot, LED status lights, the knob of an "on"
  toggle, focus rings, the `AI` chip. In dark mode lime becomes the primary colour.
- **Instrument details:** stats in large mono figures, LED dots with a glow for live state. Labels (eyebrows, table
  headers, legends, card-table labels, status chips) are **sentence case in the text font**, muted and semibold — never
  `UPPERCASE` monospace (066: it read as shouting on a phone). Monospace is for numbers, codes, keys and ids.
- **Pills** are short states in sentence case with the text font ("Connected", "2 chats", "Memory"), never
  `UPPERCASE` and never `(s)` plurals (`plural()` in `shared.js`). A user's own label (a member tag, a model id) keeps
  its case: `pill raw`.
- **Avatars** (`avatar(name, id)`): initials on one of the five "people" colours, the same colour for the same agent
  or chat everywhere (agent cards, Overview, Chats, Activity); grey when off.
- **Status console:** Overview opens with one sentence about the state ("Everything is running", "A WhatsApp
  number needs attention"; on a fresh install the first missing thing: "Link your WhatsApp number to begin") and
  compact status chips with an LED, written as a phrase: "WhatsApp connected", "2 agents live", "3 chats on",
  "Nothing waiting".
- **On the accent:** anything drawn on lime (`--signal`, and `--accent` in dark mode) — text, icons, badges — uses the
  dark on-accent ink (`--signal-ink` / `--accent-ink`), never `--ink` (it is near-white in dark mode). Icons need 3:1
  against what is behind them, text 4.5:1; `check:responsive` measures both, pills drawn by `::before` included.
- **States:** ok = deep lime, warn = amber, bad = crimson, info = indigo — soft tinted backgrounds with a left rule
  for notes.
- **Type:** Segoe UI Variable / SF Pro / Inter for text and headings (tight tracking); SF Mono / Cascadia /
  JetBrains Mono for labels and numbers.
- **Navigation never sticks (066):** an older screen that finishes after you moved on is drawn over by the current one
  again; placeholders never replace a screen that has started drawing; live updates never redraw another screen.
  `nav-stress` in `check:responsive` (run in CI) switches tabs fast on a slow network and fails on leftovers.
- **Loading never hangs (066):** every request has a deadline (`S.loadTimeout`, 15 s), and a screen that fails or
  stalls shows *Couldn't load this screen* with the reason and **Retry**, never skeletons forever (a module that never
  arrived reloads the app). Back from the background after more than 30 s, `recover()` drops waiting requests,
  reconnects the live stream and redraws a screen that was not finished. Touch screens can pull down to refresh (also
  **More → Refresh**).
- **Motion:** colour transitions, a press scale, a spinner, skeleton shimmer while a screen loads, a short fade-in of a
  new screen, sheets that rise, and the live pulse on Overview. All of it stops with *reduce motion*
  (`prefers-reduced-motion`).

## Tokens (064)

One set in `styles.css` `:root` (dark values in one `prefers-color-scheme: dark` block); components use tokens, never
literal values, and there is one rule per component.

| Kind | Tokens |
|---|---|
| Colour | `--bg --bg-2 --card --ink --muted --line --line-2`, `--signal --signal-ink --signal-deep`, `--accent --accent-ink --accent-soft`, states `--ok --warn --bad --info` with `-soft`, people `--p1…--p5`, `--focus --scrim` |
| Shape | `--radius` 16 (cards), `--radius-s` 10 (controls), `--radius-xs` 6 (pills, notes) |
| Space | `--s1`…`--s6` = 4, 8, 12, 16, 20, 24 px |
| Type | `--fs-xs` 12, `--fs-s` 13, `--fs` 15, `--fs-l` 17, `--fs-xl` 26; `--font`, `--font-display`, `--mono` |
| Motion | `--fast` .15 s, `--slow` .28 s, `--ease` |

Text meets WCAG AA (4.5:1, 3:1 for large text) in both themes; `npm run check:responsive` measures it.

## Components (in `src/panel/public/app/`: `styles.css`, `core.js` helpers, screen modules)

`card`, `ask()` (the panel's own confirmation: never the browser's `confirm()`, `alert()` or `prompt()`, which
`check:panel` refuses), `toast(msg, { bad, undo })`, `emptyState(art, title, text, action)`,
`avatar()`, `pulse()`, `menu()` (⋯), `listDetail()`, `tiles` + stat tile, `table.stack` (cards on phones; every `td` has a `data-label`, empty for a full-width
cell; `stack flat` for long lists), `.tscroll` (key/value tables that keep their columns), `label.tick` (a checkbox on
its own with a 40 px tap area), `meter`, `spark(values)`, `pill`, `note`, `seg` (segmented control), `toggle`,
`btn` (`primary`, `danger`, `small`), `number-card`, `feed`, `bubble` (test console), `spinner`, `modelSelect()`
(Auto / provider · Auto / specific model), `field(label, input, hint)`, `.qa-row` + `.qa-preview` (an editable row of
user-written text with a live *Preview* filled with sample values; rows stack on phones).

## Density and layout (064)

Calm and compact: say more with less chrome.

- **Rows before cards.** A simple item is one row: mark or avatar · name · short status in muted small text · chevron
  (`.lrow`, 44 px tall on desktop, 52 px on phones). A card is for a whole section, never for a single fact.
- **No boxes in boxes.** Inside a card, separate items with a hairline (`border-top`), not a nested bordered box.
  Cards use 16–18 px padding and 12 px gaps.
- **Secondary information** goes in muted small text on the same row. **Secondary actions** go behind a ⋯ menu
  (`menu(label, …buttons)`), or onto the item's page, never in a row of buttons. A row shows at most one primary
  action.
- **Progressive disclosure.** Show what is needed every day. The rest goes under *More settings* in place, an
  *Advanced* `<details>`, or the item's page.
- **List → page** (`listDetail()` in `listdetail.js`).
  - A list of rows, grouped under eyebrow titles, and the page of the chosen row.
  - On wide screens: two panes, with the list sticky on the left.
  - On phones: the list, then the page pushed over it with a back arrow.
  - Deep links are `#<screen>/<id>`; Find anything and the back button work.
  - Adding something is one row at the end of its list ("Add a provider").
  - Used by Models, Settings and Backups. Agents → editor and Chats → *More settings* follow the same idea.
- **Touch:** every target is at least 44 px on phones (40 px is the hard floor that `check:responsive` enforces).

## Names (064)

Names are short and familiar, and the same everywhere: the panel, the admin MCP tools, activity, docs and the website.
The one source is `src/panel/public/app/names.js` (`PROVIDER_NAMES`, `accountName()`, `modelName()`). The server uses
it for the names its API returns, and panel modules import it.

- Providers: **ChatGPT**, **Claude**, **OpenAI**, **GitHub Copilot**, **OpenRouter**, and **Custom (OpenAI-compatible)**
  only where a generic endpoint must be named. No explanations in brackets: how you connect (sign in or key) belongs
  on the provider's page.
- Accounts: the provider's name, with the label only when there are several accounts: "ChatGPT · work".
- Models: as people know them ("GPT-5.5", "Claude Sonnet 4.5"). The provider's own display name wins; a raw id is
  tidied. The raw id appears only as small print on detail pages.

## Meters (064)

`meter(percent)` is a 6 px track; the fill is ink in light mode and lime in dark mode. From 85 % the fill turns red
(`hot`). On a list row a 3 px `lmeter` sits under the short status ("62% of 5-hour limit"). A provider's page shows a
**Plan usage** section: one meter per limit with "N% used" and "resets …". The data is what the provider reports
(`limits` on the account, or Copilot's premium requests) and is never made up. Without data the section is hidden.

## Confirmations (064)

`ask({ title, text, ok, danger, body, typed })` returns a promise of true or false. The title asks the question, the
text says what will happen, and the button names the action ("Delete agent", "Install OS updates", "Restart server",
never "OK"). `danger` (destructive or disruptive) makes the button red and focuses Cancel, so Enter does not confirm it
by accident; Esc, Cancel and a tap outside cancel. `body` holds details (the packages an OS update installs, the
release notes of an update, form fields). `typed` asks to type a word first; use it only for the rare irreversible
action that already asked for it. It is a centred dialog on wide screens and a bottom sheet on phones. `wide` gives a
long details area room (release notes); `ok: null` makes a dialog to read, with only the `cancel` button ("Close").

## Release notes (065)

`releaseList(versions)` in `releases.js` (loaded on demand) is the one way to show what versions bring: a row per
version (mono version · title, a *Needs your OK* pill on breaking ones), folding open into its changes grouped under
eyebrow labels *New*, *Improved*, *Fixed*, *Removed*; breaking releases are open and show a warn note with what to
do. The newest one or two start open, so a long range stays a short list. It is used in the update dialog (every
release between the running version and the target), *What's new* after an update (a one-line card on Overview,
shown once per person, ✕ hides it) and Settings → Help → Release notes. Bullets are owner-facing plain sentences
(`docs/development.md#release-notes`).

## Activity rows (066)

Activity (and Overview's *Recent activity*) is grouped under day headings (*Today*, *Yesterday*, *Mon 16 Nov*). Each
entry is one row: a marker (the agent's avatar, or a tinted icon for the type) · **one bold subject line** (what
happened, in plain words, at most three lines until tapped) · the time, small and right-aligned; underneath, muted: the
type with its colour dot, the agent, the chat. Never repeat the type in the subject ("Stayed quiet: …" shows "Chat is
off…"), never show raw tool names: `toolPhrase()` in `names.js` is the one mapping ("get_maintenance_status" →
"Checked maintenance status"). Rows are separated by hairlines and get a soft band on hover or when open.

## Ask (066)

The Ask box is a conversation (`askCard()` in `ask.js`; Overview and the owner assistant's *Try it*). The question is
a bubble on the right; then *Thinking…* (muted shimmer and three dots) until the first token; each tool is a chip that
appears with a spinner ("Checking server metrics…") and turns into ✓ / ⏸ / ✕ with `toolPhrase()`, folded to *Used N
tools* when the answer is done; the answer streams as a safe markdown subset (paragraphs, lists, bold, code) built
from text nodes, with a blinking caret. The thread scrolls inside the card and follows the answer until the reader
scrolls up. While it streams the button is **Stop**; after it: **Copy**, and the box asks for a follow-up. Errors show
the reason and **Retry**. Every animation stops with *reduce motion*.

## Accessibility (064)

- Every control has a name: a `<label>` (`field()` connects it), visible text, or `aria-label` for icon buttons and
  for controls without visible text. Switches are `role=switch` and take their name (`toggle(…, label)`).
- Keyboard: everything is reachable with Tab and shows a focus ring (`:focus-visible`); *Skip to content* is the first
  stop; after a screen change, focus moves to the screen; dialogs trap focus and return it. A sheet opened by touch
  (More, `ask()` on a touch screen) focuses itself, not its first button, so no ring appears on a button nobody
  touched (066).
- Icons inside buttons are always icon-sized (`.btn svg`, 18 px): an unsized SVG fills its button.
- The current tab has `aria-current="page"`; filters are buttons with `aria-pressed`; error toasts are `role=alert`.
- `npm run check:responsive` fails on a control without a name (Chrome's accessibility tree) and on text below AA.

## Finding your way (062)

- **Phones and the installed app** (064): a bottom tab bar with Overview, Chats, Agents, Activity and **More** (a sheet
  with the other screens, Find anything and Sign out; its badge counts changes waiting for a confirm). Wide screens
  keep the tabs at the top.
- **Tabs** in everyday order (Overview, Chats, Agents, Activity, Usage, Models, Contacts, Server, Backups, Settings).
  A tab that is usually empty appears only when it has something (Pending, with a count). Small lists are a section of
  a bigger screen, not a tab (Secrets lives in Settings).
- **Find anything** (`openPalette()`): `/` or ⌘K / Ctrl+K, or the search button in the header. Every new screen,
  Settings section (`SETTINGS_SECTIONS`) or frequent action should be findable there.
- **Deep links**:
  - On list → page screens, `#tab/<id>` opens that page (Models, Settings, Backups). A new Settings section goes in
    `SETTINGS_SECTIONS` (Find anything) and in `SETTINGS_GROUPS`, with its icon and one-line description.
  - Elsewhere, `#tab/<section>` scrolls to the element with `data-jump="<section>"` and flashes it once.
  - An old address that moved goes in `MOVED`.
- **Getting started** is the one first-run guide: the current step opens in place with its action (no tab-hopping);
  steps can be skipped; it ends with an *All set* card and then disappears. Don't add a second checklist or wizard.
- **Empty states teach**: say what is missing and link to where it is fixed ("WhatsApp is not linked yet… Link
  WhatsApp on Overview"), never "No data".

## Writing

- Say what happens, then what to do: "Sign-in to panduga expired. Click Reconnect."
- Name things as the user sees them: "WhatsApp numbers", "Chats", "Server", not internal terms (MCP is "tool
  service", provider ids only in small print).
- Buttons are verbs: "Update to v1.3.1", "Install OS updates", "Connect".
- Times are relative where it helps ("checked 2m ago") and absolute in history.

## Checklist for every UI change

- [ ] A non-technical person knows what this screen is for and what to do next.
- [ ] One clear state; no `null`, ids or stale status visible.
- [ ] Long actions show progress, survive a reload and cannot double-run.
- [ ] Destructive actions confirm with the consequence.
- [ ] Looks right in light and dark mode, on a phone and an iPad; `npm run check:responsive` passes (375 / 393 /
  1440 px).
- [ ] No flicker when live updates arrive (status and activity over `/api/events`); no new polling.
- [ ] Every control has a name, keyboard focus is visible, text meets AA in both themes (`check:responsive`).
- [ ] Questions use `ask()` with the action named on the button; reversible switches offer Undo.
- [ ] Empty states use `emptyState()`; first loads show skeletons (the router does this for screens).
- [ ] Simple items are rows, not cards; secondary actions sit behind ⋯ or on the item's page; lists with pages use
  `listDetail()` and deep links.
- [ ] Provider, account and model names come from `names.js`; tool names are shown with `toolPhrase()`.
- [ ] Nothing on lime uses `--ink`; labels are sentence case, not mono caps; icons in buttons are sized.
