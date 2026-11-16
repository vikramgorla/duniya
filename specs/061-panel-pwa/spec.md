# Feature Specification: 061 remove the mobile app; the panel is the phone app

**Issue**: #123 · **Status**: implemented · **Version**: 2.22.0

## Why

The Expo app (027) stayed a preview in Expo Go. The owner is the only user and does not use it, but it costs a second
package tree with its own CI and Dependabot noise, a built-in OAuth client with custom-scheme redirects, Bearer access
to every panel API route, a Settings card with an Expo link and QR codes, and docs. Everything it showed is already in
the panel, which is built for phones. What the app added was a home-screen icon and a full-screen window.

## User stories

1. **One app** — the owner opens the panel on the phone and adds it to the home screen; it opens full screen with the
   Duniya icon, live status, Ask and confirmations. No store, no Expo Go, nothing to keep up to date.
2. **Install hint** — on a phone or tablet that has not installed it, Overview shows *Install on your phone*: an
   **Install** button where the browser offers one (Chrome, Edge, Samsung), else the steps (iPhone: Share → Add to
   Home Screen; others: browser menu → Install app). **Hide** removes it on that device.
3. **Feels like an app** — no zoom when tapping a field, the header and sides keep clear of notches, the live stream
   reconnects at once when the phone wakes the app.
4. **Nothing left behind** — no Settings → Mobile app card, no `/api/mobile`, no app sign-ins under Connected AI
   assistants, no mention of the app or Expo in docs, website, templates or the Definition of Done.

## Requirements

- FR-1 Delete `mobile/`, `.github/workflows/mobile.yml`, `src/panel/routes/mobile.js`, `src/panel/public/qr.js` (only
  the app card drew QR codes), `test/mobile-app.test.js`, `docs/mobile-app.md`, the `npm run mobile` script.
- FR-2 The panel API takes the session cookie only: no Bearer tokens, no `bearer` route option, no
  `/.well-known/oauth-protected-resource/api`. The admin MCP OAuth (AI assistants, resource `/mcp`) is unchanged;
  its tokens are refused by `/api/*` (401). Registration keeps accepting https and loopback http redirects only.
- FR-3 2.22.0 deletes the `duniya-mobile` client, its grants and tokens and the `mobile` setting once at start; the
  cleanup is removed in the next release.
- FR-4 `manifest.webmanifest` (id, name, short_name, description, start_url, scope `/`, standalone, colours from the
  light theme) with icons 192/512 (`any`) and 512 `maskable`, rendered from the master mark; `apple-touch-icon` 180;
  `mobile-web-app-capable`, `apple-mobile-web-app-*` tags; theme-color for light and dark. Served from memory like
  `diff.js` (ETag, brotli/gzip, `?v=` links in the shell, immutable when pinned).
- FR-5 No service worker: current Chrome, Edge and Safari install without one, and no panel data is cached on the
  phone. SSE and ETag caching are untouched.
- FR-6 Install hint: phones and tablets (`pointer: coarse`), not when running installed (`display-mode: standalone`,
  `navigator.standalone`), not after **Hide** or install (`localStorage`); `beforeinstallprompt` → Install button.
- FR-7 Phones: form fields 16 px; `env(safe-area-inset-*)` on header and sides; no overscroll bounce when installed;
  `visibilitychange` → reconnect the live stream if it is not open (an event, no timer).

## Out of scope

Push notifications (alerts come in WhatsApp from the owner assistant), offline mode, a bottom tab bar.
