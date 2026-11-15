# Implementation Plan: Native Mobile App

**Branch**: `feat/i3-mobile-app` | **Spec**: [spec.md](spec.md) | **Issue**: #3

## Summary

Server: reuse the admin OAuth server (017) for the phone. A built-in public client `duniya-mobile` with the
private-use scheme redirect `duniya://oauth` (plus Expo Go's `exp://…/--/oauth` during the preview); its tokens are
bound to a second resource, `<base>/api`. The panel router resolves the caller from either the session cookie or a
Bearer token for `<base>/api` (`requestUser()` in `src/panel/server.js`) and then applies the unchanged role gates.
Panel: a Settings card with QR codes drawn by a small in-browser encoder (`src/panel/public/qr.js`) and a tiny route
module (`src/panel/routes/mobile.js`).

App: Expo SDK 58 (React Native 0.88, React 19.3), TypeScript, expo-router (file routes in `mobile/src/app`), native
components only. A pure API core (`src/lib/api-core.ts`: discovery, code exchange, refresh with single-flight, Bearer
calls) with unit tests; `auth.tsx` adds expo-auth-session (PKCE in the system browser), expo-secure-store and
expo-local-authentication; `useData` gives focus-loading, polling, pull-to-refresh and last-good data offline.

## Technical Context

- **Server**: Node 22 ESM, no new dependencies. **App**: Expo modules that ship in Expo Go only (expo-router,
  expo-auth-session, expo-crypto, expo-web-browser, expo-secure-store, expo-local-authentication, expo-camera,
  expo-haptics, react-native-svg, @react-native-community/netinfo), so Expo Go keeps working.
- **Testing**: server e2e `test/mobile-app.test.js` (node:test + harness); app unit tests `mobile/src/lib/lib.test.ts`
  (node --test with type stripping), `tsc --noEmit`, `expo lint`; screenshots from the Expo web export in demo mode
  rendered with headless Chrome.
- **Constraints**: server RSS unchanged (no new long-lived state); `mobile/` excluded from server installs.

## Constitution Check

- **I/II**: no WhatsApp change; nothing bot-specific in core; the app is a client of the generic API. ✔
- **III Least privilege**: the token acts as the approving user with the current role; every route's role gate applies;
  session-only routes refuse tokens; separate resources keep assistant tokens (`/mcp`) and app tokens (`/api`) apart. ✔
- **IV Human confirmation**: the app applies waiting changes only through the existing `/api/pending/:code/apply`
  (admin), with a confirmation dialog; AI drafts are shown before Apply. ✔
- **V Observable**: sign-ins (`config`), panel logins from the consent page, stored-message views, all changes go
  through the same routes and are logged as before. ✔
- **VI Free tier**: no server dependency or process added; `mobile/` is not installed on the VM. ✔
- **VII Spec + tests**: this folder; 9 new e2e tests; app unit tests and typecheck in CI. ✔
- **VIII Experience first**: three-step card in the panel, scan-to-connect, plain-language states, confirmations with
  consequences, update progress that survives the restart; checked in light/dark, phone and iPad. ✔
- **Security constraints**: secrets never returned; tokens hashed server-side, in Keychain/Keystore on the phone;
  CSP unchanged for the panel, consent CSP extended only by the redirect's scheme. ✔
- **Stack rule (new runtime dependencies)**: none on the server. The app's dependencies live only in `mobile/`.

## Complexity Tracking

| Item | Why | Simpler alternative rejected |
| --- | --- | --- |
| Pattern-matched Expo Go redirect (`exp://*/--/oauth`) | Expo Go's redirect contains the developer's LAN IP / tunnel host, unknown in advance | Exact redirect list: would need a server change per developer machine |
| Own QR encoder in the panel (~170 lines) | "Generate client-side, no external service"; the `qrcode` package has no browser build and the panel has no bundler | Server-side PNG: not client-side; external QR service: privacy |

## Project Structure

```text
src/core/admin-oauth.js        # + duniya-mobile client, redirectAllowed(), grants list kind
src/panel/admin-mcp.js         # + /api resource for the mobile client, phone consent, PRM for /api
src/panel/server.js            # + requestUser(): session or Bearer; /qr.js
src/panel/routes/mobile.js     # GET/PUT /api/mobile
src/panel/public/qr.js         # QR encoder (byte mode, v1–10, L/M/Q/H)
src/panel/public/index.html    # Settings → Mobile app card
test/mobile-app.test.js
mobile/                         # Expo app (own package.json, eas.json, README.md)
.github/workflows/mobile.yml
```
