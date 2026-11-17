// The panel's entry module (063): page-wide listeners, then sign-in (which boots the shell). Screens load on first
// visit (core.js#show); see docs/development.md#panel-modules.
import { $, S, connectEvents, openFind, recover, refreshStatus, show } from './core.js';
import './pull.js';
import { renderLogin } from './login.js';
// Back from the background (phones suspend the live stream and may leave requests hanging): after more than 30 s away,
// drop what is still waiting, reconnect and draw the screen again (066); after a short break, only reconnect if needed.
let hiddenAt = 0;
const back = () => {
  if (!S.user) return;
  const away = hiddenAt && Date.now() - hiddenAt > 30000; hiddenAt = 0;
  if (away) recover();
  else if (!S.es || S.es.readyState === EventSource.CLOSED) { connectEvents(); refreshStatus(); }
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') hiddenAt = Date.now(); else back(); });
document.addEventListener('keydown', (e) => {
  if (!S.user || $('#palette')) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) { e.preventDefault(); openFind(); }
});
window.addEventListener('hashchange', () => { if (S.user) show(location.hash.slice(1).split('/')[0] || 'overview'); });
// Leaving the page closes the live stream, so a page kept in the back/forward cache holds no connection; coming back
// opens it again and catches up (058).
window.addEventListener('pagehide', () => { S.es?.close(); S.es = null; hiddenAt ||= Date.now(); });
window.addEventListener('pageshow', (e) => { if (e.persisted || !S.es) back(); }); // 066: also when the stream was closed without the back/forward cache
renderLogin();
