// @ts-check
// Daily counters for the weekly summary (041, issue #38): messages handled and replies per agent, messages ignored per
// chat, replies held back by a spending cap. Counts only — never message text. Kept 60 days (retention.js).
import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_stats (
    day INTEGER NOT NULL, kind TEXT NOT NULL, agent TEXT NOT NULL DEFAULT '', chat TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind, agent, chat)
  );
`);
export const dayOf = (ts) => Math.floor(ts / 86400000);
const up = db.prepare(`INSERT INTO daily_stats (day, kind, agent, chat, n) VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(day, kind, agent, chat) DO UPDATE SET n = n + 1`);

/** Count one event. Never throws (bookkeeping must not break routing). */
export function countStat(kind, { agent = '', chat = '' } = {}, ts = Date.now()) {
  try {
    up.run(dayOf(ts), kind, agent || '', kind === 'ignored' || kind === 'budget' ? chat || '' : '');
  } catch { /* ignore */ }
}

/** 094: media an agent shared on its own in the last `days` days: { ai: picked by the model, rule: by the fallback }. */
export function sharedCounts(agent, days = 7, now = Date.now()) {
  const rows = db.prepare("SELECT kind, SUM(n) AS n FROM daily_stats WHERE day >= ? AND kind IN ('shared_ai', 'shared_rule') AND agent = ? GROUP BY kind").all(dayOf(now) - days + 1, agent);
  const n = (k) => Number(rows.find((r) => r.kind === k)?.n || 0);
  return { ai: n('shared_ai'), rule: n('shared_rule') };
}
/** Rows { kind, agent, chat, n } summed over the days [fromDay, toDay) (day numbers from dayOf). */
export function statsBetween(fromDay, toDay) {
  return db.prepare('SELECT kind, agent, chat, SUM(n) AS n FROM daily_stats WHERE day >= ? AND day < ? GROUP BY kind, agent, chat')
    .all(fromDay, toDay).map((r) => ({ ...r, n: r.n || 0 }));
}
