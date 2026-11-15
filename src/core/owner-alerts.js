// Owner alerts on WhatsApp (040/041, issues #35 and #38). The app has no phone number for panel users, so the owner
// enters one under Settings → Owner alerts ("Alerts go to"). Without one, alerts are only recorded in Activity.
import { digits } from './config.js';
import { getSetting, updateSettings } from './store.js';
import { activity } from './events.js';
import { whatsappChannel } from './whatsapp-tools.js';

const bad = (message, field) => Object.assign(new Error(message), { status: 400, field });

/** The owner's alert number (digits with country code) or ''. */
export const ownerNumber = () => digits(getSetting('alertsTo', ''));
export function setOwnerNumber(value) {
  const d = digits(value);
  if (d && (d.length < 8 || d.length > 15)) throw bad('Enter the number with its country code, e.g. +41 79 123 45 67', 'alertsTo');
  updateSettings({ alertsTo: d });
  return d;
}
/** The chat id alerts go to (always the first WhatsApp number's session). */
export const ownerChat = () => (ownerNumber() ? `${ownerNumber()}@s.whatsapp.net` : '');

/** Send one alert to the owner. Never throws. Returns { sent, to, reason? }. */
export async function sendOwnerAlert(text, { kind = 'alert' } = {}) {
  const to = ownerChat();
  if (!to) {
    activity('system', { summary: `Owner alert not sent (no number under Settings → Owner alerts): ${text}`, detail: { kind } });
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
