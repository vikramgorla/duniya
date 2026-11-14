# DESIGN.md Checklist: Models page (018)

Checked with headless Chrome screenshots: light and dark, phone (390 px) and iPad (820 px), with nothing connected
and with OpenRouter + Copilot connected (Test results shown).

- [x] A non-technical person knows what this screen is for and what to do next ("Start here", numbered steps, links)
- [x] One clear state per provider (Not connected / ✓ Connected · N models / Needs attention + error)
- [x] Long actions show progress (Checking… on connect, spinner on Test); sign-in link valid 15 min stated
- [x] Destructive actions confirm with the consequence (Remove/Disconnect: "bots … stop answering …")
- [x] Looks right in light and dark mode, on a phone and an iPad
- [x] No flicker: Models has no periodic refresh; redraws only after an action
