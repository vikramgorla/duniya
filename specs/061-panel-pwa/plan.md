# Implementation Plan: 061 remove the mobile app; the panel is the phone app

**Issue**: #123 · **Spec**: [spec.md](spec.md) · **Version**: 2.22.0 (minor: the owner never used the app, so not breaking)

## Approach

- **Delete** the app tree, its workflow, route file, QR encoder, test and doc page; strip `admin-oauth.js`
  (built-in client, Expo Go redirect rule, `mobile` flag, grant `kind`), `admin-mcp.js` (`/api` resource metadata,
  app consent page, custom-scheme form targets) and `server.js` (`requestUser` → session only, `bearer` route flag,
  Bearer branch and its limiter); `links.js` / `owner-assistant.js` lose their `bearer: false` options.
- **Serve** `manifest.webmanifest` and `icons/*.png` through the existing `staticFile()` map (one map for scripts and
  assets; the shell rewrites `src`/`href` links to `?v=`).
- **Panel**: head tags; `drawInstallHint()` slot on Overview; `visibilitychange` reconnect; phone CSS (16 px fields,
  safe areas); Ask box uses the text font so the 16 px placeholder fits.
- **Icons** rendered from the app's master renders (porcelain 80 % and the 50 % adaptive foreground) before the
  folder was deleted.

## Definition of Done

| Item | This change |
|------|-------------|
| Issue & labels | #123, type: improvement, area: mobile / panel / security / docs, priority: medium, status: in progress, spec: 061 |
| Tests (fakes) | `panel-snappy` (manifest, icons and sizes, iOS tags, no service worker, versioned links, `qr.js` gone), `admin-mcp` (assistant tokens refused on `/api`, no `/api` resource, no app client or app redirects, no `/api/mobile`) |
| Checks | `npm test`, `npm run lint`, `npm run check:panel`, `npm run check:responsive` (+ `overview-install-steps`), `node scripts/ci-checks.mjs` |
| Security | smaller attack surface: the panel API accepts only the HttpOnly SameSite=Strict session; no custom-scheme redirects; CSP unchanged (manifest and icons are same-origin) |
| Privacy | nothing new stored; the hint flag is a local `localStorage` value |
| Small servers | ~85 KB of icons in memory; no timers; no service worker |
| Lean code | about 60 MB of app tree and ~700 lines of server/panel/test code removed |
| Admin MCP | n/a: no tool covered the app card; the hint is client-only |
| Docs | `docs/phone.md` replaces `docs/mobile-app.md`; docs index (+ thumbnail), README, website, SECURITY, DESIGN, AGENTS, CONTRIBUTING, constitution, templates, PR template, overview diagram |
| Version | 2.22.0 in `package.json`, `package-lock.json`, `infra/oci/schema.yaml`; `releases.json` entry |
