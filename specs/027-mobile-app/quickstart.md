# Quickstart: Mobile App

## Server

```bash
npm test                                   # includes test/mobile-app.test.js
node --test test/mobile-app.test.js        # only the mobile tests
```

Manual: open the panel → **Settings → Mobile app**. Without `PUBLIC_URL`/https a warning explains that phones need
the public https address. Owners can paste an Expo link; the QR codes are drawn in the browser.

## App (Expo Go)

```bash
npm run mobile                             # repo root: install mobile/ and npx expo start
```

1. Install Expo Go (SDK 58) on the phone, scan the terminal QR (iPhone Camera / Expo Go on Android).
2. In the app: **Scan the panel’s QR code** (Settings → Mobile app → step 3), sign in, **Approve**.
3. Check: Overview LEDs match the panel; switch an agent off and see it in the panel; pull to refresh; turn on
   airplane mode and see the offline banner with the last data.
4. Panel → Settings → Mobile app → **Sign out** the phone: the app returns to Connect on the next request.

No server: **Look around with demo data**.

## App checks (CI: `.github/workflows/mobile.yml`)

```bash
cd mobile && npm ci && npm run typecheck && npm run lint && npm test
EXPO_PUBLIC_DEMO=1 npx expo export --platform web   # web build with demo data, for screenshots
```

Screenshots: [screenshots/](screenshots/) — app in light and dark (12 screens), iPad overview, panel card; AI review diff (light, dark) and the streaming Ask box (#63, #66).
