# Duniya mobile app (preview)

**State (v2.8):** preview, runs in Expo Go (SDK 58); store builds are prepared in `eas.json` but not published. The app
icon is the store-safe Duniya logo (no third-party marks). Everything the app does goes through the panel's API with
the signed-in user's role, so new server features appear here only when a screen is added for them.

Native iOS and Android app for owners and admins of a Duniya server: status console with the **Ask** box (the owner
assistant: questions about your chats, changes with Confirm; the answer streams in step by step through `expo/fetch`), agents (on/off, edit basics, "Change with AI"), chats
(assign agent, model, stored messages), activity, usage, server health and updates, and changes waiting for
confirmation. One codebase: React Native with [Expo](https://expo.dev) (SDK 58, TypeScript,
expo-router). Spec: [`specs/027-mobile-app`](../specs/027-mobile-app/spec.md).

This folder is **not** part of the server install: it has its own `package.json`, the server's `npm ci` never sees
it, and it is excluded from the Docker image (`.dockerignore`).

## Try it on your phone with Expo Go (no build, no store)

1. Install **Expo Go** on the phone: [App Store](https://apps.apple.com/app/expo-go/id982107779) ·
   [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent). Expo Go runs one SDK at a time;
   this app needs the Expo Go version for **SDK 58**.
2. On a computer with Node.js 22.13+ and this repository:

   ```bash
   npm run mobile            # from the repo root: installs mobile/ and runs `npx expo start`
   # or
   cd mobile && npm install && npx expo start
   ```

   A QR code appears in the terminal. **iPhone:** scan it with the Camera app. **Android:** open Expo Go → *Scan QR
   code*. The phone and the computer must be on the same Wi-Fi; otherwise use `npm run start:tunnel`.
3. In the app tap **Scan the panel’s QR code** and scan the code in your panel: **Settings → Mobile app → step 3**
   (or type the panel’s https address). Your panel’s sign-in page opens: sign in, check what the app may do, tap
   **Approve**.

No server yet? Tap *Look around with demo data* on the first screen.

### Share it without a computer running (EAS Update)

So that family admins can open the app any time from Expo Go:

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init                 # links the project to your Expo account (adds the project id to app.json)
npx eas-cli@latest update --channel preview --message "first preview"
```

The command prints an `exp://u.expo.dev/…` link. Paste it in the panel under **Settings → Mobile app → Expo link**:
the panel then shows it as a QR code in step 2 for everyone.

## How sign-in works

The server is its own OAuth 2.1 authorization server (spec 017). The app is the built-in public client
`duniya-mobile`: authorization code + PKCE (S256) in the system browser (`expo-auth-session`), redirect
`duniya://oauth` (builds) or `exp://<dev host>/--/oauth` (Expo Go). Tokens are bound to the resource
`https://<server>/api`, sent as `Authorization: Bearer`, and act as the panel user who approved them with that user’s
current role. They live in the phone’s secure storage (`expo-secure-store`: Keychain / Android Keystore); the
access token is refreshed automatically (refresh tokens rotate). Optional Face ID / fingerprint unlock
(`expo-local-authentication`). Sign a phone out from the app, or from the panel: Settings → Mobile app → Sign out.

## Development

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint (eslint-config-expo)
npm test              # unit tests for src/lib (node --test, type stripping)
npm run export:web    # web build with demo data (used for screenshots only; the app is native)
```

- Routes live in `src/app/` (expo-router); building blocks in `src/components/ui.tsx` follow `DESIGN.md`
  (Constellation: porcelain/ink, one lime signal, mono labels, LEDs). Logo: `src/components/Logo.tsx`.
- API client: `src/lib/api-core.ts` (pure, tested) and `src/lib/auth.tsx` (secure storage, sign-in).
- Add native libraries only with `npx expo install` and only ones included in Expo Go, or Expo Go stops working.
- Changing the app? Update this README and the panel's **Settings → Mobile app** text if the steps change, and follow
  the Definition of Done in [AGENTS.md](../AGENTS.md). CI runs typecheck, lint and tests (`.github/workflows/mobile.yml`).

## Store builds later (TestFlight / Play), prepared in `eas.json`

| Profile | What | Command |
| --- | --- | --- |
| `development` | Dev client for native debugging | `npx eas-cli@latest build --profile development --platform ios\|android` |
| `preview` | Internal install (Android APK, iOS ad hoc) | `npx eas-cli@latest build --profile preview --platform all` |
| `production` | Store binaries, auto-incremented build number | `npx eas-cli@latest build --profile production --platform all` |

Before the first store build: an Apple Developer account (99 USD/year) and a Google Play developer account (25 USD
once); check `ios.bundleIdentifier` / `android.package` in `app.json` (`com.vikramgorla.duniya`); set the App Store
Connect app id in `eas.json` → `submit.production.ios.ascAppId`; then `npx eas-cli@latest submit --profile production`.
Store builds also open the panel’s connect QR directly from the phone camera (`duniya://connect?server=…`).
