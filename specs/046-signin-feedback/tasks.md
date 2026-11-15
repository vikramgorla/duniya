# Tasks

- [X] T001 Remove 1.x upgrade guidance (upgrading, README, SECURITY, docs index, releases.json action text, backup message)
- [X] T002 Forgiving ChatGPT paste parser + panel hint + docs/models.md tip; tests (`test/providers.test.js`)
- [X] T003 Google origins without slash; every address in the setup card; tests
- [X] T004 Redirect URI per known panel address, stored with the state; tests (`test/google-domain.test.js`)
- [X] T005 Web access callout + dialogs; `/api/web` google info; tests
- [X] T006 Help page on the callback (other address, mismatch, missing cookie, Google-only); tests
- [X] T007 Docs: new `docs/google-sign-in.md`, index, domains-and-access, architecture, upgrading row
- [X] T008 Responsive states `settings-web-google`, `google-address-help` (runner supports `path`)
- [X] T009 Version 2.9.6 + releases.json entry
- [X] T010 `npm test`, `npm run lint`, `npm run check:panel`, ci-checks, `npm run check:responsive`
- [ ] T011 PR via REST (`Closes #77`), squash-merge after checks (left to the maintainer)

## Follow-ups

- Site screenshots not retaken: the website shows ChatGPT connected and the web access card without a switch, and
  has no Google setup shot, so no visible change.
