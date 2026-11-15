# Research: Native Mobile App

## R1. Framework and distribution — Expo (React Native), Expo Go first

- **Decision**: Expo SDK 58 (current stable, npm `expo@58.0.25`, React Native 0.88), TypeScript, expo-router. Preview
  through Expo Go (QR code), store builds later with EAS (`eas.json` prepared).
- **Rationale**: owner decision in issue #3; one codebase for iOS and Android; Expo Go needs no Apple/Google accounts.
- **Constraints found**:
  - Expo Go supports one SDK at a time; the SDK 58 Expo Go was announced to reach the stores a few weeks after the SDK
    ([SDK 58 changelog](https://expo.dev/changelog/sdk-58)). The README tells users which Expo Go they need.
  - Expo Go only contains its bundled native modules; every library used here is an Expo module or bundled
    (react-native-svg, netinfo), so no development build is needed (mobile/AGENTS.md rules).
  - SDK 58 router changes respected: only screens declared in the layout appear, `Stack.Protected` with `redirectTo`
    for auth gating, `useRouter()` preferred, iOS 26+ transparent headers → `contentInsetAdjustmentBehavior="automatic"`
    ([router migration 57→58](https://docs.expo.dev/router/migrate/sdk-57-to-58/)).
  - React Native's strict TypeScript API is the default since 0.87; no deep imports used.

## R2. Sign-in — OAuth 2.1 code + PKCE with the server's own authorization server

- **Decision**: built-in public client `duniya-mobile`; authorization in the system browser via `expo-auth-session`
  (`AuthRequest` + `promptAsync`, `usePKCE: true`, `extraParams.resource`), code exchanged by the app itself with the
  verifier (no client secret). Redirect `duniya://oauth` in builds; `makeRedirectUri({ scheme: 'duniya', path: 'oauth' })`
  yields `exp://<host>:<port>/--/oauth` in Expo Go.
- **Rationale**: RFC 8252 (OAuth 2.0 for Native Apps, BCP 212) recommends the external user-agent (system browser),
  public clients with PKCE, and allows private-use URI scheme redirects
  ([RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252)). Expo's guide recommends code + PKCE and exchanging the
  code in the app when no client secret is needed ([Expo authentication guide](https://docs.expo.dev/guides/authentication/)).
- **Expo Go caveat**: Expo's guide says Expo Go cannot be used for OAuth development with third-party providers
  (their redirect lists cannot contain Expo Go's changing `exp://` address). Our server is its own provider and accepts
  the Expo Go pattern for this one client, so the flow is expected to work in Expo Go — **to be confirmed on a real
  device** (open item).
- **Resource indicators**: tokens are audience-restricted with the `resource` parameter (RFC 8707), as the admin MCP
  already does for `/mcp`; the app uses a second resource `<base>/api` so assistant tokens and phone tokens cannot be
  swapped.
- **Alternatives rejected**: username/password in the app (the app would handle the password and Google-only accounts
  could not sign in); long-lived API keys (no rotation, no per-device revoke); dynamic client registration per phone
  (custom schemes would have to be opened to unauthenticated registration).

## R3. Token storage and lock

- **Decision**: `expo-secure-store` (Keychain on iOS, Keystore-backed on Android), `WHEN_UNLOCKED_THIS_DEVICE_ONLY`;
  optional `expo-local-authentication` lock on start and after 2 minutes in the background
  ([SecureStore SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/securestore.md),
  [LocalAuthentication](https://docs.expo.dev/versions/latest/sdk/local-authentication)).
- **Finding**: Face ID is not supported in Expo Go; without the Face ID usage description iOS uses the passcode. The
  app says so under App settings when running in Expo Go; store builds include `faceIDPermission`.

## R4. Connecting by QR

- **Decision**: the panel draws QR codes itself (`qr.js`, verified module-for-module against the `qrcode` package in
  tests, and decoded with OpenCV during development). Content: `duniya://connect?server=<base>`. The app scans with
  `expo-camera` (`barcodeScannerSettings: { barcodeTypes: ['qr'] }`), which works inside Expo Go; store builds also open
  the link from the phone camera via the `duniya` scheme. The scanner also accepts a plain https panel address.

## R5. CORS

- **Decision**: none added. Native `fetch` is not subject to CORS; the web export is used only for screenshots with
  demo data. `/.well-known/oauth-protected-resource/api` joins the existing CORS list of OAuth metadata.

## R6. Screens and design

- Native components styled with Constellation tokens (`mobile/src/lib/theme.ts` mirrors the panel's CSS variables;
  dark mode turns lime into the primary colour). Icons reuse the panel's tab-bar paths via react-native-svg. The logo
  is the panel's `logo()` geometry.
