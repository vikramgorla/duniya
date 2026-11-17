# Feature Specification: 064 UI polish, accessibility and phone feel

**Issue**: #129 · **Status**: implemented · **Version**: 2.25.0

## Why

An audit of every screen showed several problems, at 375 / 393 / 1440 px, light and dark, on a fresh install
(`DEMO_EMPTY=1`) and on a small server (`DEMO_SMALL=1`):

- **Phone navigation.** On a phone, ten tabs sat in a sideways-scrolling strip at the top, so "Activity" was cut off.
- **Styles defined twice.** `styles.css` had two token layers (an older one, overridden by "Constellation"), so most
  components were defined twice with conflicting values.
- **Shouting labels.** Agent cards and the activity feed used UPPERCASE monospace pills (`1 CHAT(S)`,
  `MEMORY.HISTORY`), and the feed showed agent ids and chat numbers instead of names.
- **Chats was very long.** It took 7,900 px on a phone, because every chat showed all of its settings at once.
- **Keyboard and screen readers.**
  - Buttons had no visible keyboard focus.
  - Switches had no role and no name.
  - Many fields had labels that were not connected to them.
  - There was no skip link, and motion ignored *reduce motion*.
- **Loading and feedback.** Screens loaded behind "Loading…" text or a blank page, and error toasts looked like
  success toasts.
- **Browser dialogs.** About 40 questions used the browser's `confirm()` / `prompt()`: unstyled, "OK" instead of the
  action, and different on every phone.
- **Inline styles and scripts.** The server's own pages (sign-in results, Google address help, GitHub app hand-off,
  MCP sign-in callback) needed `'unsafe-inline'`.

## User stories

1. **Phone feel.** On a phone, or in the installed app on a touch screen, the owner switches screens with a bottom tab
   bar: Overview, Chats, Agents, Activity, and **More**. *More* opens a sheet with the other screens, Find anything
   and Sign out, and its badge counts changes waiting for a confirm. Questions open as bottom sheets. The desktop keeps
   the tabs at the top.
2. **Calm, consistent screens.**
   - One set of design tokens; pills in sentence case with correct plurals.
   - Agent avatars in a stable colour per agent, wherever the agent appears.
   - Chats shows one compact row per chat (on/off, who, agent, *Messages & memory*). The rest is under *More
     settings* in place, with hints when something differs from the default.
3. **Activity in plain words.** Each entry says what it is ("Reply", "Stayed quiet", "Earlier messages"), which agent
   (name and avatar) and in which chat (name). The internal type stays in the details.
4. **Live feel.** On Overview, each agent shows *reading…* when a message arrives for it, *using tools…* while it
   works, and *answered* when the reply went out. This comes from the existing event stream, with no polling.
5. **Feedback you can trust.**
   - Skeleton cards while a screen loads for the first time.
   - Error toasts look different and are announced at once.
   - **Undo** after switching a chat on or off and after pausing or resuming all agents.
   - A refused save marks the field the server named, with the reason under it, and focuses that field.
   - Empty states have a small illustration, say what is missing and give the action.
6. **The panel's own questions.** Every confirmation uses one dialog: a clear title, what will happen, and the action
   named on the button ("Delete agent", "Install OS updates", "Restart server"). Destructive actions are red, with
   Cancel focused. Optional details are shown, such as the packages an OS update installs or what an app update
   does. Contacts are edited in the same dialog. `check:panel` fails on any `confirm()`, `alert()` or `prompt()`.
7. **Accessible.**
   - Visible keyboard focus everywhere, a skip link, and focus on the new screen after navigation.
   - Named switches and fields; `aria-current` on tabs and `aria-pressed` on filters.
   - Labelled dialogs that keep focus inside, and reduced motion respected.
   - `check:responsive` fails on any control without an accessible name (Chrome's accessibility tree) and on any text
     below WCAG AA contrast, in light and dark.
8. **Stricter server pages.** The result page, the Google address help, the GitHub app hand-off and the MCP sign-in
   callback load `/page.css` and `/page.js`. Their CSP has no `'unsafe-inline'`.

9. **Clean and dense.**
   - Simple items are rows (mark · name · short status · chevron) instead of cards, with fewer boxes inside boxes and
     tighter spacing.
   - A row's secondary actions sit behind a ⋯ menu (WhatsApp numbers).
   - Models, Settings and Backups are lists that open into pages: two panes on a desktop; on a phone the list, then
     the page with a back arrow. Deep links are `#models/<id>`, `#settings/<section>` and `#backups/<id>`.
   - Adding a provider is one "Add a provider" row.
   - Settings sections are grouped (Agents & chats, People & sign-in, Server, Help), each with an icon and one line.
10. **Plain names.**
    - Providers are ChatGPT, Claude, OpenAI, GitHub Copilot and OpenRouter, everywhere: panel, admin MCP tools and
      activity.
    - Accounts are "ChatGPT · work" only when there are several.
    - Models are named as people know them ("GPT-5.5", "Claude Sonnet 4.5").
    - One source: `src/panel/public/app/names.js`, which the server imports and the panel loads.
11. **Plan usage fits.** A provider row can show "62% of premium requests" with a thin meter, and its page has a *Plan
    usage* section (meters with reset times). It uses only what the provider reports (today: Copilot's quota), never
    made-up numbers.

## Requirements

- R1 No framework, no build step, no new dependency. No polling and no new timers (pulses fade with CSS).
- R2 Budgets raised with the reason in `check-panel.mjs`: first screen 47 → 53 KB, total 147 → 152 KB (brotli).
- R3 `check:responsive` passes at 375 / 393 / 1440 px, light and dark, including the new states: More sheet, open chat
  settings, toasts, a normal / a danger / a details confirmation.
- R4 DESIGN.md describes the tokens, pills, avatars, confirmations and accessibility rules; the website's screenshots and
  tour video are retaken.

## Out of scope (next rounds)

- Virtualised long lists, swipe actions on chat rows, and splitting Settings into sub-pages.
- The admin MCP consent page still uses inline styles.
