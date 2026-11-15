import { kvGet, kvSet } from './core/db.js';
import { loadBots, listBots } from './core/bots.js';
import { createChannelRegistry } from './channels/registry.js';
import { createRouter, createHistoryHandler } from './core/router.js';
import { startScheduler } from './core/scheduler.js';
import { startPanel } from './panel/server.js';
import { providerRoutes } from './panel/routes/providers.js';
import { backupRoutes } from './panel/routes/backups.js';
import { startBackupScheduler } from './core/backup/index.js';
import { updateRoutes } from './panel/routes/updates.js';
import { startUpdateScheduler } from './core/updates.js';
import { activity } from './core/events.js';
import { startMetrics } from './core/system.js';

await loadBots();
console.log(`Bots: ${listBots().map((b) => `${b.id}${b.enabled ? '' : ' (disabled)'}`).join(', ') || 'none'}`);

const whatsapp = createChannelRegistry();
startPanel({ channel: whatsapp, extend: [providerRoutes, backupRoutes, updateRoutes] });
await whatsapp.start(createRouter(whatsapp), { onHistory: createHistoryHandler() });
startScheduler(whatsapp);
startBackupScheduler();
startUpdateScheduler();
startMetrics();
// #10 silent by default: chats are off until switched on; tell the owner once after the update.
if (!kvGet('allowlist:notice')) { kvSet('allowlist:notice', String(Date.now())); activity('config', { summary: 'Security update: every chat is now OFF until you switch it on (Chats page). Agents ignore chats that are off — nothing is stored or sent to a model.' }); }
activity('system', { summary: 'Started' });

process.on('unhandledRejection', (e) => activity('error', { summary: `Unhandled: ${e?.message || e}` }));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
