# Duniya design language

*Duniya* means "the world". The panel should feel bright, friendly and personal: a tool a family-event organiser opens on
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

## Visual language — "Aurora" (since v1.6)

Inspired by the friendly, colourful feel of modern AI assistants (e.g. Microsoft Copilot) — **inspiration only**:
no copied logos, icons, illustrations or brand colours. Our own mark (a world with an orbit) stays.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f5f6fb` | `#0c0e1a` | page, under a soft mesh of violet, azure, teal and coral glows |
| `--card` | white 74 % + blur | `#1a1e32` 72 % + blur | frosted-glass cards |
| `--ink` / `--muted` | `#151729` / `#5d6178` | `#eef0fb` / `#a2a7c2` | text |
| `--grad` | violet `#7c5cff` → blue `#4a6cff` → teal `#1fb6c9` | same | primary buttons, active tab, hero, big numbers, meters, toggles |
| `--grad-warm` | coral `#ff8a4c` → pink `#ff5e8a` | same | "hot" meters, attention |
| `--accent` | `#5a4ff3` | `#8f86ff` | links, focus rings, selected segments |
| `--ok` / `--warn` / `--bad` / `--info` | teal / amber / rose / blue (soft backgrounds) | lighter variants | states |

- **Surfaces:** frosted glass cards (backdrop blur, translucent white, hairline light border), 22 px radius, soft
  violet-tinted shadow; inputs solid, 14 px radius; buttons, tabs, pills fully rounded.
- **Colour use:** gradients are for the *one* most important thing on screen (primary action, active tab, hero,
  key number). Everything else stays calm and neutral.
- **Type:** Segoe UI Variable (Windows) / SF Pro (Apple) / Inter; display weight 600–700 with slight negative
  tracking; tabular numbers. Big numbers use gradient text.
- **Icons:** simple 24 px line icons (1.7 px stroke, round caps) next to tab names, drawn by us.
- **Hero:** Overview opens with a gradient greeting card ("Good afternoon, Vik") that says in one line whether
  everything is running.
- **Brand mark:** gradient world (violet→teal) with a coral orbit (`logo()`), also the favicon.
- **Status:** `pill` / `note` with soft tinted backgrounds; live dots with a halo.
- **Motion:** 150 ms colour transitions, a small press scale, a spinner for work in progress; nothing else moves.

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
