// @ts-check
import { loadAgents, listAgents } from './core/agents.js';
import { modulesIdle, startModules } from './modules/index.js';
import { createHub } from './channels/hub.js';
import { createRouter, createHistoryHandler, createJoinHandler, createChatMoveHandler, closeRouter } from './core/router.js';
import { startScheduler } from './core/scheduler.js';
import { startPanel } from './panel/server.js';
import { providerRoutes } from './panel/routes/providers.js';
import { backupRoutes } from './panel/routes/backups.js';
import { startBackupScheduler } from './core/backup/index.js';
import { updateRoutes } from './panel/routes/updates.js';
import { startUpdateScheduler } from './core/update-decision.js';
import { activity } from './core/events.js';
import { startMetrics } from './core/system.js';
import { startRuntimeFile } from './core/runtime.js';
import { startWebAccess } from './core/webaccess.js';
import { startResourceWatch, serverSize } from './core/resources.js';
import { createMemberTagHandler } from './core/member-tags.js';
import { historyPhoneOnline, resumeHistoryRetries } from './core/history-load.js';
import { markGroupDue } from './core/upkeep.js';
import { stopQueue } from './core/media-queue.js';
import { db } from './core/db.js';
import { DATA_DIR } from './core/config.js';
import { takeRestoreResult } from './core/restore-apply.js';

await loadAgents();
await startModules(); // 081: the modules that are switched on (import() only then)
{ const s = serverSize(); console.log(`Server: ${s.size} (${s.effectiveMb} MB RAM${s.cgroupLimitMb ? ' container limit' : ''}, ${s.cpus} CPU)`); }
startResourceWatch();
console.log(`Agents: ${listAgents().map((b) => `${b.id}${b.enabled ? '' : ' (disabled)'}`).join(', ') || 'none'}`);

// 075: the channel hub loads a channel (WhatsApp: Baileys; 077: Telegram) only when it is set up and on
const channels = createHub();
const panel = startPanel({ channel: channels, extend: [providerRoutes, backupRoutes, updateRoutes] });
const router = createRouter(channels); // sets the history channel before retries resume
resumeHistoryRetries(); // 057: history loads the phone did not answer retry by themselves, also after a restart
await channels.start({ onMessage: router, onHistory: createHistoryHandler(), onJoin: createJoinHandler(channels),
  onMemberTag: createMemberTagHandler(), onPhoneActive: () => historyPhoneOnline(), onGroupChange: (ev) => markGroupDue(ev.chat), onChatMoved: createChatMoveHandler() });
startScheduler(channels);
startBackupScheduler();
startUpdateScheduler();
startMetrics();
startRuntimeFile(channels);
startWebAccess();
activity('system', { summary: 'Started' });
// A restore applied at this start (before the database opened) is recorded in the restored data, where it shows.
{ const r = takeRestoreResult(DATA_DIR);
  if (r?.ok) activity('backup.restore', { summary: `Restored the backup ${r.source} (${r.files} files). The data from before is kept on the server in ${r.keep}.` });
  else if (r) activity('error', { summary: `A restore was prepared but could not be applied (${r.error}); nothing was changed. Start it again under Backups.` }); }

// 069: graceful shutdown (systemd stop/restart, updates): no new messages or jobs, running turns get a few seconds,
// channel connections close (WhatsApp stays linked), the database is checkpointed and closed. A crash (uncaught exception)
// goes the same way with exit code 1, and systemd (Restart=always) or Docker (restart: unless-stopped) starts it again.
let stopping = false;
async function shutdown(why, code = 0) {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(code), 10000).unref(); // never hang a stop
  try { activity(code ? 'error' : 'system', { summary: `Stopping (${why})` }); } catch { /* the database may be the problem */ }
  panel.close();
  stopQueue();
  const finished = await closeRouter(6000);
  await modulesIdle(); // a list message on its way goes out (cut off, it would be marked failed and never sent again)
  if (!finished) console.error('Stopping with turns still running');
  await channels.stop().catch(() => {});
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* already closed */ }
  process.exit(code);
}
process.on('unhandledRejection', (e) => {
  console.error('Unhandled:', e);
  try { activity('error', { summary: `Unhandled: ${e instanceof Error ? e.message : e}` }); } catch { /* logging must never crash the app (the database may be the problem) */ }
});
process.on('uncaughtException', (e) => { console.error('Fatal:', e); shutdown(`fatal: ${e?.message || e}`, 1); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
