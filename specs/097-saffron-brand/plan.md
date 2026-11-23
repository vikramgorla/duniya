# Implementation Plan: Saffron brand

**Spec**: [spec.md](spec.md) · **Issue**: #305 · **Version**: 2.62.0 (minor)

## Technical approach
- Master mark traced from the chosen picture (potrace, dev-only, not committed as a dependency) into one white path on
  a saffron gradient tile, 1024 grid; small mark drawn by hand on a 64 grid.
- `src/panel/assets.js` serves `.svg` (`image/svg+xml`); `logo()` in `core.js` becomes an `<img>` of the file
  (small by default, full with `logo(true)`); favicon and consent pages point at the file.
- `scripts/render-icons.mjs` (`npm run brand:icons`): icon-192/512, apple-touch-icon (square), maskable-512 (robot at
  74 %), copies the marks to `docs/site/img`. `scripts/site-shots.mjs` draws `share.jpg`.
- Tokens: `styles.css`, `page.css`, `docs/site/style.css`, `infra/oci/bootstrap.sh`; README badges and
  `docs/img/btn-*.svg` use saffron-deep `#b23c00` with white text; diagrams' note/accent colour saffron-soft.
- `ci-checks.mjs` check 11 compares the marks.

## Definition of Done plan
| Item | Plan |
|---|---|
| Tests | existing suite (panel assets, icons served); no new behaviour beyond static files |
| Checks | test, lint, typecheck, check:panel (budgets lowered), check:clean, check:responsive (all six), ci-checks |
| Docs | DESIGN.md (Mark, Ink + one signal, states), docs/development.md (site:shots, brand:icons) |
| Website | marks, colours, all screenshots and videos retaken, share.jpg |
| Admin MCP | n/a: no new panel functionality |
| Small servers | n/a: static files only, cached immutable |
| Version | 2.62.0, releases.json entry |
