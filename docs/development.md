# Development

**Run Duniya locally with fakes for everything external, test it, and ship a release.**

```bash
npm install && ADMIN_PASSWORD=dev-password-123 npm start     # panel on http://127.0.0.1:8080
```

**In 30 seconds**
- Tests fake WhatsApp, models, MCP, GitHub and S3; the demo panel needs no network.
- Every feature has a Spec Kit folder; Definition of Done: [AGENTS.md](../AGENTS.md).

| Command | What |
|---|---|
| `npm test` | e2e tests with fakes, four test files at a time (~30 s) |
| `npm run lint` | ESLint (server code with Node globals, the panel's modules with browser globals) |
| `npm run typecheck` | `tsc` over every file that starts with `// @ts-check` ([Type checking](#type-checking)) |
| `npm run check:panel` | the panel's modules link (every import names a real export) and stay within their budgets ([Panel modules](#panel-modules)) |
| `node scripts/ci-checks.mjs` | versions match, breaking-release entries, **doc links** (`scripts/check-doc-links.mjs`), diagrams, **lean code** (knip, jscpd, panel budgets), types, **performance budgets** (`check-perf`) |
| `npm run check:perf` | no full scans of large tables on hot paths, and every time budget met, against the scale fixture ([Performance budgets](#performance-budgets), ~30 s) |
| `npm run knip` / `npm run jscpd` | unused files, exports and dependencies / duplicated code ([Lean code](#lean-code)) |
| `node scripts/demo-panel.mjs` | seeded demo panel on :8099 (admin / demo-password-123), no network |
| `DEMO_EMPTY=1 node scripts/demo-panel.mjs` | a fresh install (no provider, no agent, WhatsApp waiting for a scan; *Get code* links it): check the first run |
| `npm run check:responsive` | every screen at 375 / 393 / 1440 px, light + dark: layout, tap targets, text size, and accessibility (every control named, AA text contrast, 3:1 for icons) (needs Chrome). CI runs its navigation states: `nav-stress` (fast tab switching on a slow network ends on the chosen screen, fully drawn), `load-failed` / `load-retry` (a hung request ends in Retry, and Retry recovers) |
| `npm run site:shots` | retake the website screenshots and videos (needs Chrome + ffmpeg) |
| `npm run measure:load` | first load of Overview in headless Chrome on slow and fast networks and a phone-speed CPU: bytes and time, cold and warm |

## Spec Kit

Built with [GitHub Spec Kit](https://github.com/github/spec-kit): constitution `.specify/memory/constitution.md`,
every feature under [`specs/`](../specs).

<p align="center"><img src="diagrams/speckit-workflow.svg" alt="Spec Kit workflow: /speckit-specify, then /speckit-plan, /speckit-tasks, /speckit-implement and /speckit-converge" width="246"></p>

<details><summary>Diagram as text</summary>

1. `/speckit-specify`
2. `/speckit-plan`
3. `/speckit-tasks`
4. `/speckit-implement`
5. `/speckit-converge`

</details>

Process: [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) · design: [DESIGN.md](../DESIGN.md).

## Lean code

The owner runs the latest version on one server, so the code carries nothing for older ones. Before adding, delete:

1. **Search for what your change replaces** and remove it in the same PR (old function, setting, wording, test).
2. **No compatibility layers or one-time migrations** after the release that needed them: schema changes go into
   `CREATE TABLE`; owners reinstall or restore a backup ([upgrading](upgrading.md)).
3. **One way to do each thing:** reuse the resolvers (`resolveModel`, the name resolver), the scheduler tick
   (`src/core/upkeep.js`), the small-server switch and the shared helpers in `src/core/config.js` (`clip`, `bad`,
   `plural`, `isGroup`, and `fail(message, status, extra)` for any error the panel answers with a status) instead of a
   local copy.
4. **CI checks it** (`node scripts/ci-checks.mjs`, quality job): `knip` (config `knip.json`) fails on unused files,
   exports and dependencies, `jscpd` (`.jscpd.json`, 8 lines) on duplication (both cover the panel's modules too), and
   the panel has two budgets in `scripts/check-panel.mjs`: the first screen and all of its code (raising one needs a
   reason in the PR).
5. **Queries use an index:** `npm run check:perf` (also in `ci-checks.mjs`) fails on a full scan of a large table
   and on a missed time budget ([Performance budgets](#performance-budgets)).
6. **Test behaviour, not internals:** tests go through the panel API, the router and the fakes in `test/harness.js`;
   export something only when the app uses it.
7. **Keep the panel snappy:** no new polling. The status and activity arrive over `/api/events` (server-sent events);
   screens load through `api()`, whose screen-data cache is dropped by any change or live event. Simple switches update
   the screen at once and put the old state back when the server refuses. The shell and its modules are served from
   memory, compressed, with ETag/304; screens load on their first visit ([Panel modules](#panel-modules)).

## Panel modules

The panel is one dependency-free app in native ES modules: no framework, no bundler, no build step. Edit a file, reload.

| File (`src/panel/public/`) | What |
|---|---|
| `index.html` | the shell: meta tags, `app/styles.css`, `<script type="module" src="/app/main.js">` |
| `app/main.js` | entry: page-wide listeners (keyboard, back from the background), then sign-in |
| `app/core.js` | `h()` (untrusted text only through `textContent`), `api()` and its cache, the shared state `S`, the shared components (`ask()` confirmation, `toast()`, `field()`, `toggle()`, `avatar()`, `emptyState()`, `skeleton()`), the shell: top tabs and the phone tab bar, router (`show()`), live stream |
| `app/login.js` | sign-in, first-run setup, one-time sign-up and secret links |
| `app/shared.js` | small helpers several screens use (formatting, model picker, usage line, server size, links) |
| `app/<screen>.js` | one module per screen: `overview`, `chats`, `agents` + `agent-editor`, `activity`, `usage`, `models`, `people` + `people-groups` (Households and Lists), `pending`, `server`, `backups`, `settings`; parts: `start` (Getting started), `ask` (the Ask card), `quiet`, `updates`, `find` (Find anything and the phone's More sheet), `fallback`, `tool-editor`, `registry`, `ai-helper`, `diff`, `channels` (Settings → Channels and a channel's page) |
| `app/styles.css` | all styles, one set of tokens ([DESIGN.md](../DESIGN.md#tokens-064)) |
| `page.css`, `page.js` | the standalone server pages (sign-in results, Google address help, GitHub app hand-off): files, so their CSP needs no `'unsafe-inline'` |

1. **Static imports for what a module always needs**, `import('./x.js')` for what it may need later. `core.js#show()`
   loads each screen on its first visit; Find anything and the AI helper load when first opened.
2. **The first screen stays small:** `main.js` and `overview.js` with their static imports are preloaded
   (`<link rel=modulepreload>`) and must fit the first-screen budget. Something only another screen needs belongs in
   that screen's module, not in `shared.js` or `core.js`.
3. **Shared state lives in `S`** (`core.js`): a module cannot assign another module's variable, so `S.models`,
   `S.overviewBusy`, `S.dmPrefill` are properties, not `let`s.
4. **Serving** (`src/panel/assets.js`): every file under `/app/` gets a content-hash URL (`?v=…`, cached for a year);
   the shell carries an import map from each plain path to its hashed URL, so relative imports reach the same file and a
   release only re-downloads what changed. The import map is the shell's only inline script; its hash is in the
   Content-Security-Policy, so scripts need no `'unsafe-inline'`.
5. **Checks:** `npm run check:panel` links every module the way the browser does (a missing export fails), checks the
   names loaded through `import()`, refuses the browser's `confirm()`, `alert()` and `prompt()` (use `ask()`), and
   enforces the budgets. ESLint, knip and jscpd cover the modules.
6. **Scripts that drive the page** (`check-responsive`, `site-shots`) reach panel functions with
   `await import('/app/core.js')` (the import map makes it the page's own module); nothing is global.

## Panel server

Routes live in `src/panel/routes/<area>.js` (`auth`, `status`, `agents`, `chats`, `people`, `system`, and one per
feature), each exporting `<area>Routes(route, { channel })`. `src/panel/server.js` registers them in one place and keeps
only the router (role gates, the JSON-only CSRF guard), the admin MCP's in-process calls and the static files. A handler
returns the JSON answer, `[status, answer]`, or throws `fail(message, status)` / `bad(message, field)`
(`src/core/config.js`); the router turns the error into `{ error, field, code }` with that status.

## Adding a channel

Chat channels plug into the hub (`src/channels/hub.js`); WhatsApp (`src/channels/whatsapp/`) and Telegram
(`src/channels/telegram/`, a bot over `fetch` with no dependency) are the references. The rest of
the app never asks which channel a chat is on: it calls `channel.send(chat, …)`, `isGroup(chat)`, `phoneOf(chat)` and so
on, and the hub and the catalogue answer from the chat id.

1. **Catalogue entry** in `src/channels/index.js`: `id`, `label`, `prefix` (chat ids become
   `<prefix>:<account>#<native id>`, e.g. `tg:bot1#-1001234567`; only WhatsApp is unprefixed), `setup` (`qr`, `token`, …),
   `caps` (what it can do — tools, prompt hints and panel controls follow them) and `ids` (`isChat`, `isGroup`,
   `isDirect`, `phoneOf`, `personOf`, and `phoneChat` only for phone-based channels). Metadata only: no imports of the
   adapter.
2. **Adapter module** `src/channels/<id>/index.js` exporting a factory. It implements `start(handlers)`, `stop()`,
   `status()`, `listChats()`, `send(chat, text, opts)` and the chat actions its `caps` promise (`react`, `sendPoll`,
   `sendMedia`, `groupInfo`, …), all with the app chat id first; `upkeep()` for bounded background work. Inbound
   messages go to `handlers.onMessage` in the one shape described at the top of `hub.js` (`chat`, `isGroup`,
   `phone` only when the channel vouches for it, `senderJid` = the sender's id on the channel, `mentioned`,
   `replyToAgent`, …). Channels without phone numbers pass a phone only for a verified identity (Telegram: the person
   shared their own contact, `contact.user_id === from.id`; later messages read it with `phoneOfIdentity`), so people
   join across channels safely (`src/core/people.js`).
3. **Hub wiring** in `hub.js`: a loader (`import('./<id>/index.js')`), how to tell it is set up (a setting or a file,
   without loading it) and, if needed, its first account when it is switched on. A token channel needs only a
   `secret` in its catalogue entry (`name`, `pattern`, `hint`): it is set up while that secret is stored, the token is
   checked when saved, and saving or removing it restarts or stops the channel.
4. **No timers, no idle sockets:** reconnect with backoff inside the adapter on events; periodic work goes through
   `upkeep()` (the hub calls one channel per 30-second tick). Nothing opens while the channel is not set up or off.
5. **Dependencies:** prefer none (`fetch`, Node's `WebSocket`). A dependency must be pure JS, imported only inside the
   adapter (it then loads only with it), and the plan states its install size and measured memory.
6. **Panel:** the channel appears under **Settings → Channels** by itself (from the catalogue); its page goes into
   `app/channels.js`. Only real channels are listed — no "coming soon" rows.
7. **Tests** with a fake adapter: `createHub({ loaders: { <id>: async () => fake } })` (see `test/channel-hub.test.js`);
   the lazy-loading test checks that a fresh install never imports the channel's library. A channel over HTTP can also
   run its real adapter against a fake API, as `test/fake-telegram.js` does for Telegram (tests and the demo panel).

## Type checking

`npm run typecheck` runs `tsc` (a dev dependency, nothing is compiled or emitted) over every file that starts with
`// @ts-check`; the quality job runs it through `ci-checks.mjs`. Core modules, the panel server and its routes opt in.

- Add `// @ts-check` to a file you work on when it passes, or with a few JSDoc types where they pay off: a function
  whose options are destructured without defaults (`/** @param {{ count?: number, by?: string }} [o] */`), an array
  that mixes kinds (`/** @type {(string|number)[]} */`). Do not annotate what TypeScript already infers.
- SQLite rows are untyped (`db.prepare()` hands out plain rows, `src/core/db.js`); settings have a `Settings` typedef
  (`src/core/store.js`); route modules type their registrar with `Route` / `RouteContext` (`src/panel/http.js`).

## Performance budgets

`npm run check:perf` (`scripts/check-perf.mjs`, run by `node scripts/ci-checks.mjs` in the quality job) seeds the scale
fixture (`scripts/scale-fixture.mjs`, below) into a temp data directory with the real schema, then runs the hot paths
through the real core and panel with the test fakes: the router per message, an agent turn with a tool, the panel's
lists and pages, search, People (list, filters, a person's page, export), the owner assistant's and admin MCP's reads,
and the retention pass of the upkeep tick.

1. **Query plans.** Every statement the app prepares meanwhile goes through `EXPLAIN QUERY PLAN` against the seeded
   database. A full scan of a large table (≥ 1 000 rows in the fixture) fails: `SCAN <table>` with or without an index,
   and a `SEARCH` on the tenant alone (`(tenant_id=?)` reads every row). So a new query without an index fails CI.
2. **Time budgets.** The median of 9 runs of each key path (person page, people list and search, a chat's messages,
   search messages, one chat's activity, the router per message, an agent's context) stays within `BUDGETS`.

When it fails:
- **Add the index** (in the `CREATE TABLE` block of its module) or **write the query so it can use one**: put the
  constant in the query (`AND phone <> ''` for a partial index), drive a filter from the small side (`p.id IN (SELECT
  person FROM person_tags WHERE tag = ?)`), seek instead of offset (`id < ?` for the next page), `INDEXED BY` where
  SQLite picks the wrong one. Mind the size on a 1 GB server and say it in the PR.
- **A scan that is right** (counts on Server → Health, a list that must sort every name, a newest-first walk that stops
  at `LIMIT`) goes on `ALLOW_SCANS` in `scripts/check-perf.mjs` with its reason; a marker comment in the SQL
  (`/* people: every name sorts */`) keeps the entry to that one statement.
- **Raise a budget only with a reason**, like the panel budgets: keep the old value in the comment and say why in the
  PR. Budgets are about 2.5× what a CI runner measured (noted next to each). `--verbose` prints every checked plan.

A path the workload does not reach is not checked: when you add a hot path (a new screen, router step or agent tool),
add it to the workload in `check-perf.mjs`.

## Scale measurements

`npm run measure:scale` (dev only, `scripts/measure-scale.mjs`) runs the real core and panel through the test fakes
against a seeded data directory: **300 chats (20 on) over 3 numbers, 30 agents, 200 000 stored messages over 80 days,
50 000 activity entries, 20 000 usage rows, 5 000 people with 20 000 identities, notes, tags, households and lists**
(`scripts/scale-fixture.mjs`, shared with [`check-perf`](#performance-budgets)). It prints startup in a fresh process pinned to one CPU
(`taskset -c 0`, `--max-old-space-size=700`), panel API latencies (median / p95 of 15), live-stream fan-out to 20
panels, router throughput, a retention pass, one backup and the database size.
`--small` runs a tenth of the fixture. Run it before and after a change that touches the database, the router or the
panel API, and put both tables in the PR.

Before and after 069 (#143), same machine:

| | v2.29.1 | v2.30.0 |
|---|---|---|
| Startup to panel ready (1 CPU) / RSS | 416 ms / 158 MB | 276 ms / 164 MB |
| Router: stored, not addressed | 257 msg/s | 970 msg/s (3.8×) |
| Router: chat off | 1 923 msg/s | 11 250 msg/s (5.9×) |
| Router: answered by the fake model | 64 msg/s | 240 msg/s (3.8×) |
| Panel API (status, chats, agents, activity pages, people) | 1–7 ms median | 1–7 ms median (Health 1 ms) |
| Usage by day, all time | 21 ms | 21 ms |
| Activity for one chat / age prunes | `SCAN activity` / `SCAN messages` | index searches |
| Retention (messages kept 30 days) | pruned on the write path | 125 000 rows in 63 upkeep ticks, ≤ 102 ms each |
| One backup | – | 1 s, 6.7 MB, +167 MB RSS while it runs |

What made the difference: WAL with `synchronous = NORMAL` (no fsync per write), no pruning on the write path (one
bounded pass on the upkeep tick, `src/core/retention.js`), indexes for the chat filter and the age prunes, one date
formatter per time zone, and counting before loading rows to summarize.

Before and after 070 (#148), same fixture:

| | v2.30.0 | v2.31.0 |
|---|---|---|
| One backup | 1 s, 6.7 MB, +163 MB RSS | 1.2 s, 6.9 MB, **+32 MB RSS** (streamed: snapshot file → gzip → AES-GCM → file) |
| `/api/chats` (300 chats) | 97 KB | **36 KB** (settings at their default left out) |
| Usage by day, all time | 23.5 ms | **13.3 ms** (integer local days instead of `strftime(…'localtime')` per row) |
| Search messages: one hit / a word in every message | – | 2.1 ms / 13.3 ms (FTS5, walked newest first) |
| Agent review (first page) | – | 1.4 ms |
| Router: stored, not addressed / answered | 769 / 202 msg/s | 824 / 218 msg/s (the FTS trigger is within the noise) |
| Database after retention (79k messages) | 36.3 MB | 48.4 MB (+12 MB full-text index) |

A database from before 2.31 builds its full-text index once at start (about 0.2 s per 80 000 messages on one CPU).

Before and after #174 (performance budgets), same fixture (900 people writing the 200 000 messages):

| | v2.39.0 | v2.39.1 |
|---|---|---|
| Person page | 202 ms (`SCAN messages` for the groups they wrote in) | **7 ms** |
| People list (first page) | 430–520 ms (each row's apps read all 20 000 identities) | **5 ms** |
| People search | 416 ms | **20 ms** |
| Activity, an older page | walks every newer row | index seek from `before` |
| Retention pass | `SELECT DISTINCT chat` over every message; activity cap by `OFFSET` | one lookup per chat; cap by row id |
| Indexes added | – | `messages(sender)` 4.1 MB, `messages(sender_jid)` 7.1 MB per 200 000 messages |

## Commits and pull requests

No attribution trailers or footers in commits and PRs (no Co-Authored-By, session links or 'Generated with' lines).
Commits are authored by the repository owner's identity; no AI co-author trailers or signatures; squash merges use an
explicit message. Squash-merge with `gh api -X PUT repos/vikramgorla/whatsapp-agent-duniya/pulls/N/merge -f merge_method=squash -f
commit_title="<PR title> (#N)" -f commit_message="<short summary>"`, so GitHub does not append trailers from the branch commits.

## Repository and forks

The GitHub repository lives in **one place**: `"repository": "github:owner/name"` in `package.json` (the standard
npm field, next to the version; no extra file). Everything else follows from it:

| Where | How it gets the repository |
|---|---|
| App, CLI, admin MCP | `REPO` from `src/core/config.js` (`url`, `git`, `pages`, `image`, `blob(ref, path)`; derived in `src/core/repo.js`) |
| Panel | the shell's `<meta name="duniya-repo">` (filled by `src/panel/assets.js`), read by `docsUrl()` / `repoFile()` in `shared.js` |
| Update source of a server | the checkout's git remote (installed from; changed in **Settings → Updates** or `duniya source`) |
| Root maintenance helper | `/etc/duniya/install.conf` (written by the installer and `sudo duniya source`; nothing built in) |
| Installer, GCP script, OCI stack, compose file, README, docs, website | absolute URLs rewritten by `npm run repo:sync`; `DUNIYA_REPO` / `--repo` override at install time |
| Workflows | `github.repository` (release image `ghcr.io/<owner>/<name>` in lowercase, release assets, Pages) |

`npm run repo:sync` (`scripts/repo-sync.mjs`) rewrites every project URL in tracked text files to the slug in
`package.json`: `github.com/o/n`, `raw.githubusercontent.com/o/n`, `ghcr.io/o/n`, `repos/o/n`, `o.github.io/n` and
URL-encoded forms, only for this project's names (prose and server-local names such as the systemd unit are never
touched; `specs/` keep their history; example owners `you`, `alice`, `bob`, `carol` are left alone). `-- --repo owner/name` sets a new slug first, `-- --check` only lists. It is
idempotent. `node scripts/ci-checks.mjs` fails on any project URL with another slug (`findDrift`), so nothing is
forgotten. The fork-setup workflow (`.github/workflows/fork-setup.yml`) runs the sync on a fork or a renamed
repository and opens a pull request; on the project itself it does nothing.

**Renaming the repository** (owner):

1. GitHub → the repository → **Settings → General → Repository name** → new name → **Rename**.
2. Wait for the **Fork setup** workflow (runs on the next push to `main`, or **Actions → Fork setup → Run workflow**):
   it opens *Set up this repository: owner/new-name*. Or locally: `npm run repo:sync -- --repo owner/new-name`, then a
   PR. Add the old name to `FORMER_NAMES` in `scripts/repo-sync.mjs` in the same PR so stray old links are caught.
3. Merge it. A release follows (version bump in the PR), so the OCI button finds `duniya.zip` under the new name.

GitHub forwards old repository, git, raw and release URLs (servers keep updating; switch their source when
convenient), **but not GitHub Pages**: the website moves to `https://<owner>.github.io/<new-name>/` (republished by
the Pages workflow when `docs/site` changes; run it by hand once after the rename). The container image is published
under the new name from the next release on.

## Releases

1. Bump the version in `package.json`, `package-lock.json` and `infra/oci/schema.yaml` (CI checks they match) and add
   an entry for it to `releases.json` with its [release notes](#release-notes) (CI fails without a title and changes).
2. Merge to `main` (or push a `vX.Y.Z` tag, or run the workflow by hand).
3. The release workflow creates the tag and GitHub release (notes built from the entry by `scripts/release-notes.mjs`),
   attaches the OCI stack zip (`duniya.zip`) and publishes `ghcr.io/vikramgorla/whatsapp-agent-duniya` (named after
   the repository that runs it, so a fork publishes its own).

### Release notes

Owners read these in the update dialog (every version between theirs and the target), once after an update (*What's
new*), in Settings → Help → Release notes, on WhatsApp and on GitHub Releases. Write them for the owner, not for
developers.

```json
"2.26.0": {
  "breaking": false,
  "title": "One line: what the owner gets",
  "summary": "Optional paragraph. End with what the owner must do, or 'Nothing to do on your server.'",
  "changes": [
    { "type": "new", "text": "After an update, Overview shows what's new once." },
    { "type": "improved", "text": "The update dialog lists every release in between." },
    { "type": "fixed", "text": "Docker installs show the release notes too." },
    { "type": "removed", "text": "The old update dialog." }
  ]
}
```

- `type` is one of `new`, `improved`, `fixed`, `removed` (one shape for every bullet; anything else is read as
  `improved`). The notes group by it in that order.
- One short sentence per bullet, as the owner sees it: screen and button names, no issue numbers, file names, function
  names or library versions. Two to eight bullets; a docs-only or tooling release still gets one ("Build tools updated;
  nothing changes in the app").
- Breaking releases add `actions` (what the owner must do), `data` and `docs` (see
  [upgrading](upgrading.md#how-breaking-releases-reach-you)).
- CI (`scripts/ci-checks.mjs`) fails when the new version has no entry, no title or no changes.

> [!NOTE]
> The website lives in [`docs/site/`](site/) (plain HTML/CSS, no build step) and is deployed to GitHub Pages by
> `.github/workflows/pages.yml` on every push to `main` that touches it.

> [!TIP]
> Docs pages follow one template: promise · primary action · *In 30 seconds* · steps with screenshots · callouts ·
> a diagram for flows · `<details>` for reference · **Next:** links. Thumbnails in `docs/img/` are 800×500 WebP crops of
> `docs/site/img` shots.

## Diagrams

GitHub's Mermaid rendering is unreliable on github.com and absent in the GitHub mobile app, so docs never contain
` ```mermaid ` blocks (CI fails on them). Instead:

1. Write the source in `docs/diagrams/<name>.mmd` (Mermaid; quote every label, use `<br/>` for line breaks, prefer
   `flowchart TD` so it stays narrow enough for a phone, at most ~900 px wide).
2. Run `npm run docs:diagrams` (or `npm run docs:diagrams -- <name> --grid /tmp/grid.png` to render one and check it).
   It renders `docs/diagrams/<name>.svg` with Mermaid in headless Chrome: pure SVG text (no `foreignObject`, works
   inside `<img>` on iOS and in the GitHub app), system fonts only, Constellation colours on a white card that reads
   in dark mode. Needs Chrome (`CHROME_PATH`) and npm; Mermaid itself is fetched into a temp directory and checked
   against a pinned hash, it is not a project dependency.
3. Embed it centred with a meaningful `alt`, at most 720 px wide, followed by a collapsed text version:

   ```html
   <p align="center"><img src="diagrams/install-flow.svg" alt="Install flow: …" width="320"></p>

   <details><summary>Diagram as text</summary>

   1. First step.
   2. Second step.

   </details>
   ```

Each SVG stores the hash of its source (`<!-- src-sha256: … -->`); `scripts/ci-checks.mjs` fails when a source changed
without re-rendering, when an SVG has no source, or when a ` ```mermaid ` block is back.

---
**Next:** [How it works](architecture.md) · [Docs index](README.md)
