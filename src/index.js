// @ts-check
// The entry point (what systemd, Docker and `npm start` run). It guards the start after an update (095) and then
// loads the app (app.js). Nothing of the app is imported before the guard, and the guard is loaded inside try/catch:
// a release whose own code cannot start still gets here, and a broken guard never keeps a release from starting.
let holds = () => {};
try {
  const { guardStart } = await import('./core/update-guard.js');
  holds = guardStart();
} catch (e) { console.error(`Update guard: not active (${e?.message || e})`); }
await import('./app.js'); // returns when the app has started; a release that throws while starting ends here
holds();
