// The panel's entry module (063): page-wide listeners, then sign-in (which boots the shell). Screens load on first
// visit (core.js#show); see docs/development.md#panel-modules.
import { $, S, connectEvents, openFind, refreshStatus, show } from './core.js';
import { renderLogin } from './login.js';
document.addEventListener('visibilitychange', () => {
  // Back from the background (phones suspend the live stream): reconnect at once instead of waiting for its retry.
  if (document.visibilityState === 'visible' && S.user && S.es && S.es.readyState !== EventSource.OPEN) { connectEvents(); refreshStatus(); }
});
document.addEventListener('keydown', (e) => {
  if (!S.user || $('#palette')) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) { e.preventDefault(); openFind(); }
});
window.addEventListener('hashchange', () => { if (S.user) show(location.hash.slice(1).split('/')[0] || 'overview'); });
// Leaving the page closes the live stream, so a page kept in the back/forward cache holds no connection; coming back
// opens it again and catches up (058).
window.addEventListener('pagehide', () => { S.es?.close(); S.es = null; });
window.addEventListener('pageshow', (e) => { if (e.persisted && S.user) { connectEvents(); refreshStatus(); } });
renderLogin();
