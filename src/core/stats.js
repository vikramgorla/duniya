// Daily counters for the weekly summary (041, issue #38): messages handled and replies per agent, messages ignored per
// chat, replies held back by a spending cap. Counts only — never message text. Kept 60 days.
import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_stats (
    day INTEGER NOT NULL, kind TEXT NOT NULL, agent TEXT NOT NULL DEFAULT '', chat TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind, agent, chat)
  );
`);
export const STAT_KINDS = ['handled', 'reply', 'ignored', 'budget'];
export const dayOf = (ts) => Math.floor(ts / 86400000);
const up = db.prepare(`INSERT INTO daily_stats (day, kind, agent, chat, n) VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(day, kind, agent, chat) DO UPDATE SET n = n + 1`);

/** Count one event. Never throws (bookkeeping must not break routing). */
export function countStat(kind, { agent = '', chat = '' } = {}, ts = Date.now()) {
  try {
    up.run(dayOf(ts), kind, agent || '', kind === 'ignored' || kind === 'budget' ? chat || '' : '');
    if (Math.random() < 0.002) db.prepare('DELETE FROM daily_stats WHERE day < ?').run(dayOf(ts) - 60);
  } catch { /* ignore */ }
}

/** Rows { kind, agent, chat, n } summed over the days [fromDay, toDay) (day numbers from dayOf). */
export function statsBetween(fromDay, toDay) {
  return db.prepare('SELECT kind, agent, chat, SUM(n) AS n FROM daily_stats WHERE day >= ? AND day < ? GROUP BY kind, agent, chat')
    .all(fromDay, toDay).map((r) => ({ ...r, n: r.n || 0 }));
}
