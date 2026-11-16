// Owner alerts on WhatsApp (040/041, issues #35 and #38). The app has no phone number for panel users, so the owner
// enters one in the owner assistant's editor (Agents → Owner assistant → Alerts, 059: alerts are messages of the
// built-in owner assistant). Without one, alerts are only recorded in Activity. Alerts stay event-driven.
import { digits } from './config.js';
import { getAgent, OWNER_AGENT_ID } from './agents.js';
import { activity } from './events.js';
import { whatsappChannel } from './whatsapp-tools.js';

/** The owner's alert number (digits with country code) or ''. */
export const ownerNumber = () => digits(getAgent(OWNER_AGENT_ID)?.alerts?.to || '');
/** The chat id alerts go to (always the first WhatsApp number's session). */
const ownerChat = () => (ownerNumber() ? `${ownerNumber()}@s.whatsapp.net` : '');

/** Send one alert to the owner. Never throws. Returns { sent, to, reason? }. */
export async function sendOwnerAlert(text, { kind = 'alert' } = {}) {
  const to = ownerChat();
  if (!to) {
    activity('system', { summary: `Owner alert not sent (no number under Agents → Owner assistant → Alerts): ${text}`, detail: { kind } });
    return { sent: false, to: '', reason: 'No alert number set' };
  }
  const ch = whatsappChannel();
  if (!ch) return { sent: false, to, reason: 'WhatsApp is not available' };
  try {
    await ch.send(to, text);
    activity('system', { summary: `Owner alert sent (${kind}) to +${ownerNumber()}`, detail: { kind } });
    return { sent: true, to };
  } catch (e) {
    activity('error', { summary: `Owner alert (${kind}) failed: ${e.message}` });
    return { sent: false, to, reason: e.message };
  }
}
