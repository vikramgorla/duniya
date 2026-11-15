# Feature Specification: Native Mobile App (iOS and Android)

**Feature Branch**: `feat/i3-mobile-app` (issue #3)

**Created**: 2026-11-15

**Status**: Implemented (preview via Expo Go; store builds later)

**Input**: Owner: "A native app for owners/admins to run Duniya from the phone." Decisions (issue #3): React Native
with Expo, one codebase for iOS and Android; distribution through Expo Go first (QR code), store builds later. Sign-in
with the existing OAuth authorization server (spec 017); tokens for the app are bound to `https://HOST/api` and accepted
as Bearer on `/api/*` with the user's panel role. The product calls bots "agents".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a phone to the server (Priority: P1)

An owner opens **Settings → Mobile app** in the panel. Step 1 links to Expo Go in the App Store and Google Play. Step 2
shows a QR code that opens the Duniya app in Expo Go (the "Expo link" the owner pasted from `npx expo start` or
`eas update`). Step 3 shows a QR code with this server's address. In the app the owner taps **Scan the panel's QR
code** (or types the address), the panel's sign-in page opens in the system browser, the owner signs in, reads what
the app may do as their role, and taps **Approve**. The app opens on the Overview.

**Why this priority**: nothing else works without the connection.

**Independent Test**: authorize the built-in client `duniya-mobile` with `redirect_uri=duniya://oauth` (and an Expo Go
`exp://…/--/oauth`) and `resource=<base>/api`, approve, exchange the code with the PKCE verifier, call `/api/status`.

**Acceptance Scenarios**:

1. **Given** a panel session, **When** the app's authorization link opens, **Then** a phone-specific consent page shows
   the account, role and abilities; Approve redirects to `duniya://oauth?code=…&state=…&iss=…`.
2. **Given** a redirect other than `duniya://oauth` or `exp(s)://<host>[:port][/path]/--/oauth`, **Then** the page shows
   an error and never redirects.
3. **Given** the app asks for any resource other than `<base>/api` (e.g. `/mcp`), **Then** it gets `invalid_target`;
   AI assistants (dynamically registered clients) cannot get `/api` tokens, and still cannot register custom schemes.
4. **Given** a server older than this feature, **Then** the app says the server must be updated first.
5. **Given** a plain-http address outside the local network, **Then** the app warns that the sign-in would travel
   unencrypted.

### User Story 2 - See the state at a glance (Priority: P1)

The Overview is the status console: one sentence ("Everything is running", "A WhatsApp number needs attention", "All
agents are paused", …), LEDs for WhatsApp, Agents and Waiting, the WhatsApp numbers with their state, live agents, and
a button to review waiting changes. Admins can pause all agents (with a confirmation that states the consequence).

**Acceptance**: same headline rules as the panel; refresh every 10 s while open and on pull; viewers see the pause switch
disabled with a reason.

### User Story 3 - Run agents and chats from the phone (Priority: P1)

**Agents**: list with on/off switch; detail with on/off, basics (name, description, instructions, triggers) editable
by admins, tool services and per-role tool rules, organizers, direct-message policy, memory and scheduled posts
(read-only), and **Change with AI** (describe a change; `/api/ai/bot-draft` proposes it; every change is shown before
**Apply**). **Chats**: filters (all, groups, direct, with agent, without), search, detail to assign an agent or none
(off), set the chat's model, and (admins) read the last 50 stored messages — each look is recorded in Activity.

**Acceptance**: viewers can read but every control that changes something is disabled and says why; the server's
403 is shown if the role changed meanwhile.

### User Story 4 - Activity, usage, server, waiting changes (Priority: P2)

Activity feed (filters: all, messages, changes, problems; load older). Usage: totals for today / 7 / 30 / 90 days, by
agent and by model, with cost. Server: CPU, memory, swap, disk meters; owners see the update status and **Update to
vX** with progress that follows the restart until the server answers with the new version. Waiting for you: each
prepared change with code, agent, chat, requester and time left; admins Apply or Cancel (confirmations state the
consequence).

### User Story 5 - Phone security (Priority: P2)

Tokens are stored in the phone's secure storage; the access token (1 h) is refreshed automatically with rotating
refresh tokens; an optional Face ID / fingerprint lock asks on start and after 2 minutes in the background. Sign out in
the app revokes the refresh token; the panel lists signed-in phones under Settings → Mobile app with **Sign out**
(revokes the grant and its tokens immediately).

### Edge Cases

- Offline or server unreachable: a banner says so and the last loaded data stays visible.
- Token refused on refresh (revoked, user disabled, refresh reused): the app returns to Connect with "Your sign-in
  ended. Sign in again."
- A role change in the panel applies to the next request; a disabled user's token stops working at once.
- Session cookie and Bearer token both sent: only the token counts (an invalid token is never rescued by a cookie).
- Session-only routes (password change, raw uploads) refuse Bearer tokens with "Do this in the web panel".
- No server yet: "Look around with demo data" shows the whole app with made-up data, nothing leaves the phone.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The authorization server MUST have a built-in public client `duniya-mobile` (name "Duniya mobile app")
  that accepts the redirect `duniya://oauth` and Expo Go redirects `exp(s)://<host>[:port][/path]/--/oauth`; PKCE S256
  is required as for every client; dynamic registration stays limited to https / loopback redirects.
- **FR-002**: Tokens for `duniya-mobile` MUST be bound to the resource `<base>/api` and only to it; other clients MUST
  NOT obtain `<base>/api` tokens. `/.well-known/oauth-protected-resource/api` describes the resource.
- **FR-003**: `/api/*` routes MUST accept `Authorization: Bearer <token>` for `<base>/api`, acting as the approving
  user with that user's current role and the same role gates as the session; invalid tokens get 401 with
  `WWW-Authenticate: Bearer resource_metadata=…, error="invalid_token"`; 300 requests per minute per token.
- **FR-004**: Session-cookie authentication, the JSON-only CSRF guard and the CSP MUST stay unchanged; no CORS is added
  to `/api/*`.
- **FR-005**: The consent page for the app MUST show account, role and abilities and list the custom scheme in CSP
  `form-action` so the post-approval redirect is allowed.
- **FR-006**: The panel MUST show Settings → Mobile app: install links, an optional Expo link (owner-only, validated:
  `exp://`, `exps://`, `https://*.expo.dev|io`) rendered as a QR code, a connect QR code
  (`duniya://connect?server=<base>`) and the address with Copy; QR codes are drawn in the browser (no external
  service); signed-in phones with Sign out. Phones are not listed among AI assistants.
- **FR-007**: The app MUST be a native React Native/Expo app (no web view) in `mobile/`, TypeScript, expo-router, with
  the screens of User Stories 1–5, pull-to-refresh, offline banner, light and dark mode, the Constellation design and
  the people-circle logo.
- **FR-008**: `mobile/` MUST NOT be installed by the server (`npm ci` at the root, Docker image, install.sh).
- **FR-009**: CI MUST typecheck, lint and unit-test the app (`.github/workflows/mobile.yml`); `eas.json` MUST be
  prepared for development, preview and production builds.

### Key Entities

- **Mobile client**: row `duniya-mobile` in `admin_oauth_clients` (seeded at start).
- **Grant / tokens**: as in spec 017; tokens of the mobile client carry `resource = <base>/api`.
- **Setting** `mobile.expoUrl`: optional Expo link shown in the panel.

## Success Criteria *(mandatory)*

- **SC-001**: From the panel card to a signed-in Overview in under 2 minutes with Expo Go installed.
- **SC-002**: Every role gate that applies to the session applies identically to the app's token (tests).
- **SC-003**: All existing server tests still pass; new tests cover bearer access, role gates, resource binding,
  redirects, revocation and the QR encoder.
- **SC-004**: App screens pass the DESIGN.md checklist in light and dark mode on a phone and an iPad (screenshots).
