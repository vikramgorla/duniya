# Requirements Checklist: Native Mobile App

## Specification quality

- [X] User stories are prioritised and independently testable
- [X] Requirements are testable and unambiguous; edge cases listed
- [X] Success criteria are measurable
- [X] No implementation detail leaks into user-facing wording ("agents", "Waiting for you", plain-language errors)

## Security

- [X] Public client with PKCE S256; no client secret in the app
- [X] Redirects limited to `duniya://oauth` and the Expo Go `/--/oauth` pattern; DCR still https/loopback only
- [X] Tokens audience-bound (`<base>/api` vs `/mcp`) and tested both ways
- [X] Same role gates for Bearer and session; role changes and disabled users apply on the next call (tested)
- [X] Invalid Bearer never falls back to the cookie; session-only routes refuse tokens; no CORS on `/api`
- [X] Tokens hashed on the server; secure storage on the phone; revoke on sign-out; panel can sign phones out
- [X] Consent CSP lists only the redirect's scheme

## Experience (DESIGN.md checklist)

- [X] A non-technical person knows what each screen is for and what to do next (panel card: 3 steps; Connect: scan or type)
- [X] One clear state per thing; no ids where names exist (chat/agent names resolved)
- [X] Long actions show progress and survive leaving the screen (update follows the restart; AI draft "Thinking…")
- [X] Destructive actions confirm with the consequence (pause all, update, cancel change, sign out)
- [X] Light and dark mode on a phone and an iPad (screenshots from the web export)
- [X] No flicker on refresh (data replaced in place, last data kept while loading)
- [ ] Checked on a real iPhone and Android phone in Expo Go (needs the owner's devices)

## Lean server

- [X] `mobile/` has its own package.json; root `npm ci` unaffected; `.dockerignore` excludes it; install.sh unchanged
