import { loadAgents, listAgents } from './core/agents.js';
import { createChannelRegistry } from './channels/registry.js';
import { createRouter, createHistoryHandler } from './core/router.js';
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

await loadAgents();
{ const s = serverSize(); console.log(`Server: ${s.size} (${s.effectiveMb} MB RAM${s.cgroupLimitMb ? ' container limit' : ''}, ${s.cpus} CPU)`); }
startResourceWatch();
console.log(`Agents: ${listAgents().map((b) => `${b.id}${b.enabled ? '' : ' (disabled)'}`).join(', ') || 'none'}`);

const whatsapp = createChannelRegistry();
startPanel({ channel: whatsapp, extend: [providerRoutes, backupRoutes, updateRoutes] });
await whatsapp.start(createRouter(whatsapp), { onHistory: createHistoryHandler() });
startScheduler(whatsapp);
startBackupScheduler();
startUpdateScheduler();
startMetrics();
startRuntimeFile(whatsapp);
startWebAccess();
// #10 silent by default: chats are off until switched on; tell the owner once after the update.
activity('system', { summary: 'Started' });

process.on('unhandledRejection', (e) => activity('error', { summary: `Unhandled: ${e?.message || e}` }));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
