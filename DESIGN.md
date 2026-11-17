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
- **Instrument details:** eyebrow labels, table headers, LED labels and numbers in monospace (uppercase, wide
  tracking for labels); stats in large mono figures; LED dots with a glow for live state.
- **Pills** are short states in sentence case with the text font ("Connected", "2 chats", "Memory"), never
  `UPPERCASE` and never `(s)` plurals (`plural()` in `shared.js`). A user's own label (a member tag, a model id) keeps
  its case: `pill raw`.
- **Avatars** (`avatar(name, id)`): initials on one of the five "people" colours, the same colour for the same agent
  or chat everywhere (agent cards, Overview, Chats, Activity); grey when off.
- **Status console:** Overview opens with one sentence about the state ("Everything is running", "A WhatsApp
  number needs attention"; on a fresh install the first missing thing: "Link your WhatsApp number to begin") and LEDs
  for WhatsApp, Agents and Waiting changes.
- **States:** ok = deep lime, warn = amber, bad = crimson, info = indigo — soft tinted backgrounds with a left rule
  for notes.
- **Type:** Segoe UI Variable / SF Pro / Inter for text and headings (tight tracking); SF Mono / Cascadia /
  JetBrains Mono for labels and numbers.
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
`check:panel` refuses), `toast(msg, { bad, undo })`, `emptyState(art, title, text, action)`, `skeleton()`,
`avatar()`, `pulse()`, `tiles` + stat tile, `table.stack` (cards on phones; every `td` has a `data-label`, empty for a full-width
cell; `stack flat` for long lists), `.tscroll` (key/value tables that keep their columns), `label.tick` (a checkbox on
its own with a 40 px tap area), `meter`, `spark(values)`, `pill`, `note`, `seg` (segmented control), `toggle`,
`btn` (`primary`, `danger`, `small`), `number-card`, `feed`, `bubble` (test console), `spinner`, `modelSelect()`
(Auto / provider · Auto / specific model), `field(label, input, hint)`, `.qa-row` + `.qa-preview` (an editable row of
user-written text with a live *Preview* filled with sample values; rows stack on phones).

## Confirmations (064)

`ask({ title, text, ok, danger, body, typed })` returns a promise of true or false. The title asks the question, the
text says what will happen, and the button names the action ("Delete agent", "Install OS updates", "Restart server",
never "OK"). `danger` (destructive or disruptive) makes the button red and focuses Cancel, so Enter does not confirm it
by accident; Esc, Cancel and a tap outside cancel. `body` holds details (the packages an OS update installs, the
release notes of an update, form fields). `typed` asks to type a word first; use it only for the rare irreversible
action that already asked for it. It is a centred dialog on wide screens and a bottom sheet on phones.

## Accessibility (064)

- Every control has a name: a `<label>` (`field()` connects it), visible text, or `aria-label` for icon buttons and
  for controls without visible text. Switches are `role=switch` and take their name (`toggle(…, label)`).
- Keyboard: everything is reachable with Tab and shows a focus ring (`:focus-visible`); *Skip to content* is the first
  stop; after a screen change, focus moves to the screen; dialogs trap focus and return it.
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
- **Deep links**: `#tab/<section>` scrolls to the element with `data-jump="<section>"` and flashes it once. Give new
  sections a `data-jump`; an old address that moved goes in `MOVED`.
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
- [ ] Empty states use `emptyState()`; first loads show `skeleton()` (the router does this for screens).
