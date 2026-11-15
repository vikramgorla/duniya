# Plan 046

- `src/core/providers/chatgpt.js`: `parseCallback()` (pure, bounded input, max two nested levels); `completeSignIn`
  checks for a code before consuming the state.
- `src/panel/routes/google.js`: `originOf`, `requestHost` (strict host regex), `panelAddresses` (PUBLIC_URL + web
  config + switch), `redirectUriFor`, `addressProblem`, `addressHelpPage` (escaped HTML, inline copy script, CSP as
  other result pages). `src/core/google-signin.js`: pending keeps `startHost`; errors carry `reason`.
- `src/panel/routes/web.js`: `/api/web` adds `google` (on, only, callbackPath, consoleUrl, addresses).
- Panel: Google card lists every address; web access callout; dialogs; ChatGPT hint.
- No new dependencies; no memory impact (small server: n/a).
- Admin OAuth (AI assistants) keeps PUBLIC_URL as issuer: both addresses answer and the client follows the metadata;
  MCP tool-service OAuth already uses the address the panel is on.
