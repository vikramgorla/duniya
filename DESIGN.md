# Duniya design language

*Duniya* means "the world". The panel should feel calm, warm and personal: a tool a family-event organiser opens on
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
   with the consequence ("Bots are offline for 1–2 minutes"). Owner-only actions are hidden or explained for others.
6. **Stable screens.** Nothing flickers: periodic refreshes update values in place and only redraw when something
   visible changed; inputs being typed in are never replaced.
7. **Works on a phone and an iPad.** Touch targets ≥ 36 px, horizontal scrolling only inside tab bars and tables,
   no hover-only affordances.

## Visual language

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f7f3ec` warm paper | `#11131c` night | page |
| `--card` | `#fffdf9` | `#1a1d2a` | cards, inputs |
| `--ink` | `#1c2030` | `#ece9e2` | text |
| `--muted` | `#6d6a73` | `#9a98a3` | secondary text |
| `--accent` | `#0b7a75` peacock teal | `#3cc4b7` | primary actions, active tab, success |
| `--marigold` | `#e39b2d` | `#f2b553` | highlights, brand orbit, warnings |
| `--bad` | `#b53a4e` | `#f08a9b` | errors, destructive actions |
| `--info` | `#2f5fb3` | `#8db3f5` | neutral notes |

- **Background:** paper with two soft glows (teal top-left, marigold top-right). Never a flat grey.
- **Type:** system UI font for text; rounded display font (`ui-rounded` / SF Pro Rounded) for the brand, headings and
  big numbers. Numbers use tabular figures. Sizes: page text 15 px, small 13 px, card titles 17 px, stats 30 px.
- **Shape:** cards 18 px radius with a hairline border and a soft shadow; inputs 12 px; buttons, tabs, pills and
  segmented controls are fully rounded.
- **Brand mark:** a teal world with a marigold orbit (`logo()` in the panel). Used in the header, login and favicon.
- **Header:** sticky, translucent with blur; brand + WhatsApp status dot on the left, user on the right; tabs are
  pills below, the active tab filled with the accent.
- **Status:** `pill ok/warn/bad/info` for short states; `note ok/warn/bad/info` for a sentence about the state;
  coloured dots with a halo for live connection state.
- **Data:** stat tiles (eyebrow label, big number, one muted line, optional meter and sparkline). Meters turn
  marigold→red above 85 %.
- **Motion:** 150 ms colour transitions, a small press scale on buttons, a spinner for work in progress. Nothing
  else moves.

## Components (in `src/panel/public/index.html`)

`card`, `tiles` + stat tile, `meter`, `spark(values)`, `pill`, `note`, `seg` (segmented control), `toggle`,
`btn` (`primary`, `danger`, `small`), `number-card`, `feed`, `bubble` (test console), `spinner`, `modelSelect()`
(Auto / provider · Auto / specific model), `field(label, input, hint)`.

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
- [ ] Looks right in light and dark mode, on a phone and an iPad.
- [ ] No flicker on the 5-second refresh.
