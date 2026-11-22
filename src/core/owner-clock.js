// @ts-check
// The owner's clock: the date and the time of day where the owner lives (the owner assistant's time zone, else the
// server's default). Dates the owner enters (a registration deadline, a due date, a campaign's last day, a birthday)
// and work that happens once a day go by it, never by the UTC day: in Zurich that day starts at 1 or 2 at night, in
// Bangalore at half past five in the morning.
import { env, localParts } from './config.js';
import { getAgent, OWNER_AGENT_ID } from './agents.js';

export const ownerTz = () => getAgent(OWNER_AGENT_ID)?.timezone || env.timezone;
/** The owner's date and time at `at`: { date: 'YYYY-MM-DD', hhmm: 'HH:MM', day: 'mon' }. */
export const ownerNow = (at = Date.now()) => localParts(ownerTz(), at);
/** The owner's date at `at`, 'YYYY-MM-DD'. */
export const ownerDay = (at = Date.now()) => ownerNow(at).date;
