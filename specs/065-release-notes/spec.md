# Feature Specification: 065 Release notes before and after every update

**Issue**: #131 · **Status**: implemented · **Version**: 2.26.0

## Why

Owner: "Add real change logs to releases and show everything new/changed when we click update."

- An ordinary *Update to vX* said only that the service restarts: nothing about what the owner gets.
- Only breaking releases showed notes, in a hand-made dialog different from the panel's `ask()`.
- After an update nothing said what changed; the panel had no release notes at all.
- `releases.json` had a title and one paragraph per version; 12 released 2.x versions had no entry.
- The Docker image did not contain `releases.json`.

## User stories

1. **Before an update** the owner sees every release between the running version and the target, newest first, each
   with its title and changes (new / improved / fixed / removed); breaking ones are marked with what to do. Long
   lists fold. The button says *Update to vX.Y.Z*. One dialog for ordinary and breaking updates, with the backup
   choice.
2. **After an update** Overview shows *Updated to vX — see what's new* once per person; it opens the same list for the
   versions just installed, and ✕ hides it.
3. **Any time** Settings → Help → Release notes (also in Find anything) lists every version.
4. **WhatsApp**: the breaking-update message names the key changes of the jump; the report after a WhatsApp-confirmed
   update lists what is new.
5. **AI assistants** (admin MCP): `get_update_status` includes the notes of the range; `get_release_notes` reads any
   range; `apply_update`'s preview names the releases it installs.
6. **GitHub Releases** list the changes grouped by kind (new tags via the release workflow; 2.x bodies refreshed).

## Requirements

- FR-001 `releases.json` entries have `changes: [{ type: new|improved|fixed|removed, text }]` (one shape; an unknown
  type reads as `improved`; at most 40 bullets of 300 characters).
- FR-002 CI fails when the version being released has no entry, no title or no changes.
- FR-003 The update status returns `notes`: the entries after the running version up to the target, newest first.
- FR-004 `GET /api/releases?from&to` returns the installed version's own notes (any signed-in user);
  `POST /api/releases/seen` records that the person saw the running version; the status carries `whatsNew` `{ from,
  to }` while a person has not seen the running version and notes exist for the range. A person without a record
  starts at the version the last update (≤ 14 days ago) came from, else at the running version.
- FR-005 No polling, no timers: `whatsNew` rides on the existing status (live stream).
- FR-006 The release notes module loads on demand (first-screen budget).
- FR-007 Untrusted text (notes come from the remote tag) is rendered as text only.
