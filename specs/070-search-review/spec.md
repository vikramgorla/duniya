# 070 · Search messages, Review & teach, no loose ends

Issue #148. Goal: two everyday power features for an owner running a few family/community agents — find what was said
in any chat, and make agents better from their real answers — plus the loose ends of earlier rounds, without bloat.

## User stories

1. **Search messages (P1).** The owner types two or more characters in Find anything and picks *Search messages for
   "…"*. Results: the stored messages of the chats that are on and not private to members, newest first, 30 at a time
   (*Show older matches*), each with chat, sender, time and a snippet with the words marked. Every word must appear,
   in any order; word beginnings match ("ride" finds "rides"); case and accents do not matter. A hit opens the chat's
   page with *Messages & memory* filtered by the search. Each search is recorded in Activity (search words and the
   number of hits, never message text). The per-chat search, the agents' `search_history` tool and the owner
   assistant's `search_messages` use the same search. Admin MCP: `search_messages` (owner).
2. **Review & teach (P1).** An agent's page has a *Review* section (row: "👍 3 · 👎 1 this week"): its recent answers,
   each with the message that asked for it (the last message to the agent in the 30 minutes before), chat and time.
   Admins rate an answer 👍 or 👎 (tap again to clear); filters *All · 👎 · Not rated*. On a 👎 answer, **Teach…** opens
   the AI helper pre-filled with the question, the answer and "Better answer: "; the helper proposes a FAQ entry (fixed
   facts) or a short rule, shown as the usual visual diff, applied with *Apply & save* (Undo in the toast). Ratings
   keep only who and when; they disappear with the answer (retention, erase memory). Answers in chats that are private
   to members are left out. Viewers cannot read answers. Admin MCP: `list_agent_answers`, `rate_agent_answer`.
3. **Backups with flat memory (P1).** A backup streams the database snapshot, the master key and the WhatsApp sessions
   through gzip and AES-256-GCM into the file; a restore streams back into the staging folder and marks it ready only
   after the authentication tag checked out. Format `DUNIYA2`; backups made by 2.30 or earlier are refused with a
   plain message (make a new backup) — single owner, no compatibility layer.
4. **Lean hot paths (P2).** Settings are parsed once and cached (dropped on every write and when another process —
   the `duniya` command line — changed the database). Usage by day groups with integer math over the server's
   daylight-saving changes. The Chats list leaves out settings at their default.
5. **No inline code on the admin MCP sign-in (P2).** The consent and sign-in pages use the shared page style and
   script (`/page.css`, `/page.js`) under the strict page CSP, and look like the rest of Duniya.

## Not now

Insights ("asked most this week"): needs clustering message text with a model, or repeats the weekly summary and
Usage. Candidate for the weekly summary later.

## Acceptance

- `test/search-review.test.js`, `test/backups.test.js` (damaged file stages nothing, preview opens it),
  `test/usage-messages.test.js` (local days across DST and half-hour zones = SQLite's localtime),
  `test/admin-mcp.test.js` (no `'unsafe-inline'`), `test/cli-signin.test.js` (cache sees CLI changes).
- `npm run measure:scale`: backup RSS +163 → +31 MB; `/api/chats` 97 → 36 KB; usage all-time by day 23.5 → 13.4 ms.
