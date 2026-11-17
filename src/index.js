// @ts-check
import { loadAgents, listAgents } from './core/agents.js';
import { createChannelRegistry } from './channels/registry.js';
import { createRouter, createHistoryHandler, createJoinHandler, closeRouter } from './core/router.js';
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

await loadAgents();
{ const s = serverSize(); console.log(`Server: ${s.size} (${s.effectiveMb} MB RAM${s.cgroupLimitMb ? ' container limit' : ''}, ${s.cpus} CPU)`); }
startResourceWatch();
console.log(`Agents: ${listAgents().map((b) => `${b.id}${b.enabled ? '' : ' (disabled)'}`).join(', ') || 'none'}`);

const whatsapp = createChannelRegistry();
const panel = startPanel({ channel: whatsapp, extend: [providerRoutes, backupRoutes, updateRoutes] });
const router = createRouter(whatsapp); // sets the history channel before retries resume
resumeHistoryRetries(); // 057: history loads the phone did not answer retry by themselves, also after a restart
await whatsapp.start(router, { onHistory: createHistoryHandler(), onJoin: createJoinHandler(whatsapp),
  onMemberTag: createMemberTagHandler(), onPhoneActive: () => historyPhoneOnline(), onGroupChange: (ev) => markGroupDue(ev.chat) });
startScheduler(whatsapp);
startBackupScheduler();
startUpdateScheduler();
startMetrics();
startRuntimeFile(whatsapp);
startWebAccess();
// #10 silent by default: chats are off until switched on; tell the owner once after the update.
activity('system', { summary: 'Started' });

// 069: graceful shutdown (systemd stop/restart, updates): no new messages or jobs, running turns get a few seconds,
// WhatsApp sockets close without unlinking, the database is checkpointed and closed. A crash (uncaught exception)
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
  if (!finished) console.error('Stopping with turns still running');
  await whatsapp.stop().catch(() => {});
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* already closed */ }
  process.exit(code);
}
process.on('unhandledRejection', (e) => activity('error', { summary: `Unhandled: ${e instanceof Error ? e.message : e}` }));
process.on('uncaughtException', (e) => { console.error('Fatal:', e); shutdown(`fatal: ${e?.message || e}`, 1); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
