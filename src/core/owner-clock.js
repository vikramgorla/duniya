// @ts-check
// The owner's clock: the date and the time of day where the owner lives (the owner assistant's time zone, else the
// server's default). Dates the owner enters (a registration deadline, a due date, a campaign's last day, a birthday)
// and work that happens once a day go by it, never by the UTC day: in Zurich that day starts at 1 or 2 at night, in
// Bangalore at half past five in the morning. So do the months of spending caps, the times of updates and backups,
// and every agent that has no time zone of its own: one clock for the whole server, set in one place.
import { env, localParts } from './config.js';
import { getAgent, OWNER_AGENT_ID } from './agents.js';

/** The server's default (TZ_DEFAULT): the owner's clock until the owner sets a time zone on the owner assistant. */
export const serverTz = () => env.timezone;
export const ownerTz = () => getAgent(OWNER_AGENT_ID)?.timezone || serverTz();
/** The time zone an agent works in: its own, else the owner's. */
export const agentTz = (agent) => agent?.timezone || ownerTz();
/** The owner's date and time at `at`: { date: 'YYYY-MM-DD', hhmm: 'HH:MM', day: 'mon' }. */
export const ownerNow = (at = Date.now()) => localParts(ownerTz(), at);
/** The owner's date at `at`, 'YYYY-MM-DD'. */
export const ownerDay = (at = Date.now()) => ownerNow(at).date;
