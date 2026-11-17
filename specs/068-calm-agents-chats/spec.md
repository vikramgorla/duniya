# 068 · Calm Agents and Chats

Issue #138. Owner: "Make the agent detail screen clean as well, it is very messy. And see how we can make the agents
overview screen more simple and minimalist." Same release: Chats as clean as Agents, less descriptive text everywhere,
the More sheet, a calm Overview, and the header that let content show through while scrolling.

## User stories

1. **Agents list (P1).** As the owner I see one calm row per agent (avatar, name, one muted line, switch, chevron),
   the owner assistant in its own section and *New agent* as one row; on a computer the agent's page opens beside the
   list, on a phone over it. `#agents/<id>` opens an agent.
2. **Agent page (P1).** A compact header (avatar, name, state, switch, ⋯ Test / Change with AI / Duplicate / Export /
   Delete) and grouped section rows showing their current value. Each section is its own page
   (`#agents/<id>/<section>`). Nothing that the old editor could do is lost.
3. **One save model (P1).** A section saves only its own fields: *All changes saved* until something changes, then a
   sticky *Unsaved changes · Save*; after saving, *Undo* puts the previous values back. Leaving with unsaved changes
   asks first. Switches save at once.
4. **Chats (P1).** One row per chat (avatar, name, "Agent · N members" or "Off · N members", a short why-quiet hint,
   switch, chevron) → a chat page with every chat setting; the agent's name links to the agent and back. Filters and
   search on one line; *Add a direct chat* is the last row; the history-load count moves to Settings.
5. **Less text (P2).** At most one short muted line of help per section; details behind a small "?" or the docs.
6. **More sheet (P2).** Compact rows, Refresh as a small icon, the account row; Sign out asks first.
7. **Overview (P2).** A calm status line when everything is fine; Ask without a paragraph; compact numbers, server
   line, why-quiet rows and recent activity.
8. **Header (P1 bug).** Nothing shows through the header while scrolling.

## Acceptance

- Car pooling's page at 375 px is about one screen (was 9,696 px); every section reachable; old deep links
  (`/test`, `/triggers`, `/dm`) still land in the right place; Find anything lists sections.
- `check:responsive` passes at 375 / 393 / 1440, light and dark, with states for every section and the chat page.
- Saving a section changes only its fields (test); Undo restores (test); viewers cannot save (test).
