// @ts-check
// Runtime heartbeat (029): the running service writes DATA_DIR/runtime.json every 30 s (pid, start time, version,
// WhatsApp numbers) so the `duniya status` command can show live state without talking to the process.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION, DATA_DIR } from './config.js';

const RUNTIME_FILE = resolve(DATA_DIR, 'runtime.json');

export function startRuntimeFile(channel, { everyMs = 30000 } = {}) {
  const startedAt = Date.now();
  const write = async () => {
    let numbers = [];
    try {
      const st = await channel.status();
      numbers = (st.numbers || [st]).map((n) => ({ id: n.id || 'main', label: n.label || n.id || 'Main', status: n.status || 'unknown', me: String(n.me || '').split(':')[0].split('@')[0] }));
    } catch { /* channel not ready */ }
    const doc = { pid: process.pid, startedAt, at: Date.now(), version: APP_VERSION, node: process.version, rssMb: Math.round(process.memoryUsage().rss / 1048576), numbers };
    try { writeFileSync(`${RUNTIME_FILE}.tmp`, JSON.stringify(doc), { mode: 0o600 }); renameSync(`${RUNTIME_FILE}.tmp`, RUNTIME_FILE); } catch { /* read-only data dir */ }
  };
  write();
  const t = setInterval(write, everyMs); t.unref();
  return { write, stop: () => clearInterval(t) };
}

/** The last heartbeat, with `running` = written in the last 90 s. */
export function readRuntime(file = RUNTIME_FILE) {
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    return { ...doc, running: Date.now() - doc.at < 90000 };
  } catch { return null; }
}
