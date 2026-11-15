# Tasks: Native Mobile App (issue #3)

## Phase 1 — Server

- [X] T001 Research Expo SDK 58, expo-router changes, expo-auth-session/PKCE, RFC 8252, secure storage (research.md)
- [X] T002 `src/core/admin-oauth.js`: seed client `duniya-mobile`, `redirectAllowed()` (exact + Expo Go pattern), exclude it from pruning, grants `kind`
- [X] T003 `src/panel/admin-mcp.js`: `<base>/api` resource for the mobile client only (`invalid_target` otherwise), phone consent page, CSP `form-action` with the scheme, `/.well-known/oauth-protected-resource/api`, activity wording
- [X] T004 `src/panel/server.js`: `requestUser()` (Bearer for `<base>/api` or session), 401 + `WWW-Authenticate`, `bearer: false` routes (password, raw uploads), 300/min per token; `/api/session` recognises tokens
- [X] T005 `src/panel/routes/mobile.js`: `GET/PUT /api/mobile` (Expo link validation, owner)
- [X] T006 `src/panel/public/qr.js` QR encoder; `/qr.js` route
- [X] T007 Settings card "Mobile app" (3 steps, QR codes, Expo link, signed-in phones, Sign out); phones hidden from the AI assistants list
- [X] T008 `test/mobile-app.test.js`: metadata, consent + CSP, Expo Go redirect, refused redirects, resource binding both ways, role gates, session unchanged, no CORS, refresh + sign-out, Expo link, QR encoder vs `qrcode`
- [X] T009 `.dockerignore` excludes `mobile`; root script `npm run mobile`

## Phase 2 — App

- [X] T010 Scaffold Expo SDK 58 TypeScript app in `mobile/` with expo-router, app.json (scheme `duniya`, plugins, permissions), tsconfig paths
- [X] T011 Pure modules with unit tests: `server-url.ts`, `format.ts`, `status.ts`, `api-core.ts` (discovery, exchange, single-flight refresh, sign-out on refusal)
- [X] T012 `auth.tsx`: sign-in with expo-auth-session + PKCE, secure storage, restore, sign-out with revoke, biometric lock (start + 2 min background), demo mode
- [X] T013 Constellation UI kit (`components/ui.tsx`), theme (light/dark), logo and icons (react-native-svg)
- [X] T014 Connect (address, insecure warning, demo), Scan (expo-camera), Lock, OAuth return
- [X] T015 Overview status console, pause all
- [X] T016 Agents list + detail (on/off, basics edit, tools, roles, schedules) + Change with AI
- [X] T017 Chats (filters, search) + detail (assign agent / off, model, stored messages)
- [X] T018 Activity (filters, load older), Usage (periods, by agent/model), Server (meters, update with progress), Waiting for you (apply/cancel), More, App settings
- [X] T019 Pull-to-refresh, offline banner with last data, polling where live
- [X] T020 App icons from the logo; `eas.json` (development / preview / production); `mobile/README.md`
- [X] T021 `.github/workflows/mobile.yml`: typecheck, lint, unit tests, config check
- [X] T022 `tsc --noEmit`, `expo lint`, `npm test` clean; screenshots (light/dark, phone/iPad, panel card) in `screenshots/`

## Open

- [ ] T023 Sign-in on a real iPhone and Android phone in Expo Go (confirm `exp://…/--/oauth` return through the system browser)
- [ ] T024 `eas init` with the owner's Expo account; publish a preview with `eas update`; paste the link in the panel
- [ ] T025 Store builds (TestFlight / Play internal) once Apple and Google developer accounts exist
