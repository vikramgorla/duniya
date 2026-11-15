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
| `npm test` | e2e tests with fakes |
| `npm run lint` | ESLint |
| `npm run check:panel` | the panel's inline script parses |
| `node scripts/ci-checks.mjs` | versions match, breaking-release entries, **doc links** (`scripts/check-doc-links.mjs`) |
| `node scripts/demo-panel.mjs` | seeded demo panel on :8099 (admin / demo-password-123), no network |
| `npm run check:responsive` | every screen at 375 / 393 / 1440 px, light + dark (needs Chrome) |
| `npm run site:shots` | retake the website screenshots and videos (needs Chrome + ffmpeg) |

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

## Releases

1. Bump the version in `package.json`, `package-lock.json` and `infra/oci/schema.yaml` (CI checks they match) and add
   an entry for it to `releases.json` (a one-line `title` is enough; CI fails without one).
2. Merge to `main` (or push a `vX.Y.Z` tag, or run the workflow by hand).
3. The release workflow creates the tag and GitHub release, attaches the OCI stack zip and publishes
   `ghcr.io/vikramgorla/whatsapp-agent-duniya`.

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
