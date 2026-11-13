import { loadBots, listBots } from './core/bots.js';
import { createWhatsAppChannel } from './channels/whatsapp.js';
import { createRouter } from './core/router.js';
import { startScheduler } from './core/scheduler.js';
import { startPanel } from './panel/server.js';
import { activity } from './core/events.js';

await loadBots();
console.log(`Bots: ${listBots().map((b) => `${b.id}${b.enabled ? '' : ' (disabled)'}`).join(', ') || 'none'}`);

const whatsapp = createWhatsAppChannel();
startPanel({ channel: whatsapp });
await whatsapp.start(createRouter(whatsapp));
startScheduler(whatsapp);
activity('system', { summary: 'Started' });

process.on('unhandledRejection', (e) => activity('error', { summary: `Unhandled: ${e?.message || e}` }));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
