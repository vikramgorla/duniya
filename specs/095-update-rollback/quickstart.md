# Quickstart: 095 update rollback

## Automated

```bash
node --test test/update-rollback.test.js   # guard, note, result, status, automatic round, real entry point
npm test
```

## By hand, on a test server (installer, systemd)

1. Make a release that cannot start: on a fork, tag a version whose `src/app.js` starts with `throw new Error('no')`.
2. Point the server at the fork (`sudo duniya source <owner>/<name>`), then **Update**.
3. Watch `sudo duniya logs -f`: `Update guard: start 1 of 3 after the update to v…` three times, each followed by the
   crash; then `Update guard: v… did not start 3 times: putting v… back` and `… is back and starts next`; the previous
   version starts.
4. The panel is back within about a minute. Overview → Updates shows that the version did not start and was rolled
   back; Activity has one line; the owner alert arrives on WhatsApp.
5. Leave automatic updates on: the next round does not install that version; tag a newer, working one: it is installed.

## Never

Do not write a note with `starts: 3` into the data directory of a development checkout that runs with
`DUNIYA_INSTALL=systemd`: the guard would check out the noted commit there.
