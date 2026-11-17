# Implementation Plan: 064 UI polish, accessibility and phone feel

**Issue**: #129 · **Spec**: [spec.md](spec.md) · **Version**: 2.25.0 (minor: no breaking change, owners need do nothing)

## Approach

- **Tokens** (`styles.css`): one `:root` set covering colour, people colours, shape, space, type and motion, with one
  dark block. The "Constellation" override layer is merged in and the overridden rules are deleted. Sections: base,
  shell, layout, components, screens, installed/wide, phones.
- **Shell** (`core.js`):
  - The header gets a skip link, a hidden `h1` with the screen name (also the document title), and `nav.tabs` with
    `aria-current`.
  - `nav.tabbar` shows on phones and in standalone + coarse pointer. Its More button lazily loads `find.js#openMore`.
    `signOut`, `go` and `badgeFor` are shared with it.
  - `show()` puts a skeleton in place when another screen loads slowly, adds an enter animation, and moves focus to
    `main` after keyboard navigation.
- **Components** (`core.js`):
  - `ask()`: a `<dialog>` with `role` dialog/alertdialog and `aria-modal`. It uses a `method=dialog` form, puts focus
    on Cancel for danger, has an optional `body`, and an optional `typed` field that keeps the button disabled until
    the word is typed. It becomes a bottom sheet in the phone CSS.
  - `toast(msg, { bad, undo })`.
  - `avatar()`, `emptyState()`, `skeleton()`, `pulse()` + `livePulse()` (from SSE `onmessage`).
  - `field()` connects its label (`for`/`id`) and hint (`aria-describedby`).
  - `fieldError()` replaces two copies of the same toast code.
  - `toggle(…, label)` is a `role=switch`.
  - `optimistic(…, undo)`.
- **Screens**:
  - Overview: the control list with avatars and pulses; the feed with chat names (`activity.js#loadChatNames`); empty
    states.
  - Agents: the card layout.
  - Chats: rows (`.chat-row`) with `<details class=chat-more>`.
  - Activity: `EVENTS` labels (this replaces `TYPE_CLASS` in core).
  - Quiet: spaced actions.
  - Contacts: edit with `ask()`.
  - All `confirm()` / `prompt()` calls (40) move to `ask()`.
  - Server actions pass `{ title, text, body }` with package lists.
- **Server pages**: `public/page.css` and `page.js` are served by `assets.js`. `http.js` gets `PAGE_CSP` and
  `pageHead()`. `resultPage` is rewritten. The Google help page, the GitHub hand-off (`data-autosubmit`) and the MCP
  callback (now `resultPage`) use them.
- **Checks**:
  - `check-panel.mjs` rule against browser dialogs, and the budget raise.
  - `check-responsive.mjs`: contrast audit (blended backgrounds, opacity), accessible names via
    `Accessibility.getFullAXTree`, and new states. It now passes the audit through `page.call`.

## Small servers

Static files only; nothing on the server's tick; no new timers or polling.
